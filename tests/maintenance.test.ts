import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanup, reconcile, seed } from "../server/operations";
import { create, cancel } from "../server/appointment";
import { ensureUser } from "../server/security";
import { Reader } from "../server/store";
import { MemoryStore } from "./memory";

const now = Date.parse("2026-09-11T00:00:00Z");
const config = {
  ...JSON.parse(readFileSync("config/development.example.json", "utf8")),
  environmentId: "test",
};
async function setup() {
  const db = new MemoryStore();
  await seed(db, config, now);
  const user = await ensureUser(db, "quota-user", now);
  return { db, user };
}
async function expired(db: MemoryStore, collection: string, count: number) {
  for (let i = 0; i < count; i++) {
    await db.set(collection, `expired-${String(i).padStart(4, "0")}`, {
      expiresAt: now - 1,
    });
  }
}
const booking = {
  serviceId: "service-60",
  startTime: "2026-09-12T06:00:00.000Z",
  idempotencyKey: "maintenance-test-booking",
};

test("cleanup drains 101 expired records per collection in multiple batches and preserves live records", async () => {
  const db = new MemoryStore();
  for (const c of ["rate_limits", "idempotency_records"]) {
    await expired(db, c, 101);
    await db.set(c, "not-expired", { expiresAt: now + 1 });
    await db.set(c, "exact-cutoff", { expiresAt: now });
  }
  const result = await cleanup(db, now);
  assert.equal(result.removed, 202);
  assert.equal(result.scanned, 202);
  assert.equal(result.complete, true);
  assert.equal(result.backlog, false);
  assert.equal(result.stopReason, "complete");
  for (const c of ["rate_limits", "idempotency_records"]) {
    assert.deepEqual(result.collections[c], {
      removed: 101,
      scanned: 101,
      hasMore: false,
    });
    assert.equal((await db.query(c, { limit: 500 })).length, 2);
  }
});

test("cleanup reports each collection's known or unchecked backlog at its record limit and resumes later", async () => {
  const db = new MemoryStore();
  await expired(db, "rate_limits", 101);
  await expired(db, "idempotency_records", 1);
  const first = await cleanup(db, now, { maxRecords: 60 });
  assert.equal(first.removed, 60);
  assert.equal(first.backlog, true);
  assert.equal(first.complete, false);
  assert.equal(first.stopReason, "record-limit");
  assert.equal(first.collections.rate_limits.hasMore, true);
  assert.equal(first.collections.idempotency_records.hasMore, null);
  const second = await cleanup(db, now);
  assert.equal(second.removed, 42);
  assert.equal(second.backlog, false);
});

test("cleanup stops starting work at the soft deadline and distinguishes unchecked collections", async () => {
  let elapsed = 0;
  class SlowStore extends MemoryStore {
    override async transaction<T>(fn: (tx: Reader) => Promise<T>): Promise<T> {
      const result = await super.transaction(fn);
      elapsed += 3;
      return result;
    }
  }
  const db = new SlowStore();
  await expired(db, "rate_limits", 101);
  const result = await cleanup(db, now, {
    clock: () => elapsed,
    maxDurationMs: 5,
  });
  assert.equal(result.removed, 2);
  assert.equal(result.stopReason, "time-limit");
  assert.equal(result.backlog, true);
  assert.equal(result.collections.rate_limits.hasMore, true);
  assert.equal(result.collections.idempotency_records.hasMore, null);
  const immediate = await cleanup(db, now, { maxDurationMs: 0 });
  assert.equal(immediate.removed, 0);
  assert.equal(immediate.collections.rate_limits.hasMore, null);
});

test("cleanup counts committed deletions once when the transaction callback is retried", async () => {
  class RetryingStore extends MemoryStore {
    callbackRuns = 0;
    override async transaction<T>(fn: (tx: Reader) => Promise<T>): Promise<T> {
      // First attempt reads the same state but is rolled back before commit.
      this.callbackRuns++;
      await fn({
        get: this.get.bind(this),
        set: async () => {},
        remove: async () => {},
      });
      return super.transaction(async (tx) => {
        this.callbackRuns++;
        return fn(tx);
      });
    }
  }
  const db = new RetryingStore();
  await expired(db, "rate_limits", 3);
  const result = await cleanup(db, now);
  assert.equal(db.callbackRuns, 6);
  assert.equal(result.removed, 3);
  assert.equal(result.collections.rate_limits.removed, 3);
  assert.equal(result.scanned, 3);
});

