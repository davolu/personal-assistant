export type JobStatus = "queued" | "running" | "done" | "failed";

export type Job = {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  idempotencyKey: string;
  lastError: string;
};

export function enqueue(jobs: Job[], job: Job): { jobs: Job[]; created: boolean } {
  const existing = jobs.find((j) => j.idempotencyKey === job.idempotencyKey);
  if (existing) return { jobs, created: false };
  return { jobs: [...jobs, job], created: true };
}

export function claim(jobs: Job[], now: Date, limit: number): { jobs: Job[]; claimed: Job[] } {
  const due = jobs
    .filter((j) => j.status === "queued" && new Date(j.runAt).getTime() <= now.getTime())
    .sort((a, b) => a.runAt.localeCompare(b.runAt))
    .slice(0, limit);
  const ids = new Set(due.map((j) => j.id));
  const next = jobs.map((j) => (ids.has(j.id) ? { ...j, status: "running" as const, attempts: j.attempts + 1 } : j));
  const claimed = next.filter((j) => ids.has(j.id));
  return { jobs: next, claimed };
}

/** Transient failures retry with backoff. Permanent failures and exhausted attempts stop. */
export function settle(
  jobs: Job[],
  id: string,
  outcome: { ok: boolean; transient?: boolean; error?: string },
  now: Date
): Job[] {
  return jobs.map((job) => {
    if (job.id !== id) return job;
    if (outcome.ok) return { ...job, status: "done", lastError: "" };
    const transient = Boolean(outcome.transient);
    if (transient && job.attempts < job.maxAttempts) {
      const delay = Math.min(60, 2 ** job.attempts) * 1000;
      return {
        ...job,
        status: "queued",
        lastError: outcome.error ?? "transient",
        runAt: new Date(now.getTime() + delay).toISOString(),
      };
    }
    return { ...job, status: "failed", lastError: outcome.error ?? "failed" };
  });
}
