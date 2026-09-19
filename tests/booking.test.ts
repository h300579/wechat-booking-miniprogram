import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "./memory";
import { seed, blockDay, generateDays, reconcile } from "../server/operations";
import { create, cancel, availability } from "../server/appointment";
import { ensureUser, principal, rate } from "../server/security";
import { api } from "../server/api";
import { toUTC, validDate } from "../server/time";
import { readFileSync } from "node:fs";
const now = Date.parse("2026-09-11T00:00:00Z");
const config = {
  ...JSON.parse(readFileSync("config/development.example.json", "utf8")),
  environmentId: "test",
};
const at = (clock: string, date = "2026-09-12") =>
  new Date(toUTC(date, clock, "Asia/Shanghai")).toISOString();
async function setup() {
  const db = new MemoryStore();
  await seed(db, config, now);
  const u = await ensureUser(db, "user-1", now);
  return { db, u };
}
const intent = (
  clock = "14:00",
  key = "abcdefghijklmnop",
  serviceId = "service-60",
) => ({ serviceId, startTime: at(clock), idempotencyKey: key });
test("50 concurrent overlapping bookings yield exactly one booking with consistent occupancy", async () => {
  const { db } = await setup();
  const users = [];
  for (let i = 0; i < 50; i++) users.push(await ensureUser(db, `p${i}`, now));
  const r = await Promise.allSettled(
    users.map((u, i) =>
      create(
        db,
        u._id,
        intent("14:00", `key-${String(i).padStart(20, "0")}`),
        now,
      ),
    ),
  );
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const a = await db.query("appointments", { limit: 100 });
  assert.equal(a.length, 1);
  assert.equal(
    (await db.get("resource_days", "main:2026-09-12"))!.intervals.length,
    1,
  );
  assert.equal((await reconcile(db, now)).ok, true);
  assert.ok(db.conflicts > 0);
});
test("overlap rejected; adjacent interval allowed", async () => {
  const { db, u } = await setup();
  await create(db, u._id, intent(), now);
  await assert.rejects(
    create(db, u._id, intent("14:30", "second-key-abcdefghijkl"), now),
    { code: "APPOINTMENT_TIME_CONFLICT" },
  );
  await create(
    db,
    u._id,
    intent("15:00", "third-key-abcdefghijkl", "service-30"),
    now + 61000,
  );
  assert.equal((await db.query("appointments", { limit: 10 })).length, 2);
});
test("same key concurrent retries return identical id; changed parameters rejected", async () => {
  const { db, u } = await setup();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => create(db, u._id, intent(), now)),
  );
  assert.equal(new Set(results.map((r) => r.appointmentId)).size, 1);
  await assert.rejects(create(db, u._id, intent("15:00"), now), {
    code: "IDEMPOTENCY_KEY_REUSED",
  });
  assert.equal((await db.query("appointments", { limit: 100 })).length, 1);
});
test("failure rolls back appointment occupancy quota and successful idempotency", async () => {
  const { db, u } = await setup();
  db.injectFailure = true;
  await assert.rejects(create(db, u._id, intent(), now));
  assert.equal(
    (await db.get("resource_days", "main:2026-09-12"))!.intervals.length,
    0,
  );
  assert.equal((await db.query("appointments", { limit: 10 })).length, 0);
  assert.equal(
    (await db.query("idempotency_records", { limit: 10 })).length,
    0,
  );
  assert.equal((await db.get("users", u._id))!.futureAppointments.length, 0);
});
test("cancel is atomic and repeatable; another user cannot cancel or inspect", async () => {
  const { db, u } = await setup();
  const r = await create(db, u._id, intent(), now);
  await assert.rejects(
    cancel(db, "other", { appointmentId: r.appointmentId }, now),
    { code: "FORBIDDEN" },
  );
  await Promise.all([
    cancel(db, u._id, { appointmentId: r.appointmentId }, now),
    cancel(db, u._id, { appointmentId: r.appointmentId }, now),
  ]);
  assert.equal(
    (await db.get("resource_days", "main:2026-09-12"))!.intervals.length,
    0,
  );
  assert.equal((await db.get("users", u._id))!.futureAppointments.length, 0);
  const result = await api(
    db,
    "app",
    () => now,
  )(
    { action: "getAppointment", data: { appointmentId: r.appointmentId } },
    { APPID: "app", OPENID: "other" },
  );
  assert.equal(result.code, "FORBIDDEN");
});
test("cannot cancel once started", async () => {
  const { db, u } = await setup();
  const r = await create(db, u._id, intent(), now);
  await assert.rejects(
    cancel(
      db,
      u._id,
      { appointmentId: r.appointmentId },
      Date.parse(at("14:00")),
    ),
    { code: "CANCELLATION_CLOSED" },
  );
});
test("past, malformed, misaligned, outside window and beyond horizon rejected", async () => {
  const { db, u } = await setup();
  for (const startTime of [
    "2026-02-30T04:00:00.000Z",
    "bad",
    "2026-09-10T04:00:00.000Z",
    "2026-12-01T04:00:00.000Z",
    at("14:15"),
  ])
    await assert.rejects(create(db, u._id, { ...intent(), startTime }, now));
  await assert.rejects(
    create(db, u._id, intent("18:30", "boundary-abcdefghijkl"), now + 61000),
    { code: "APPOINTMENT_TIME_CONFLICT" },
  );
  assert.throws(() => validDate("2026-02-30"));
});
test("missing day is never initialized by reservation; closed day and rest intervals excluded", async () => {
  const { db, u } = await setup();
  await db.remove("resource_days", "main:2026-09-12");
  await assert.rejects(create(db, u._id, intent(), now), {
    code: "SCHEDULE_UNAVAILABLE",
  });
  assert.equal(await db.get("resource_days", "main:2026-09-12"), null);
  await generateDays(db, now);
  await blockDay(db, "2026-09-12", "admin", now);
  assert.equal(
    (
      await availability(
        db,
        { serviceId: "service-60", date: "2026-09-12" },
        now,
      )
    ).slots.length,
    0,
  );
});
test("day generation never overwrites booked occupancy; closing booked day preserves occupancy", async () => {
  const { db, u } = await setup();
  await create(db, u._id, intent(), now);
  await generateDays(db, now);
  assert.equal(
    (await db.get("resource_days", "main:2026-09-12"))!.intervals.length,
    1,
  );
  await blockDay(db, "2026-09-12", "admin", now);
  const day = (await db.get("resource_days", "main:2026-09-12"))!;
  assert.equal(day.manuallyClosed, true);
  assert.equal(day.intervals.length, 1);
});
test("concurrent registration has a single business identity", async () => {
  const db = new MemoryStore();
  const users = await Promise.all(
    Array.from({ length: 30 }, () => ensureUser(db, "same", now)),
  );
  assert.equal(new Set(users.map((u) => u._id)).size, 1);
  assert.equal((await db.query("users", { limit: 100 })).length, 1);
});
test("trusted context mandatory and spoofed fields rejected", async () => {
  assert.throws(() => principal({ APPID: "fake", OPENID: "x" }, "app"), {
    code: "UNAUTHENTICATED",
  });
  const { db } = await setup();
  const run = api(db, "app", () => now);
  assert.equal(
    (
      await run(
        { action: "ensureUser", data: { userId: "admin" } },
        { APPID: "app", OPENID: "x" },
      )
    ).code,
    "INVALID_ARGUMENT",
  );
  assert.equal(
    (await run({ action: "ensureUser", data: {} }, {})).code,
    "UNAUTHENTICATED",
  );
});
test("shared rate limit across instances rejects excess; unavailable counter fails closed", async () => {
  const { db } = await setup();
  const r = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      rate(db, "same", "createAppointment", now),
    ),
  );
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 5);
  const broken = new MemoryStore();
  broken.transaction = async () => {
    throw new Error("offline");
  };
  assert.equal(
    (
      await api(
        broken,
        "app",
        () => now,
      )({ action: "ensureUser" }, { APPID: "app", OPENID: "x" })
    ).code,
    "SERVICE_BUSY",
  );
});
test("user future quota is not bypassed by concurrent writes", async () => {
  const { db, u } = await setup();
  await create(db, u._id, intent("10:00", "key-aaaaaaaaaaaaaaaa"), now);
  await create(db, u._id, intent("11:00", "key-bbbbbbbbbbbbbbbb"), now);
  const r = await Promise.allSettled([
    create(db, u._id, intent("12:00", "key-cccccccccccccccc"), now + 61000),
    create(db, u._id, intent("13:00", "key-dddddddddddddddd"), now + 61000),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await db.get("users", u._id))!.futureAppointments.length, 3);
});
test("service changes retain historical snapshot and privacy", async () => {
  const { db, u } = await setup();
  const r = await create(db, u._id, intent(), now);
  await db.set("services", "service-60", {
    ...config.services[1],
    priceFen: 500,
    durationMinutes: 30,
  });
  const a = await db.get("appointments", r.appointmentId);
  assert.equal(a!.priceFen, 19900);
  assert.equal(a!.durationMinutes, 60);
  const slots = await availability(
    db,
    { serviceId: "service-60", date: "2026-09-12" },
    now,
  );
  assert.ok(!JSON.stringify(slots).includes(u._id));
});
test("list pagination handles equal timestamps without repeats", async () => {
  const { db } = await setup();
  const user = await ensureUser(
    db,
    principal({ APPID: "app", OPENID: "pagination" }, "app"),
    now,
  );
  for (let i = 0; i < 45; i++)
    await db.set("appointments", String(i).padStart(3, "0"), {
      userId: user._id,
      createdAt: now,
      status: "CANCELLED",
    });
  const run = api(db, "app", () => now);
  const first: any = await run(
    { action: "listMyAppointments", data: {} },
    { APPID: "app", OPENID: "pagination" },
  );
  const second: any = await run(
    { action: "listMyAppointments", data: { cursor: first.data.nextCursor } },
    { APPID: "app", OPENID: "pagination" },
  );
  assert.equal(first.data.items.length, 20);
  assert.equal(
    new Set([...first.data.items, ...second.data.items].map((x: any) => x._id))
      .size,
    40,
  );
  assert.ok(first.data.items.every((x: any) => !("userId" in x)));
});

test("platform userInfo metadata is tolerated but never trusted for identity", async () => {
  const { db } = await setup();
  const run = api(db, "app", () => now);
  const first: any = await run(
    {
      action: "ensureUser",
      data: {},
      userInfo: { openId: "victim", appId: "fake" },
    },
    { APPID: "app", OPENID: "actual" },
  );
  assert.equal(first.code, "OK");
  const expected = await ensureUser(
    db,
    principal({ APPID: "app", OPENID: "actual" }, "app"),
    now,
  );
  assert.equal(first.data.userId, expected._id);
  const noContext = await run(
    {
      action: "ensureUser",
      data: {},
      userInfo: { openId: "actual", appId: "app" },
    },
    {},
  );
  assert.equal(noContext.code, "UNAUTHENTICATED");
});
