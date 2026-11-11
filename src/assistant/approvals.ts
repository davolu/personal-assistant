import type { ApprovalRecord } from "./types";
import { digestOf } from "./util";

export function actionDigest(tool: string, args: Record<string, unknown>): string {
  return digestOf({ tool, args });
}

export function canResolve(
  approval: ApprovalRecord,
  userId: string,
  now: Date
): { ok: true } | { ok: false; reason: "owner" | "expired" | "replay" | "digest" } {
  if (approval.userId !== userId) return { ok: false, reason: "owner" };
  if (approval.status !== "pending") return { ok: false, reason: "replay" };
  if (new Date(approval.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  const expected = actionDigest(approval.tool, approval.args);
  if (expected !== approval.digest) return { ok: false, reason: "digest" };
  return { ok: true };
}
