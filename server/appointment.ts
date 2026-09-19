import { Service, Day, Appointment } from "../shared/types";
import { fields, str, fail, hash, overlap, stamped, uuid } from "./common";
import { Store, Reader, Doc } from "./store";
import {
  checkDate,
  localDate,
  label,
  startValue,
  toUTC,
  validDate,
} from "./time";
import { activeUser, newIntent, publicAppointment } from "./security";
export interface Settings {
  timeZone: string;
  resourceId: string;
  bookingDays: number;
  stepMinutes: number;
  maxFuture: number;
  maxDailyEntries: number;
  maintenance: boolean;
  newBookingsEnabled: boolean;
}
export async function settings(tx: Reader): Promise<Settings> {
  const c = await tx.get("settings", "booking");
  if (!c) fail("MAINTENANCE");
  if (
    !Number.isInteger(c.bookingDays) ||
    c.bookingDays < 1 ||
    c.bookingDays > 90 ||
    !Number.isInteger(c.stepMinutes) ||
    c.stepMinutes < 1 ||
    !Number.isInteger(c.maxFuture) ||
    c.maxFuture < 1 ||
    c.maxFuture > 10 ||
    !Number.isInteger(c.maxDailyEntries) ||
    c.maxDailyEntries < 1 ||
    c.maxDailyEntries > 500
  )
    fail("MAINTENANCE");
  return c as Settings;
}
export async function service(tx: Reader, id: string): Promise<Service> {
  const s = await tx.get("services", id);
  if (!s || s.status !== "ACTIVE") fail("SERVICE_UNAVAILABLE");
  if (
    !Number.isInteger(s.durationMinutes) ||
    s.durationMinutes <= 0 ||
    s.durationMinutes > 1440 ||
    !Number.isSafeInteger(s.priceFen) ||
    s.priceFen < 0
  )
    fail("SERVICE_UNAVAILABLE");
  return s as Service;
}
export function fits(day: Day, start: number, end: number) {
  const interval = { startTime: start, endTime: end };
  return (
    !day.manuallyClosed &&
    day.windows.some((w) => start >= w.startTime && end <= w.endTime) &&
    !day.blockedIntervals.some((i) => overlap(interval, i)) &&
    !day.intervals.some((i) => overlap(interval, i))
  );
}
export async function availability(db: Store, input: unknown, now: number) {
  const v = fields(input, ["serviceId", "date"]);
  const s = await service(db, str(v.serviceId));
  const c = await settings(db);
  if (c.maintenance) fail("MAINTENANCE");
  const date = validDate(v.date);
  checkDate(date, now, c.timeZone, c.bookingDays);
  const day = (await db.get(
    "resource_days",
    `${c.resourceId}:${date}`,
  )) as Day | null;
  if (!day) fail("SCHEDULE_UNAVAILABLE");
  const slots = [];
  const midnight = toUTC(date, "00:00", c.timeZone);
  for (const w of day.windows) {
    let start =
      midnight +
      Math.ceil((w.startTime - midnight) / (c.stepMinutes * 60000)) *
        c.stepMinutes *
        60000;
    for (
      ;
      start + s.durationMinutes * 60000 <= w.endTime;
      start += c.stepMinutes * 60000
    )
      if (start > now && fits(day, start, start + s.durationMinutes * 60000))
        slots.push({ startTime: start, label: label(start, c.timeZone) });
  }
  return {
    date,
    slots: c.newBookingsEnabled ? slots : [],
    revision: day.revision,
    durationMinutes: s.durationMinutes,
    priceFen: s.priceFen,
  };
}
export async function create(
  db: Store,
  userId: string,
  input: unknown,
  now: number,
) {
  const v = fields(input, ["serviceId", "startTime", "idempotencyKey"]);
  const serviceId = str(v.serviceId);
  const startTime = startValue(v.startTime);
  const key = str(v.idempotencyKey, 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail("INVALID_ARGUMENT");
  const c0 = await settings(db);
  const id = hash(`${userId}:create:v1:${key}`);
  const requestHash = hash(
    JSON.stringify([serviceId, startTime, c0.resourceId]),
  );
  const existing = await db.get("idempotency_records", id);
  if (existing) {
    if (existing.requestHash !== requestHash) fail("IDEMPOTENCY_KEY_REUSED");
    return existing.response;
  }
  await newIntent(db, userId, id, now);
  return db.transaction(async (tx) => {
    const old = await tx.get("idempotency_records", id);
    if (old) {
      if (old.requestHash !== requestHash) fail("IDEMPOTENCY_KEY_REUSED");
      return old.response;
    }
    const c = await settings(tx);
    if (c.maintenance || !c.newBookingsEnabled) fail("MAINTENANCE");
    if (c.resourceId !== c0.resourceId) fail("SERVICE_BUSY");
    const user = await activeUser(tx, userId);
    const s = await service(tx, serviceId);
    const date = localDate(startTime, c.timeZone);
    checkDate(date, now, c.timeZone, c.bookingDays);
    if (
      startTime <= now ||
      (startTime - toUTC(date, "00:00", c.timeZone)) %
        (c.stepMinutes * 60000) !==
        0
    )
      fail("INVALID_ARGUMENT");
    const endTime = startTime + s.durationMinutes * 60000;
    if (localDate(endTime - 1, c.timeZone) !== date) fail("INVALID_ARGUMENT");
    const dayId = `${c.resourceId}:${date}`;
    const day = (await tx.get("resource_days", dayId)) as Day | null;
    if (!day) fail("SCHEDULE_UNAVAILABLE");
    if (!fits(day, startTime, endTime)) fail("APPOINTMENT_TIME_CONFLICT");
    if (
      day.intervals.length >= c.maxDailyEntries ||
      Buffer.byteLength(JSON.stringify(day)) > 500000
    )
      fail("SERVICE_BUSY");
    const future = (user.futureAppointments || []).filter(
      (x: Doc) => x.startTime > now,
    );
    if (future.length >= c.maxFuture) fail("APPOINTMENT_QUOTA_EXCEEDED");
    const appointmentId = uuid();
    const appointment = {
      _id: appointmentId,
      userId,
      serviceId,
      serviceName: s.name,
      resourceId: c.resourceId,
      localDate: date,
      startTime,
      endTime,
      durationMinutes: s.durationMinutes,
      priceFen: s.priceFen,
      status: "CONFIRMED",
      idempotencyId: id,
      createdAt: now,
      updatedAt: now,
    } as Appointment;
    const response = { appointmentId };
    await tx.set("resource_days", dayId, {
      ...day,
      intervals: [...day.intervals, { appointmentId, startTime, endTime }],
      revision: day.revision + 1,
      updatedAt: now,
    });
    await tx.set("appointments", appointmentId, appointment);
    await tx.set("users", userId, {
      ...user,
      futureAppointments: [...future, { appointmentId, startTime }],
      updatedAt: now,
    });
    await tx.set(
      "idempotency_records",
      id,
      stamped(
        {
          userId,
          requestHash,
          appointmentId,
          response,
          expiresAt: Math.max(now + 7 * 86400000, endTime + 86400000),
        },
        now,
      ),
    );
    await tx.set(
      "audit_logs",
      uuid(),
      stamped(
        { actorId: userId, action: "CREATE_APPOINTMENT", appointmentId },
        now,
      ),
    );
    return response;
  });
}
export async function cancel(
  db: Store,
  userId: string,
  input: unknown,
  now: number,
  admin = false,
) {
  const v = fields(input, ["appointmentId"]);
  const id = str(v.appointmentId);
  return db.transaction(async (tx) => {
    const a = await tx.get("appointments", id);
    if (!a || (!admin && a.userId !== userId)) fail("FORBIDDEN");
    if (a.status === "CANCELLED") return publicAppointment(a);
    const user = admin
      ? await tx.get("users", a.userId)
      : await activeUser(tx, userId);
    if (!user) fail("SERVICE_BUSY");
    if (a.status !== "CONFIRMED") fail("FORBIDDEN");
    if (a.startTime <= now) fail("CANCELLATION_CLOSED");
    const dayId = `${a.resourceId}:${a.localDate}`;
    const day = await tx.get("resource_days", dayId);
    if (!day || !day.intervals.some((x: Doc) => x.appointmentId === id))
      fail("SERVICE_BUSY");
    const updated = { ...a, status: "CANCELLED", updatedAt: now };
    await tx.set("appointments", id, updated);
    await tx.set("resource_days", dayId, {
      ...day,
      intervals: day.intervals.filter((x: Doc) => x.appointmentId !== id),
      revision: day.revision + 1,
      updatedAt: now,
    });
    await tx.set("users", a.userId, {
      ...user,
      futureAppointments: (user.futureAppointments || []).filter(
        (x: Doc) => x.appointmentId !== id && x.startTime > now,
      ),
      updatedAt: now,
    });
    await tx.set(
      "audit_logs",
      uuid(),
      stamped(
        {
          actorId: userId,
          action: admin ? "ADMIN_CANCEL" : "CANCEL_APPOINTMENT",
          appointmentId: id,
        },
        now,
      ),
    );
    return publicAppointment(updated);
  });
}