test("reconcile rejects three orphan quota entries even when there are no appointments to scan forward", async () => {
  const { db, user } = await setup();
  await db.set("users", user._id, {
    ...user,
    futureAppointments: [1, 2, 3].map((n) => ({
      appointmentId: `missing-${n}`,
      startTime: now + n * 3600000,
    })),
  });
  const result = await reconcile(db, now);
  assert.equal(result.ok, false);
  assert.equal(result.complete, true);
  assert.equal(
    result.problems.filter((p) => p.endsWith(":quota-orphan")).length,
    3,
  );
});

test("reconcile detects cancelled, foreign, mismatched-time and duplicate future quota references", async () => {
  const { db, user } = await setup();
  const first = await create(db, user._id, booking, now);
  const appointment = (await db.get("appointments", first.appointmentId))!;
  await cancel(db, user._id, { appointmentId: first.appointmentId }, now);
  const second = await create(
    db,
    user._id,
    { ...booking, idempotencyKey: "maintenance-test-booking-two" },
    now + 61000,
  );
  const other = await ensureUser(db, "different-owner", now);
  await db.set("users", user._id, {
    ...(await db.get("users", user._id)),
    futureAppointments: [
      { appointmentId: first.appointmentId, startTime: appointment.startTime },
      { appointmentId: second.appointmentId, startTime: appointment.startTime },
      {
        appointmentId: second.appointmentId,
        startTime: appointment.startTime + 60000,
      },
    ],
  });
  await db.set("users", other._id, {
    ...other,
    futureAppointments: [
      { appointmentId: second.appointmentId, startTime: appointment.startTime },
    ],
  });
  const result = await reconcile(db, now);
  assert.equal(result.complete, true);
  for (const problem of [
    "quota-status",
    "quota-owner",
    "quota-time",
    "quota-duplicate",
  ])
    assert.ok(
      result.problems.some((p) => p.endsWith(`:${problem}`)),
      problem,
    );
  assert.equal(result.ok, false);
});

test("reconcile accepts consistent bookings and tolerates lazily retained past quota entries", async () => {
  const { db, user } = await setup();
  await create(db, user._id, booking, now);
  const current = (await db.get("users", user._id))!;
  await db.set("users", user._id, {
    ...current,
    futureAppointments: [
      ...current.futureAppointments,
      { appointmentId: "historical-retained", startTime: now - 1 },
    ],
  });
  const result = await reconcile(db, now, { batchSize: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.problems, []);
  assert.equal(result.scope.kind, "booking-window-and-future-quota");
});

test("reconcile paginates all users and finds quota damage beyond the first page", async () => {
  const { db } = await setup();
  for (let i = 0; i < 121; i++)
    await db.set("users", `paged-user-${String(i).padStart(3, "0")}`, {
      futureAppointments:
        i === 120
          ? [{ appointmentId: "last-page-orphan", startTime: now + 3600000 }]
          : [],
    });
  const result = await reconcile(db, now, { batchSize: 50 });
  assert.equal(result.scanned.users, 122);
  assert.equal(result.complete, true);
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((p) => p.includes("last-page-orphan:quota-orphan")),
  );
});

test("reconcile paginates appointments and preserves occupancy and idempotency checks", async () => {
  const { db, user } = await setup();
  await create(db, user._id, booking, now);
  await create(
    db,
    user._id,
    {
      ...booking,
      startTime: "2026-09-12T07:00:00.000Z",
      idempotencyKey: "maintenance-next-booking",
    },
    now + 61000,
  );
  const clean = await reconcile(db, now, { batchSize: 1 });
  assert.equal(clean.ok, true);
  assert.equal(clean.scanned.appointments, 2);
  const appointments = await db.query("appointments", { limit: 10 });
  const last = appointments[1];
  await db.remove("idempotency_records", last.idempotencyId);
  const day = (await db.get("resource_days", "main:2026-09-12"))!;
  await db.set("resource_days", day._id, {
    ...day,
    intervals: day.intervals.filter((x: any) => x.appointmentId !== last._id),
  });
  const damaged = await reconcile(db, now, { batchSize: 1 });
  assert.ok(damaged.problems.includes(`${last._id}:occupancy`));
  assert.ok(damaged.problems.includes(`${last._id}:idempotency`));
});

test("reconcile never reports ok after the scan record limit or deadline truncates inspection", async () => {
  const { db } = await setup();
  const limited = await reconcile(db, now, { maxRecords: 2 });
  assert.equal(limited.complete, false);
  assert.equal(limited.ok, false);
  assert.equal(limited.stopReason, "record-limit");
  assert.equal(limited.scanned.total, 2);
  const expired = await reconcile(db, now, { maxDurationMs: 0 });
  assert.equal(expired.complete, false);
  assert.equal(expired.ok, false);
  assert.equal(expired.stopReason, "time-limit");
  assert.equal(expired.scanned.total, 0);
});
