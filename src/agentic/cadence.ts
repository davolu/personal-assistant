export type CadenceKind = "daily" | "weekdays" | "weekly" | "interval" | "cron";

export type NormalizedCadence = {
  kind: CadenceKind;
  time: string;
  weekday: number | null;
  hours: number | null;
  cron: string;
  timezone: string;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

type CronFields = {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domStar: boolean;
  dowStar: boolean;
};

export function validZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone.trim() || zone.length > 80) return false;
  const trimmed = zone.trim();
  if (trimmed === "UTC" || trimmed === "Etc/UTC" || trimmed === "GMT") return true;
  try {
    return Intl.supportedValuesOf("timeZone").includes(trimmed);
  } catch {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(0);
      return false;
    } catch {
      return false;
    }
  }
}

export function normalizeCadence(input: unknown, fallbackZone = "UTC"): { ok: true; cadence: NormalizedCadence } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Choose how often this should run." };
  const record = input as Record<string, unknown>;
  const nested = record.cadence && typeof record.cadence === "object" ? (record.cadence as Record<string, unknown>) : null;
  const source = nested ? { ...record, ...nested } : record;
  if (source.timezone != null && String(source.timezone).trim() && !validZone(source.timezone)) {
    return { ok: false, error: "Choose a valid timezone." };
  }
  const zone = validZone(source.timezone) ? String(source.timezone).trim() : validZone(fallbackZone) ? fallbackZone : "UTC";
  const kind = String(source.kind ?? (typeof source.cadence === "string" ? source.cadence : "")).trim().toLowerCase();
  if (kind === "daily" || kind === "weekdays" || kind === "weekly") {
    const time = clock(source.time);
    if (!time) return { ok: false, error: "Choose a time of day, like 09:00." };
    if (kind === "weekly") {
      const weekday = parseWeekday(source.weekday);
      if (weekday == null) return { ok: false, error: "Choose a day of the week." };
      const [minute, hour] = splitClock(time);
      return { ok: true, cadence: { kind, time, weekday, hours: null, cron: `${minute} ${hour} * * ${weekday}`, timezone: zone } };
    }
    const [minute, hour] = splitClock(time);
    const cron = kind === "weekdays" ? `${minute} ${hour} * * 1-5` : `${minute} ${hour} * * *`;
    return { ok: true, cadence: { kind, time, weekday: null, hours: null, cron, timezone: zone } };
  }
  if (kind === "interval" || kind === "hourly" || kind === "hours") {
    const hours = Number(source.hours ?? source.every);
    if (!Number.isInteger(hours) || hours < 1 || hours > 23) return { ok: false, error: "Choose an interval from 1 to 23 hours." };
    return { ok: true, cadence: { kind: "interval", time: "", weekday: null, hours, cron: `0 */${hours} * * *`, timezone: zone } };
  }
  if (kind === "cron" || kind === "custom") {
    const cron = String(source.cron ?? "").trim();
    if (!parseCron(cron)) return { ok: false, error: "Enter a five-field cron expression, such as 0 9 * * 1." };
    return { ok: true, cadence: { kind: "cron", time: "", weekday: null, hours: null, cron, timezone: zone } };
  }
  return { ok: false, error: "Choose daily, weekdays, weekly, every few hours, or a cron expression." };
}

export function describeCadence(cadence: NormalizedCadence): string {
  if (cadence.kind === "daily") return `Daily at ${formatClock(cadence.time)}`;
  if (cadence.kind === "weekdays") return `Weekdays at ${formatClock(cadence.time)}`;
  if (cadence.kind === "weekly") return `Weekly on ${DAYS[cadence.weekday ?? 0]} at ${formatClock(cadence.time)}`;
  if (cadence.kind === "interval") return `Every ${cadence.hours} hour${cadence.hours === 1 ? "" : "s"}`;
  return `Cron ${cadence.cron}`;
}

export function nextRunAfter(cadence: NormalizedCadence, from: Date): Date | null {
  const fields = parseCron(cadence.cron);
  if (!fields) return null;
  try {
    return nextCron(fields, from, cadence.timezone);
  } catch {
    return null;
  }
}

export function cadenceFromRow(value: unknown): NormalizedCadence | null {
  const parsed = normalizeCadence(value);
  return parsed.ok ? parsed.cadence : null;
}

function clock(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

function splitClock(time: string): [number, number] {
  const [hour, minute] = time.split(":").map(Number);
  return [minute, hour];
}

function formatClock(time: string): string {
  const [hourRaw, minute] = time.split(":").map(Number);
  const suffix = hourRaw >= 12 ? "PM" : "AM";
  const hour = hourRaw % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function parseWeekday(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (/^[0-6]$/.test(text)) return Number(text);
  const index = DAYS.findIndex((day) => day.toLowerCase() === text || day.toLowerCase().startsWith(text.slice(0, 3)));
  return index >= 0 && text.length >= 3 ? index : null;
}

function parseCron(cron: string): CronFields | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  const dow = parseField(parts[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;
  if (dow.values.has(7)) dow.values.add(0);
  dow.values.delete(7);
  return { minute: minute.values, hour: hour.values, dom: dom.values, month: month.values, dow: dow.values, domStar: parts[2] === "*", dowStar: parts[4] === "*" };
}

function parseField(expr: string, min: number, max: number): { values: Set<number> } | null {
  if (!expr || expr.length > 40) return null;
  const values = new Set<number>();
  for (const part of expr.split(",")) {
    const stepSplit = part.split("/");
    if (stepSplit.length > 2) return null;
    const step = stepSplit[1] === undefined ? 1 : Number(stepSplit[1]);
    if (!Number.isInteger(step) || step <= 0) return null;
    const range = stepSplit[0];
    let start = min;
    let end = max;
    if (range !== "*") {
      const bounds = range.split("-");
      if (bounds.length > 2) return null;
      const left = Number(bounds[0]);
      const right = bounds[1] === undefined ? left : Number(bounds[1]);
      if (!Number.isInteger(left) || !Number.isInteger(right)) return null;
      start = left;
      end = right;
    }
    if (start < min || end > max || start > end) return null;
    for (let n = start; n <= end; n += step) values.add(n);
  }
  return values.size ? { values } : null;
}

function matches(fields: CronFields, parts: Parts): boolean {
  if (!fields.minute.has(parts.minute) || !fields.hour.has(parts.hour) || !fields.month.has(parts.month)) return false;
  const dom = fields.dom.has(parts.day);
  const dow = fields.dow.has(parts.weekday);
  if (fields.domStar && fields.dowStar) return true;
  if (fields.domStar) return dow;
  if (fields.dowStar) return dom;
  return dom || dow;
}

function nextCron(fields: CronFields, from: Date, timeZone: string): Date | null {
  let parts = partsInZone(new Date(from.getTime() + 60_000), timeZone);
  let cursor = zonedTime(parts, timeZone);
  if (cursor.getTime() <= from.getTime()) parts = addMinutes(parts, 1);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (matches(fields, parts)) return zonedTime(parts, timeZone);
    parts = addMinutes(parts, 1);
  }
  return null;
}

function partsInZone(date: Date, timeZone: string): Parts {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => formatted.find((part) => part.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(value("minute")),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = partsInZone(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return asUtc - date.getTime();
}

function zonedTime(parts: Parts, timeZone: string): Date {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const first = zoneOffsetMs(new Date(desired), timeZone);
  const corrected = new Date(desired - first);
  const second = zoneOffsetMs(corrected, timeZone);
  return second === first ? corrected : new Date(desired - second);
}

function addMinutes(parts: Parts, amount: number): Parts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute + amount, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}
