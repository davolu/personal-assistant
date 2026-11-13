import { modelAllowed } from "@/lib/credits";
import { defaultModelId, resolveModel } from "./models";

const userChoice = new Map<string, string>();
const threadChoice = new Map<string, string>();

function threadKey(userId: string, threadId: string) {
  return `${userId}:${threadId}`;
}

export async function rememberModel(userId: string, threadId: string | null, modelId: string) {
  userChoice.set(userId, modelId);
  if (!threadId) return;
  threadChoice.set(threadKey(userId, threadId), modelId);
  try {
    const { setThreadModel } = await import("./postgres");
    await setThreadModel(userId, threadId, modelId);
  } catch {
    // The in-memory choice still applies for this process.
  }
}

export async function modelFor(
  userId: string,
  threadId: string | null,
  env: Record<string, string | undefined> = process.env,
  plan?: string
): Promise<string | null> {
  const stored = await storedModel(userId, threadId);
  if (stored) {
    const resolved = resolveModel(stored, env);
    if (resolved.ok && modelAllowed({ billable: resolved.model.billable, tier: resolved.model.tier, plan: plan ?? "scale" }).ok) {
      return resolved.model.id;
    }
  }
  return defaultModelId(env, plan);
}

export async function chooseModel(
  userId: string,
  threadId: string | null,
  requested: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
  plan?: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const id = requested?.trim() ? requested.trim() : await modelFor(userId, threadId, env, plan);
  const resolved = resolveModel(id, env);
  if (!resolved.ok) return resolved;
  if (plan) {
    const allowed = modelAllowed({ billable: resolved.model.billable, tier: resolved.model.tier, plan });
    if (!allowed.ok) return allowed;
  } else if (!resolved.model.billable) {
    return { ok: false, error: "That model is not available." };
  }
  await rememberModel(userId, threadId, resolved.model.id);
  return { ok: true, id: resolved.model.id };
}

async function storedModel(userId: string, threadId: string | null): Promise<string | null> {
  if (threadId) {
    const local = threadChoice.get(threadKey(userId, threadId));
    if (local) return local;
    try {
      const { getThreadModel } = await import("./postgres");
      const saved = await getThreadModel(userId, threadId);
      if (saved) {
        threadChoice.set(threadKey(userId, threadId), saved);
        return saved;
      }
    } catch {
      // Fall through to the user default.
    }
  }
  return userChoice.get(userId) ?? null;
}
