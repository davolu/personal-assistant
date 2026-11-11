// One-time migration: give every existing custom agent a grounded, validated
// tool procedure so it runs on the plan-execute engine. Identity (name, steps,
// schedule, memory) is preserved; only `procedure` + the playbook's procedure
// block change. Agents whose grounding fails stay on the legacy loop, listed.
// Run: npx tsx --env-file=.env.local scripts/migrate-procedures.mts

import { PrismaClient } from "@prisma/client";
import { groundPlan, toolkitToolSlugs, type AgentPlan } from "../src/lib/planner";
import { BUILTIN_RESEARCH_TOOLS } from "../src/lib/runner";

const prisma = new PrismaClient();

async function main() {
  const agents = await prisma.customAgent.findMany();
  console.log(`${agents.length} custom agents found`);

  for (const a of agents) {
    if (Array.isArray(a.procedure) && (a.procedure as unknown[]).length > 0) {
      console.log(`SKIP (has procedure): ${a.name}`);
      continue;
    }
    const baseInstructions = a.instructions.replace(/\n*Tool procedure[\s\S]*$/, "").trim();
    const draft: AgentPlan = {
      name: a.name,
      description: a.description,
      toolkits: a.toolkits,
      schedule: a.schedule as AgentPlan["schedule"],
      trigger_summary: a.schedule,
      steps: a.steps,
      instructions: baseInstructions,
    };
    try {
      // The agent's proven procedure (from successful runs) is ground truth
      // about which tools actually work — feed it to grounding as a hint.
      const hired = await prisma.hiredAgent.findFirst({
        where: { slug: `custom-${a.id}` },
        select: { memory: true },
      });
      const proven = hired?.memory.match(/Proven procedure[\s\S]*$/)?.[0] ?? "";
      const ideaWithHint = `${a.idea || a.description}${proven ? `\n\nTools PROVEN to work for this exact job in past successful runs (prefer these):\n${proven.slice(0, 800)}` : ""}`;
      const grounded = await groundPlan(ideaWithHint, draft);
      const procedure = (grounded.procedure ?? [])
        .filter((p) => p && typeof p.tool === "string")
        .slice(0, 20)
        .map((p) => ({ tool: p.tool.trim(), purpose: (p.purpose ?? "").slice(0, 300) }));
      if (procedure.length === 0) {
        console.log(`LEGACY (no procedure produced): ${a.name}`);
        continue;
      }
      // Code validation, same rule as the save route (Ch48).
      const slugSets = await Promise.all(a.toolkits.map((t) => toolkitToolSlugs(t)));
      const known = new Set<string>(["WEB_RESEARCH", ...BUILTIN_RESEARCH_TOOLS, ...slugSets.flatMap((s) => [...s])]);
      const catalogsLoaded = slugSets.every((s) => s.size > 0);
      const bad = procedure.filter((p) => !known.has(p.tool));
      if (!catalogsLoaded || bad.length > 0) {
        console.log(`LEGACY (invalid: ${bad.map((b) => b.tool).join(",") || "catalog unavailable"}): ${a.name}`);
        continue;
      }
      const procedureText = `\n\nTool procedure — execute these operations in this exact order, passing each step's output into the next:\n${procedure
        .map((p, i) => `${i + 1}. ${p.tool} — ${p.purpose}`)
        .join("\n")}`;
      await prisma.customAgent.update({
        where: { id: a.id },
        data: {
          procedure,
          instructions: `${baseInstructions}${procedureText}`.slice(0, 6000),
        },
      });
      console.log(`MIGRATED (${procedure.length} steps): ${a.name}`);
      if (grounded.limitations?.length) {
        grounded.limitations.forEach((l) => console.log(`   setup needed: ${l.slice(0, 110)}`));
      }
    } catch (err) {
      console.log(`LEGACY (error: ${err instanceof Error ? err.message.slice(0, 80) : err}): ${a.name}`);
    }
  }
  await prisma.$disconnect();
}

main();
