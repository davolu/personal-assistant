/** Who may delete, pin, or duplicate a thread. A missing or foreign row is the same answer. */
export function threadAccess(actorId: string | null, ownerId: string | null): "unauthenticated" | "missing" | "forbidden" | "allowed" {
  if (!actorId) return "unauthenticated";
  if (!ownerId) return "missing";
  if (ownerId !== actorId) return "forbidden";
  return "allowed";
}

export function threadAccessStatus(decision: ReturnType<typeof threadAccess>): number {
  if (decision === "unauthenticated") return 401;
  if (decision === "allowed") return 200;
  return 404;
}
