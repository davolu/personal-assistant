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

function partsInZone(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(formatted.find((part) => part.type === type)?.value ?? "0");
  const hour = value("hour");
  return { year: value("year"), month: value("month"), day: value("day"), hour: hour === 24 ? 0 : hour, minute: value("minute"), second: value("second") };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = partsInZone(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** Add calendar days or hours in a timezone so a daily run stays at the same local time across DST. */
function addInTimeZone(from: Date, timeZone: string, add: { days?: number; hours?: number }): Date {
  const local = partsInZone(from, timeZone);
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + (add.days ?? 0), local.hour + (add.hours ?? 0), local.minute, local.second));
  const desired = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds());
  const first = zoneOffsetMs(new Date(desired), timeZone);
  const corrected = new Date(desired - first);
  const second = zoneOffsetMs(corrected, timeZone);
  return second === first ? corrected : new Date(desired - second);
}

/** Preset cadences. Pass a timezone so daily and weekly runs keep the same local clock time. */
export function nextRunAt(cadence: string, from: Date, timeZone?: string): Date | null {
  if (cadence === "event" || cadence === "manual") return null;
  const step = MS[cadence as keyof typeof MS];
  if (!step) return null;
  if (!timeZone) return new Date(from.getTime() + step);
  try {
    const add = cadence === "hourly" ? { hours: 1 } : cadence === "weekly" ? { days: 7 } : { days: 1 };
    return addInTimeZone(from, timeZone, add);
  } catch {
    return new Date(from.getTime() + step);
  }
}

export function dueRoutines(routines: RoutineLike[], now: Date): RoutineLike[] {
  return routines.filter((routine) => {
    if (!routine.enabled) return false;
    if (routine.cadence === "event") return false;
    if (!routine.nextRunAt) return true;
    return new Date(routine.nextRunAt).getTime() <= now.getTime();
  });
}
