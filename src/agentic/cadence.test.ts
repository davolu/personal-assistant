import assert from "node:assert/strict";
import test from "node:test";
import { describeCadence, nextRunAfter, normalizeCadence } from "./cadence";

const zone = "America/New_York";

test("daily, weekdays, weekly, interval, and cron normalize in the user's zone", () => {
  const daily = normalizeCadence({ kind: "daily", time: "09:00", timezone: zone });
  assert.equal(daily.ok, true);
  if (!daily.ok) return;
  assert.equal(daily.cadence.cron, "0 9 * * *");
  assert.equal(describeCadence(daily.cadence), "Daily at 9:00 AM");

  const weekdays = normalizeCadence({ cadence: "weekdays", time: "09:30", timezone: zone });
  assert.equal(weekdays.ok && weekdays.cadence.cron, "30 9 * * 1-5");

  const weekly = normalizeCadence({ kind: "weekly", time: "09:00", weekday: "monday", timezone: zone });
  assert.equal(weekly.ok && weekly.cadence.cron, "0 9 * * 1");
  if (weekly.ok) assert.match(describeCadence(weekly.cadence), /Monday/);

  const interval = normalizeCadence({ kind: "interval", hours: 2, timezone: zone });
  assert.equal(interval.ok && interval.cadence.cron, "0 */2 * * *");

  const cron = normalizeCadence({ kind: "cron", cron: "15 14 * * 1", timezone: zone });
  assert.equal(cron.ok && cron.cadence.cron, "15 14 * * 1");
});

test("invalid cadences and timezones are rejected", () => {
  assert.equal(normalizeCadence({ kind: "daily", time: "9am", timezone: zone }).ok, false);
  assert.equal(normalizeCadence({ kind: "interval", hours: 0, timezone: zone }).ok, false);
  assert.equal(normalizeCadence({ kind: "cron", cron: "99 * * * *", timezone: zone }).ok, false);
  assert.equal(normalizeCadence({ kind: "cron", cron: "* * * *", timezone: zone }).ok, false);
  assert.equal(normalizeCadence({ kind: "daily", time: "09:00", timezone: "Not/AZone" }).ok, false);
});

test("next run stays on the local clock, including across a DST change", () => {
  const daily = normalizeCadence({ kind: "daily", time: "09:00", timezone: zone });
  assert.equal(daily.ok, true);
  if (!daily.ok) return;
  const before = nextRunAfter(daily.cadence, new Date("2026-11-13T13:00:00.000Z"));
  assert.equal(before?.toISOString(), "2026-11-13T14:00:00.000Z");
  const after = nextRunAfter(daily.cadence, new Date("2026-11-13T14:30:00.000Z"));
  assert.equal(after?.toISOString(), "2026-11-14T14:00:00.000Z");

  const spring = nextRunAfter(daily.cadence, new Date("2026-03-07T15:00:00.000Z"));
  assert.equal(hourIn(spring, zone), 9);
  assert.equal(spring?.toISOString(), "2026-03-08T13:00:00.000Z");

  const weekdays = normalizeCadence({ kind: "weekdays", time: "09:00", timezone: zone });
  if (!weekdays.ok) return;
  const monday = nextRunAfter(weekdays.cadence, new Date("2026-11-14T15:00:00.000Z"));
  assert.equal(monday?.toISOString(), "2026-11-16T14:00:00.000Z");
});

function hourIn(date: Date | null, timeZone: string): number {
  assert.ok(date);
  const part = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Number(part.find((item) => item.type === "hour")?.value);
}
