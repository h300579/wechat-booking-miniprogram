import { BusinessError, fail, hash, uuid, stamped } from "./common";
import { Store, Reader, Doc } from "./store";
export interface Identity {
  APPID?: string;
  OPENID?: string;
}
export function principal(ctx: Identity, appId: string) {
  if (!appId || ctx.APPID !== appId || !ctx.OPENID) fail("UNAUTHENTICATED");
  return hash(`${ctx.APPID}:${ctx.OPENID}`);
}
export async function ensureUser(db: Store, identity: string, now: number) {
  return db.transaction(async (tx) => {
    const account = await tx.get("wechat_accounts", identity);
    if (account) {
      const user = await tx.get("users", account.userId);
      if (!user || user.status !== "ACTIVE") fail("FORBIDDEN");
      return user;
    }
    const user: Doc = {
      _id: uuid(),
      ...stamped(
        { nickname: "微信用户", status: "ACTIVE", futureAppointments: [] },
        now,
      ),
    };
    await tx.set("users", user._id, user);
    await tx.set(
      "wechat_accounts",
      identity,
      stamped({ userId: user._id }, now),
    );
    return user;
  });
}
export async function activeUser(tx: Reader, id: string) {
  const u = await tx.get("users", id);
  if (!u || u.status !== "ACTIVE") fail("FORBIDDEN");
  return u;
}
export type Limit = { key: string; seconds: number; max: number };
export async function counters(tx: Reader, limits: Limit[], now: number) {
  const rows = [];
  for (const limit of limits) {
    const start =
      Math.floor(now / (limit.seconds * 1000)) * limit.seconds * 1000;
    const id = hash(`${limit.key}:${limit.seconds}:${start}`);
    const row = await tx.get("rate_limits", id);
    if ((row?.count || 0) >= limit.max)
      throw new BusinessError(
        "RATE_LIMITED",
        Math.max(1, Math.ceil((start + limit.seconds * 1000 - now) / 1000)),
      );
    rows.push({
      id,
      count: (row?.count || 0) + 1,
      expiresAt: start + limit.seconds * 1000,
      createdAt: row?.createdAt || now,
    });
  }
  for (const row of rows)
    await tx.set("rate_limits", row.id, { ...row, updatedAt: now });
}
export async function rate(
  db: Store,
  identity: string,
  action: string,
  now: number,
) {
  let limits: Limit[] = [
    { key: `${identity}:${action}`, seconds: 60, max: 60 },
    { key: "global:entry", seconds: 1, max: 20 },
  ];
  if (action === "getAvailability")
    limits.push({ key: `${identity}:${action}:second`, seconds: 1, max: 10 });
  if (action === "createAppointment") limits[0].max = 10;
  if (action === "cancelAppointment") {
    limits[0].max = 5;
    limits.push({ key: `${identity}:${action}`, seconds: 86400, max: 20 });
  }
  if (["createAppointment", "cancelAppointment"].includes(action))
    limits.push({ key: "global:writes", seconds: 1, max: 5 });
  await db.transaction((tx) => counters(tx, limits, now));
}
export async function newIntent(
  db: Store,
  userId: string,
  id: string,
  now: number,
) {
  await db.transaction(async (tx) => {
    const key = hash(`new-intent:${id}`);
    if (await tx.get("rate_limits", key)) return;
    await counters(
      tx,
      [
        { key: `${userId}:new`, seconds: 60, max: 2 },
        { key: `${userId}:new`, seconds: 86400, max: 10 },
      ],
      now,
    );
    await tx.set(
      "rate_limits",
      key,
      stamped({ count: 1, expiresAt: now + 7 * 86400000 }, now),
    );
  });
}
export function publicAppointment(a: Doc) {
  const { userId, idempotencyId, resourceId, ...safe } = a;
  return safe;
}
