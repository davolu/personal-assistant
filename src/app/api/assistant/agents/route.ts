import { getSession } from "@/lib/session";
import { databaseProblem } from "@/lib/db-error";
import { saveWorkflow, listWorkflows } from "@/lib/saved-agents";
import type { WorkflowOffer } from "@/assistant/workflow";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    return Response.json({ agents: await listWorkflows(session.user.id) });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    workflow?: WorkflowOffer;
    name?: string;
    cadence?: string;
    timezone?: string;
    externalApproved?: boolean;
  };
  if (!body.workflow?.request || !Array.isArray(body.workflow.steps) || !body.workflow.steps.length) {
    return Response.json({ error: "A finished workflow is required" }, { status: 400 });
  }
  try {
    const agent = await saveWorkflow(session.user.id, body.workflow, body);
    return Response.json({ agent });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}
