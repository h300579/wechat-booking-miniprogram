import { fail } from "./common";
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(time: number, zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, f);
  }
  return Object.fromEntries(
    f
      .formatToParts(time)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}
export function localDate(time: number, zone: string) {
  const p = parts(time, zone);
  return `${p.year}-${p.month}-${p.day}`;
}
export function label(time: number, zone: string) {
  const p = parts(time, zone);
  return `${p.hour}:${p.minute}`;
}
export function addDays(date: string, n: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function validDate(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v + "T00:00:00Z")) ||
    new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v
  )
    fail("INVALID_ARGUMENT");
  return v;
}
export function checkDate(
  date: string,
  now: number,
  zone: string,
  days: number,
) {
  const today = localDate(now, zone);
  if (date < today || date >= addDays(today, days)) fail("INVALID_ARGUMENT");
}
// Invert the timezone formatter; reject nonexistent local times (DST gap).
export function toUTC(date: string, clock: string, zone: string): number {
  validDate(date);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) fail("INVALID_ARGUMENT");
  const target = Date.parse(`${date}T${clock}:00Z`);
  let result = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(result, zone);
    const represented = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    result += target - represented;
  }
  if (localDate(result, zone) !== date || label(result, zone) !== clock)
    fail("INVALID_ARGUMENT");
  return result;
}
export function startValue(v: unknown): number {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(v)
  )
    fail("INVALID_ARGUMENT");
  const n = Date.parse(v);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== v)
    fail("INVALID_ARGUMENT");
  return n;
}
