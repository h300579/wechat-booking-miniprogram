import { Store, Doc } from "./store";
import { fields, str, fail, stamped, uuid } from "./common";
import { settings, fits } from "./appointment";
import { localDate, addDays, validDate, checkDate, label, toUTC } from "./time";

// Bounded reads use _id pagination so SDK default page limits cannot truncate a day.
async function rows(db: Store, collection: string, equals: Doc, cap: number) {
  const result: Doc[] = [];
  let cursor = "";
  while (result.length <= cap) {
    const page = await db.query(collection, {
      equals,
      idAfter: cursor || undefined,
      order: [{ field: "_id", direction: "asc" }],
      limit: Math.min(100, cap + 1 - result.length),
    });
    result.push(...page);
    if (result.length > cap) fail("MERCHANT_QUERY_TOO_LARGE");
    if (
      !page.length ||
      page.length < Math.min(100, cap + 1 - (result.length - page.length))
    )
      break;
    cursor = page[page.length - 1]._id;
  }
  return result;
}
function view(a: Doc, zone: string, now: number) {
  return {
    appointmentId: a._id,
    serviceName: a.serviceName,
    customerLabel: `微信用户 · #${String(a._id).replace(/-/g, "").slice(-6).toUpperCase()}`,
    localDate: a.localDate,
    startTime: a.startTime,
    endTime: a.endTime,
    timeLabel: `${label(a.startTime, zone)} – ${label(a.endTime, zone)}`,
    price: (a.priceFen / 100).toFixed(2),
    durationMinutes: a.durationMinutes,
    status: a.status,
    statusLabel:
      a.status === "CANCELLED"
        ? "已取消"
        : a.startTime <= now
          ? "预约时间已过"
          : "待开始",
    canCancel: a.status === "CONFIRMED" && a.startTime > now,
  };
}
export async function merchantList(db: Store, input: unknown, now: number) {
  const p = fields(input, ["date"]);
  const date = validDate(p.date);
  const c = await settings(db);
  const items = await rows(
    db,
    "appointments",
    { resourceId: c.resourceId, localDate: date },
    200,
  );
  items.sort(
    (a, b) => a.startTime - b.startTime || String(a._id).localeCompare(b._id),
  );
  return {
    items: items.map((a) => view(a, c.timeZone, now)),
    total: items.length,
    complete: true,
    serverNow: now,
  };
}
export async function merchantDetail(db: Store, input: unknown, now: number) {
  const p = fields(input, ["appointmentId"]);
  const c = await settings(db);
  const a = await db.get("appointments", str(p.appointmentId));
  if (!a || a.resourceId !== c.resourceId) fail("FORBIDDEN");
  return view(a, c.timeZone, now);
}
export async function merchantDay(db: Store, input: unknown, now: number) {
  const p = fields(input, ["date"]);
  const c = await settings(db);
  const today = localDate(now, c.timeZone);
  const date = p.date === undefined ? today : validDate(p.date);
  const endDate = addDays(today, c.bookingDays - 1);
  const day = await db.get("resource_days", `${c.resourceId}:${date}`);
  let state = "NOT_GENERATED";
  const eligible =
    date >= today && date <= endDate && !!day && day.windows.length > 0;
  if (day) {
    if (!day.windows.length) state = "REST_DAY";
    else if (c.maintenance || !c.newBookingsEnabled) state = "MAINTENANCE";
    else if (day.manuallyClosed) state = "MANUALLY_CLOSED";
    else if (date < today) state = "HISTORICAL";
    else if (day.windows.every((w: Doc) => w.endTime <= now))
      state = "BUSINESS_ENDED";
    else {
      const services = await rows(db, "services", { status: "ACTIVE" }, 200);
      if (!services.length) state = "NO_SERVICES";
      else {
        let possibleWithoutBookings = false,
          available = false;
        const midnight = toUTC(date, "00:00", c.timeZone);
        for (const service of services) {
          if (
            !Number.isSafeInteger(service.durationMinutes) ||
            service.durationMinutes <= 0 ||
            service.durationMinutes > 1440
          )
            fail("SERVICE_BUSY");
          for (const w of day.windows) {
            for (
              let start =
                midnight +
                Math.ceil((w.startTime - midnight) / (c.stepMinutes * 60000)) *
                  c.stepMinutes *
                  60000;
              start + service.durationMinutes * 60000 <= w.endTime;
              start += c.stepMinutes * 60000
            ) {
              if (start <= now) continue;
              const end = start + service.durationMinutes * 60000;
              if (fits({ ...day, intervals: [] } as any, start, end))
                possibleWithoutBookings = true;
              if (fits(day as any, start, end)) {
                available = true;
                break;
              }
            }
            if (available) break;
          }
          if (available) break;
        }
        state = available
          ? "AVAILABLE"
          : possibleWithoutBookings
            ? "FULLY_BOOKED"
            : "NO_SLOTS";
      }
    }
  }
  const names: Record<string, string> = {
    NOT_GENERATED: "尚未生成",
    REST_DAY: "休息",
    MAINTENANCE: "预约服务已暂停",
    MANUALLY_CLOSED: "已关闭",
    HISTORICAL: "历史日期",
    BUSINESS_ENDED: "今日营业已结束",
    NO_SERVICES: "暂无可预约服务",
    AVAILABLE: "可预约",
    FULLY_BOOKED: "已约满",
    NO_SLOTS: "已无可预约时段",
  };
  return {
    date,
    today,
    endDate,
    timeZone: c.timeZone,
    serverNow: now,
    state,
    stateLabel: names[state],
    manuallyClosed: !!day?.manuallyClosed,
    canClose: eligible && !day?.manuallyClosed,
    canReopen: eligible && !!day?.manuallyClosed,
  };
}
export async function merchantDashboard(db: Store, now: number) {
  const day = await merchantDay(db, {}, now);
  const c = await settings(db);
  // Active records are bounded independently of accumulated cancellation history.
  const active = await rows(
    db,
    "appointments",
    { resourceId: c.resourceId, localDate: day.today, status: "CONFIRMED" },
    500,
  );
  const upcoming = active
    .filter((a) => a.startTime > now)
    .sort(
      (a, b) => a.startTime - b.startTime || String(a._id).localeCompare(b._id),
    );
  return {
    ...day,
    activeCount: active.length,
    upcomingCount: upcoming.length,
    next: upcoming[0] ? view(upcoming[0], c.timeZone, now) : null,
  };
}
export async function setDayClosed(
  db: Store,
  input: unknown,
  actorId: string,
  now: number,
  closed: boolean,
) {
  const p = fields(input, ["date"]);
  const date = validDate(p.date);
  return db.transaction(async (tx) => {
    const c = await settings(tx);
    checkDate(date, now, c.timeZone, c.bookingDays);
    const id = `${c.resourceId}:${date}`;
    const day = await tx.get("resource_days", id);
    if (!day) fail("SCHEDULE_UNAVAILABLE");
    if (!day.windows.length) fail("REST_DAY");
    if (!!day.manuallyClosed === closed)
      return { date, manuallyClosed: closed };
    await tx.set("resource_days", id, {
      ...day,
      manuallyClosed: closed,
      revision: day.revision + 1,
      updatedAt: now,
    });
    await tx.set(
      "audit_logs",
      uuid(),
      stamped(
        { actorId, action: closed ? "CLOSE_DAY" : "REOPEN_DAY", date },
        now,
      ),
    );
    return { date, manuallyClosed: closed };
  });
}
