import { setDayClosed } from "./merchant";
import { Store, Doc, Query } from "./store";
import { settings } from "./appointment";
import { stamped, fail, overlap, uuid } from "./common";
import { localDate, addDays, toUTC, validDate } from "./time";
export async function generateDays(db: Store, now: number) {
  const c = await settings(db);
  let created = 0;
  for (let i = 0; i < c.bookingDays; i++) {
    const date = addDays(localDate(now, c.timeZone), i);
    const id = `${c.resourceId}:${date}`;
    const result = await db.transaction(async (tx) => {
      if (await tx.get("resource_days", id)) return false;
      const dow = new Date(date + "T12:00:00Z").getUTCDay();
      const hours = await tx.get("business_hours", `${c.resourceId}:${dow}`);
      if (!hours) fail("SCHEDULE_UNAVAILABLE");
      const windows = hours.enabled
        ? [
            {
              startTime: toUTC(date, hours.openTime, c.timeZone),
              endTime: toUTC(date, hours.closeTime, c.timeZone),
            },
          ]
        : [];
      if (windows.some((w) => w.startTime >= w.endTime))
        fail("INVALID_ARGUMENT");
      await tx.set(
        "resource_days",
        id,
        stamped(
          {
            resourceId: c.resourceId,
            localDate: date,
            windows,
            blockedIntervals: [],
            intervals: [],
            revision: 0,
            configVersion: hours.version,
          },
          now,
        ),
      );
      return true;
    });
    if (result) created++;
  }
  return { created };
}
export async function seed(db: Store, config: Doc, now: number) {
  if (config.stage !== "development" || !config.environmentId)
    fail("FORBIDDEN");
  await db.transaction(async (tx) => {
    if (await tx.get("settings", "booking")) fail("ALREADY_INITIALIZED");
    const {
      timeZone,
      resourceId,
      bookingDays,
      stepMinutes,
      maxFuture,
      maxDailyEntries,
      maintenance,
      newBookingsEnabled,
    } = config;
    await tx.set(
      "settings",
      "booking",
      stamped(
        {
          timeZone,
          resourceId,
          bookingDays,
          stepMinutes,
          maxFuture,
          maxDailyEntries,
          maintenance,
          newBookingsEnabled,
        },
        now,
      ),
    );
    for (const s of config.services)
      await tx.set("services", s._id, stamped(s, now));
    for (const h of config.businessHours)
      await tx.set(
        "business_hours",
        `${resourceId}:${h.dayOfWeek}`,
        stamped({ ...h, resourceId, version: 1 }, now),
      );
  });
  return generateDays(db, now);
}
export async function blockDay(
  db: Store,
  date: string,
  actorId: string,
  now: number,
) {
  return setDayClosed(db, { date }, actorId, now, true);
}

export interface MaintenanceLimits {
  /** Soft deadline: an already running database call is allowed to finish. */
  maxDurationMs?: number;
  maxRecords?: number;
  batchSize?: number;
  /** Injectable wall clock, independent of the business timestamp being inspected. */
  clock?: () => number;
}
type StopReason = "complete" | "time-limit" | "record-limit" | "problem-limit";
function limits(options: MaintenanceLimits, defaultRecords: number) {
  const maxDurationMs = options.maxDurationMs ?? 45000;
  const maxRecords = options.maxRecords ?? defaultRecords;
  const batchSize = options.batchSize ?? 50;
  if (
    !Number.isInteger(maxDurationMs) ||
    maxDurationMs < 0 ||
    maxDurationMs > 45000 ||
    !Number.isInteger(maxRecords) ||
    maxRecords < 1 ||
    maxRecords > 20000 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100
  )
    fail("INVALID_ARGUMENT");
  const clock = options.clock ?? Date.now;
  const deadline = clock() + maxDurationMs;
  return { maxRecords, batchSize, expired: () => clock() >= deadline };
}

