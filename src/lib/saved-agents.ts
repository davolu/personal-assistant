import { prisma } from "@/lib/prisma";
import { nextRunAt } from "@/assistant/scheduler";
import { replayPrompt, type WorkflowOffer } from "@/assistant/workflow";

export type StoredWorkflow = WorkflowOffer & {
  timezone: string;
  externalApproved: boolean;
  paused?: boolean;
  routineId?: string;
  lastStatus?: string;
  lastRunAt?: string | null;
};

const CADENCE = new Set(["manual", "hourly", "daily", "weekly"]);

function asJson(value: StoredWorkflow) {
  return JSON.parse(JSON.stringify(value)) as object;
}

export function asStored(value: unknown): StoredWorkflow | null {
  if (!value || typeof value !== "object") return null;
  const record = value as StoredWorkflow;
  if (!record.request || !Array.isArray(record.steps)) return null;
  return record;
}

function agentPrompt(id: string, workflow: WorkflowOffer): string {
  return `agent-id:${id}\n${replayPrompt(workflow)}`;
}

export async function saveWorkflow(userId: string, workflow: WorkflowOffer, input: { name?: string; cadence?: string; timezone?: string; externalApproved?: boolean }) {
  const cadence = CADENCE.has(String(input.cadence)) ? (String(input.cadence) as WorkflowOffer["cadence"]) : workflow.cadence;
  const timezone = String(input.timezone || "UTC").slice(0, 80);
  const externalApproved = Boolean(input.externalApproved) && workflow.externalTools.length > 0;
  const name = String(input.name || workflow.name).slice(0, 80);
  const stored: StoredWorkflow = { ...workflow, name, cadence, timezone, externalApproved, lastStatus: "", lastRunAt: null };
  const agent = await prisma.customAgent.create({
    data: {
      userId,
      name,
      description: workflow.request.slice(0, 240),
      idea: workflow.request.slice(0, 2000),
      instructions: replayPrompt(workflow),
      toolkits: workflow.requiredToolkits,
      procedure: asJson(stored),
      steps: workflow.steps.map((step) => step.goal).slice(0, 12),
      schedule: cadence,
    },
  });
  if (cadence !== "manual") {
    const routine = await prisma.routine.create({
      data: {
        userId,
        name,
        cadence,
        prompt: agentPrompt(agent.id, stored),
        sendsApproved: externalApproved,
        nextRunAt: nextRunAt(cadence, new Date()),
      },
    });
    stored.routineId = routine.id;
    await prisma.customAgent.update({ where: { id: agent.id }, data: { procedure: asJson(stored), instructions: agentPrompt(agent.id, stored) } });
  }
  return { id: agent.id, name, cadence, timezone };
}

export async function listWorkflows(userId: string) {
  const rows = await prisma.customAgent.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 50 });
  return rows.map((row) => {
    const stored = asStored(row.procedure);
    return {
      id: row.id,
      name: row.name,
      request: stored?.request ?? row.idea,
      cadence: stored?.cadence ?? row.schedule,
      timezone: stored?.timezone ?? "UTC",
      paused: stored?.paused === true,
      lastStatus: stored?.lastStatus ?? "",
      lastRunAt: stored?.lastRunAt ?? null,
      routineId: stored?.routineId ?? null,
      externalTools: stored?.externalTools ?? [],
    };
  });
}

async function owned(userId: string, id: string) {
  return prisma.customAgent.findFirst({ where: { id, userId } });
}

export async function updateWorkflow(userId: string, id: string, patch: { cadence?: string; paused?: boolean; name?: string }) {
  const row = await owned(userId, id);
  if (!row) return null;
  const stored = asStored(row.procedure) ?? ({ request: row.idea, name: row.name, cadence: "manual", steps: [], requiredToolkits: [], externalTools: [], timezone: "UTC", externalApproved: false } as StoredWorkflow);
  if (patch.name) stored.name = patch.name.slice(0, 80);
  if (patch.cadence && CADENCE.has(patch.cadence)) stored.cadence = patch.cadence as WorkflowOffer["cadence"];
  if (typeof patch.paused === "boolean") stored.paused = patch.paused;
  if (stored.routineId) {
    await prisma.routine.update({
      where: { id: stored.routineId },
      data: {
        name: stored.name,
        cadence: stored.cadence === "manual" ? "daily" : stored.cadence,
        enabled: !stored.paused && stored.cadence !== "manual",
        nextRunAt: stored.cadence === "manual" || stored.paused ? null : nextRunAt(stored.cadence, new Date()),
      },
    });
  } else if (stored.cadence !== "manual" && !stored.paused) {
    const routine = await prisma.routine.create({
      data: {
        userId,
        name: stored.name,
        cadence: stored.cadence,
        prompt: agentPrompt(row.id, stored),
        sendsApproved: stored.externalApproved,
        nextRunAt: nextRunAt(stored.cadence, new Date()),
      },
    });
    stored.routineId = routine.id;
  }
  await prisma.customAgent.update({
    where: { id: row.id },
    data: { name: stored.name, schedule: stored.cadence, procedure: asJson(stored) },
  });
  return { id: row.id, cadence: stored.cadence, name: stored.name };
}

export async function deleteWorkflow(userId: string, id: string) {
  const row = await owned(userId, id);
  if (!row) return false;
  const stored = asStored(row.procedure);
  if (stored?.routineId) await prisma.routine.delete({ where: { id: stored.routineId } }).catch(() => null);
  await prisma.customAgent.delete({ where: { id: row.id } });
  return true;
}

export function workflowRunText(id: string, stored: StoredWorkflow): string {
  return `agent-id:${id}\n${replayPrompt(stored)}`;
}

export async function rememberRun(userId: string, id: string, status: string) {
  const row = await owned(userId, id);
  if (!row) return;
  const stored = asStored(row.procedure);
  if (!stored) return;
  stored.lastStatus = status;
  stored.lastRunAt = new Date().toISOString();
  await prisma.customAgent.update({ where: { id: row.id }, data: { procedure: asJson(stored) } });
}
