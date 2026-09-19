import { Store } from "./store";
import { BusinessError, fields, str, fail, uuid, object } from "./common";
import {
  Identity,
  principal,
  rate,
  ensureUser,
  publicAppointment,
} from "./security";
import { availability, create, cancel, service } from "./appointment";
import { Result } from "../shared/types";
const actions = [
  "ensureUser",
  "listServices",
  "getService",
  "getAvailability",
  "createAppointment",
  "listMyAppointments",
  "getAppointment",
  "cancelAppointment",
];
export function api(db: Store, appId: string, clock = Date.now) {
  return async (event: unknown, ctx: Identity): Promise<Result> => {
    const requestId = uuid();
    let stage = "identity";
    const diagnostic = (code: string) => console.info(JSON.stringify({
      marker: "booking-diagnostic-v1", requestId, stage, code,
    }));
    try {
      const identity = principal(ctx, appId);
      // Runtime metadata is ignored; only WXContext supplies identity.
      stage = "envelope";
      const envelope = object(event);
      const e = {action: envelope.action, data: envelope.data};
      const action = str(e.action);
      if (!actions.includes(action)) fail("INVALID_ARGUMENT");
      const now = clock();
      stage = "rate";
      await rate(db, identity, action, now);
      stage = "ensureUser";
      const user = await ensureUser(db, identity, now);
      stage = action;
      const v = e.data || {};
      let data: unknown;
      switch (action) {
        case "ensureUser":
          fields(v, []);
          data = { userId: user._id, nickname: user.nickname };
          break;
        case "listServices": {
          const p = fields(v, ["cursor"]);
          const cursor = p.cursor ? str(p.cursor) : "";
          const rows = await db.query("services", {
            equals: { status: "ACTIVE" },
            idAfter: cursor,
            order: [{ field: "_id", direction: "asc" }],
            limit: 21,
          });
          const remaining = rows.filter((s) => s._id > cursor);
          data = {
            items: remaining.slice(0, 20).map((s) => ({
              _id: s._id,
              name: s.name,
              durationMinutes: s.durationMinutes,
              priceFen: s.priceFen,
              status: s.status,
              version: s.version,
            })),
            nextCursor: remaining.length > 20 ? remaining[19]._id : null,
          };
          break;
        }
        case "getService": {
          const p = fields(v, ["serviceId"]);
          const s = await service(db, str(p.serviceId));
          data = {
            _id: s._id,
            name: s.name,
            durationMinutes: s.durationMinutes,
            priceFen: s.priceFen,
            status: s.status,
            version: s.version,
          };
          break;
        }
        case "getAvailability":
          data = await availability(db, v, now);
          break;
        case "createAppointment":
          data = await create(db, user._id, v, now);
          break;
        case "cancelAppointment":
          data = await cancel(db, user._id, v, now);
          break;
        case "getAppointment": {
          const p = fields(v, ["appointmentId"]);
          const a = await db.get("appointments", str(p.appointmentId));
          if (!a || a.userId !== user._id) fail("FORBIDDEN");
          data = publicAppointment(a);
          break;
        }
        case "listMyAppointments": {
          const p = fields(v, ["cursor"]);
          let after;
          if (p.cursor) {
            try {
              const parsed = JSON.parse(
                Buffer.from(str(p.cursor, 512), "base64url").toString(),
              );
              fields(parsed, ["createdAt", "id"]);
              if (!Number.isSafeInteger(parsed.createdAt))
                fail("INVALID_ARGUMENT");
              after = { createdAt: parsed.createdAt, id: str(parsed.id) };
            } catch {
              fail("INVALID_ARGUMENT");
            }
          }
          const rows = await db.query("appointments", {
            equals: { userId: user._id },
            after,
            order: [
              { field: "createdAt", direction: "desc" },
              { field: "_id", direction: "desc" },
            ],
            limit: 21,
          });
          const items = rows.slice(0, 20);
          const last = items[items.length - 1];
          data = {
            items: items.map(publicAppointment),
            nextCursor:
              rows.length > 20
                ? Buffer.from(
                    JSON.stringify({ createdAt: last.createdAt, id: last._id }),
                  ).toString("base64url")
                : null,
          };
          break;
        }
      }
      diagnostic("OK");
      return { code: "OK", data: data ?? null, requestId };
    } catch (error) {
      if (error instanceof BusinessError) {
        diagnostic(error.code);
        return {
          code: error.code,
          data: null,
          requestId,
          ...(error.retryAfterSeconds
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        };
      }
      diagnostic("SERVICE_BUSY");
      console.error(JSON.stringify({ requestId, code: "SERVICE_BUSY" }));
      return {
        code: "SERVICE_BUSY",
        data: null,
        requestId,
        retryAfterSeconds: 2,
      };
    }
  };
}