/** Drain expired documents in bounded batches; a later run resumes by querying leftovers. */
export async function cleanup(
  db: Store,
  now: number,
  options: MaintenanceLimits = {},
) {
  const budget = limits(options, 500);
  const collections: Record<
    string,
    { removed: number; scanned: number; hasMore: boolean | null }
  > = {
    rate_limits: { removed: 0, scanned: 0, hasMore: null },
    idempotency_records: { removed: 0, scanned: 0, hasMore: null },
  };
  let scanned = 0;
  let removed = 0;
  let stopReason: StopReason = "complete";
  for (const collection of Object.keys(collections)) {
    const report = collections[collection];
    while (report.hasMore !== false) {
      if (budget.expired()) {
        stopReason = "time-limit";
        break;
      }
      if (scanned >= budget.maxRecords) {
        stopReason = "record-limit";
        break;
      }
      const batchSize = Math.min(budget.batchSize, budget.maxRecords - scanned);
      // The extra row tells us whether this batch alone can empty the collection.
      const rows = await db.query(collection, {
        before: { field: "expiresAt", value: now },
        limit: batchSize + 1,
      });
      report.hasMore = rows.length > 0;
      const batch = rows.slice(0, batchSize);
      let processed = 0;
      for (const row of batch) {
        if (budget.expired()) {
          stopReason = "time-limit";
          break;
        }
        const deleted = await db.transaction(async (tx) => {
          const current = await tx.get(collection, row._id);
          if (!current || !(current.expiresAt < now)) return false;
          await tx.remove(collection, row._id);
          return true;
        });
        // Transaction callbacks can run repeatedly. Count only committed results.
        scanned++;
        report.scanned++;
        processed++;
        if (deleted) {
          removed++;
          report.removed++;
        }
      }
      if (processed === batch.length && rows.length <= batchSize)
        report.hasMore = false;
      if (stopReason !== "complete") break;
    }
    if (stopReason !== "complete") break;
  }
  const complete = Object.values(collections).every((x) => x.hasMore === false);
  return {
    removed,
    scanned,
    complete,
    backlog: !complete,
    stopReason,
    collections,
  };
}

class InspectionStopped extends Error {
  constructor(readonly reason: Exclude<StopReason, "complete">) {
    super(reason);
  }
}
/** Booking-window occupancy + all users' future quota references, not a historical restore audit.
 * Multiple reads are not a snapshot; repeat under maintenance before relying on a clean result.
 */
