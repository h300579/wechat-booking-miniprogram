import {
  merchantDay,
  merchantList,
  merchantDetail,
  merchantDashboard,
  setDayClosed,
} from "./merchant";
import cloud from "wx-server-sdk";
import { CloudStore } from "./cloud-store";
import { principal } from "./security";
import { fields, str, fail, BusinessError, uuid, object } from "./common";
import { generateDays, cleanup, blockDay, reconcile } from "./operations";
import { cancel } from "./appointment";
cloud.init({ env: process.env.TCB_ENV || process.env.SCF_NAMESPACE });
export async function main(event: unknown) {
  const requestId = uuid();
  try {
    const env = process.env.TCB_ENV || process.env.SCF_NAMESPACE;
    if (!env || !process.env.WECHAT_APP_ID) fail("MAINTENANCE");
    const db = new CloudStore(env);
    const identity = principal(
      cloud.getWXContext(),
      process.env.WECHAT_APP_ID || "",
    );
    const envelope = object(event);
    const e = { action: str(envelope.action), data: envelope.data };
    const role = await db.get("admin_roles", identity);
    const user = role?.userId ? await db.get("users", role!.userId) : null;
    const account = role?.userId
      ? await db.get("wechat_accounts", identity)
      : null;
    const allowed =
      role?.status === "ACTIVE" &&
      user?.status === "ACTIVE" &&
      account?.userId === role?.userId;
    if (e.action === "getMyMerchantRole") {
      fields(e.data || {}, []);
      return { code: "OK", data: { isMerchant: !!allowed }, requestId };
    }
    if (!allowed) fail("FORBIDDEN");
    const p = e.data || {};
    if (
      ["generateDays", "cleanup", "reconcile", "getMerchantDashboard"].includes(
        e.action,
      )
    )
      fields(p, []);
    let data;
    switch (e.action) {
      case "getMerchantDashboard":
        data = await merchantDashboard(db, Date.now());
        break;
      case "getMerchantAppointments":
        data = await merchantList(db, p, Date.now());
        break;
      case "getMerchantAppointment":
        data = await merchantDetail(db, p, Date.now());
        break;
      case "getMerchantDay":
        data = await merchantDay(db, p, Date.now());
        break;
      case "closeDay":
        data = await setDayClosed(db, p, role!.userId, Date.now(), true);
        break;
      case "reopenDay":
        data = await setDayClosed(db, p, role!.userId, Date.now(), false);
        break;
      case "generateDays":
        data = await generateDays(db, Date.now());
        break;
      case "cleanup":
        data = await cleanup(db, Date.now());
        break;
      case "reconcile":
        data = await reconcile(db, Date.now());
        break;
      case "blockDay":
        data = await blockDay(
          db,
          str(fields(p, ["date"]).date),
          role!.userId,
          Date.now(),
        );
        break;
      case "cancelAppointment":
        data = await cancel(db, role!.userId, p, Date.now(), true);
        break;
      default:
        fail("INVALID_ARGUMENT");
    }
    return { code: "OK", data, requestId };
  } catch (e) {
    return {
      code: e instanceof BusinessError ? e.code : "SERVICE_BUSY",
      data: null,
      requestId,
    };
  }
}
