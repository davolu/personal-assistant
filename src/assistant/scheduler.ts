export type Cadence = "hourly" | "daily" | "weekly" | "event";

export type RoutineLike = {
  id: string;
  userId: string;
  cadence: string;
  enabled: boolean;
  nextRunAt: string | null;
  prompt: string;
  toolkit?: string;
};

const MS = { hourly: 60 * 60 * 1000, daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 };

/** Preset cadences. A full cron expression language is an extension point. */
export function nextRunAt(cadence: string, from: Date): Date | null {
  if (cadence === "event") return null;
  const step = MS[cadence as keyof typeof MS];
  if (!step) return null;
  return new Date(from.getTime() + step);
}

export function dueRoutines(routines: RoutineLike[], now: Date): RoutineLike[] {
  return routines.filter((routine) => {
    if (!routine.enabled) return false;
    if (routine.cadence === "event") return false;
    if (!routine.nextRunAt) return true;
    return new Date(routine.nextRunAt).getTime() <= now.getTime();
  });
}