export async function reconcile(
  db: Store,
  now: number,
  options: MaintenanceLimits = {},
) {
  const budget = limits(options, 5000);
  const c = await settings(db);
  const fromDate = localDate(now, c.timeZone);
  const throughDate = addDays(fromDate, c.bookingDays - 1);
  const problems: string[] = [];
  const scanned = {
    days: 0,
    appointments: 0,
    intervals: 0,
    users: 0,
    quotaEntries: 0,
  };
  let total = 0;
  let stopReason: StopReason = "complete";
  function checkTime() {
    if (budget.expired()) throw new InspectionStopped("time-limit");
  }
  function consume(kind: keyof typeof scanned) {
    checkTime();
    if (total >= budget.maxRecords) throw new InspectionStopped("record-limit");
    total++;
    scanned[kind]++;
  }
  function problem(message: string) {
    problems.push(message);
    if (problems.length >= 200) throw new InspectionStopped("problem-limit");
  }
  async function get(collection: string, id: string) {
    checkTime();
    return db.get(collection, id);
  }
  async function* pages(collection: string, equals?: Doc) {
    let idAfter: string | undefined;
    while (true) {
      checkTime();
      const query: Query = {
        equals,
        idAfter,
        order: [{ field: "_id", direction: "asc" }],
        limit: budget.batchSize,
      };
      const rows = await db.query(collection, query);
      if (!rows.length) return;
      yield rows;
      if (rows.length < budget.batchSize) return;
      const next = rows[rows.length - 1]._id;
      // A broken adapter/cursor must not create an unbounded loop or a clean report.
      if (typeof next !== "string" || (idAfter && next <= idAfter))
        throw new Error("INVALID_SCAN_CURSOR");
      idAfter = next;
    }
  }
  try {
    for (let i = 0; i < c.bookingDays; i++) {
      consume("days");
      const date = addDays(fromDate, i);
      const day = await get("resource_days", `${c.resourceId}:${date}`);
      if (!day) {
        problem(`${date}:missing-day`);
        continue;
      }
      const intervals: Doc[] = Array.isArray(day.intervals)
        ? day.intervals
        : [];
      if (!Array.isArray(day.intervals)) problem(`${date}:invalid-intervals`);
      const byAppointment = new Map<string, Doc[]>();
      const sorted: { startTime: number; endTime: number }[] = [];
      for (const interval of intervals) {
        consume("intervals");
        if (
          !interval ||
          typeof interval.appointmentId !== "string" ||
          !Number.isFinite(interval.startTime) ||
          !Number.isFinite(interval.endTime) ||
          interval.startTime >= interval.endTime
        ) {
          problem(`${date}:invalid-interval`);
          continue;
        }
        byAppointment.set(interval.appointmentId, [
          ...(byAppointment.get(interval.appointmentId) || []),
          interval,
        ]);
        sorted.push({
          startTime: interval.startTime,
          endTime: interval.endTime,
        });
      }
      sorted.sort((a, b) => a.startTime - b.startTime);
      // Adjacent sorted intervals suffice to detect whether any collision exists.
      for (let j = 1; j < sorted.length; j++)
        if (overlap(sorted[j - 1], sorted[j])) problem(`${date}:overlap`);
      const found = new Set<string>();
      for await (const rows of pages("appointments", {
        resourceId: c.resourceId,
        localDate: date,
        status: "CONFIRMED",
      })) {
        for (const a of rows) {
          consume("appointments");
          found.add(a._id);
          const matches = (byAppointment.get(a._id) || []).filter(
            (x) => x.startTime === a.startTime && x.endTime === a.endTime,
          );
          if (matches.length !== 1 || byAppointment.get(a._id)?.length !== 1)
            problem(`${a._id}:occupancy`);
          const user = await get("users", a.userId);
          const quota = Array.isArray(user?.futureAppointments)
            ? user.futureAppointments
            : [];
          if (
            a.startTime > now &&
            quota.filter(
              (x: Doc) =>
                x?.appointmentId === a._id && x.startTime === a.startTime,
            ).length !== 1
          )
            problem(`${a._id}:quota`);
          const idem = await get("idempotency_records", a.idempotencyId);
          if (!idem || idem.appointmentId !== a._id || idem.userId !== a.userId)
            problem(`${a._id}:idempotency`);
        }
      }
      for (const id of byAppointment.keys())
        if (!found.has(id)) problem(`${id}:orphan`);
    }
    // The forward appointment scan cannot discover quota entries pointing to no appointment.
    for await (const users of pages("users")) {
      for (const user of users) {
        consume("users");
        if (!Array.isArray(user.futureAppointments)) {
          problem(`${user._id}:invalid-quota`);
          continue;
        }
        const seen = new Set<string>();
        let futureCount = 0;
        for (const entry of user.futureAppointments) {
          consume("quotaEntries");
          if (
            !entry ||
            typeof entry.appointmentId !== "string" ||
            !entry.appointmentId ||
            !Number.isFinite(entry.startTime)
          ) {
            problem(`${user._id}:invalid-quota-entry`);
            continue;
          }
          // Old entries are lazily pruned by create; they no longer consume future quota.
          if (entry.startTime <= now) continue;
          futureCount++;
          const label = `${user._id}/${entry.appointmentId}`;
          if (seen.has(entry.appointmentId))
            problem(`${label}:quota-duplicate`);
          seen.add(entry.appointmentId);
          const a = await get("appointments", entry.appointmentId);
          if (!a) {
            problem(`${label}:quota-orphan`);
            continue;
          }
          if (a.status !== "CONFIRMED") problem(`${label}:quota-status`);
          if (a.userId !== user._id) problem(`${label}:quota-owner`);
          if (a.startTime !== entry.startTime) problem(`${label}:quota-time`);
        }
        if (futureCount > c.maxFuture) problem(`${user._id}:quota-limit`);
      }
    }
    checkTime();
  } catch (error) {
    if (!(error instanceof InspectionStopped)) throw error;
    stopReason = error.reason;
  }
  const complete = stopReason === "complete";
  return {
    ok: complete && problems.length === 0,
    complete,
    stopReason,
    scope: {
      kind: "booking-window-and-future-quota",
      resourceId: c.resourceId,
      fromDate,
      throughDate,
    },
    scanned: { ...scanned, total },
    problems,
  };
}
