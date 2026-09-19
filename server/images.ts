import { Store } from "./store";
import { fail, uuid, stamped } from "./common";
export async function reserveImage(
  db: Store,
  actorId: string,
  serviceId: string,
  bytes: number,
  now: number,
) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 2 * 1024 * 1024)
    fail("INVALID_ARGUMENT");
  return db.transaction(async (tx) => {
    const c = await tx.get("settings", "booking");
    if (!c || !c.newBookingsEnabled) fail("MAINTENANCE");
    const service = await tx.get("services", serviceId);
    if (!service) fail("INVALID_ARGUMENT");
    const dailyId = `images:${actorId}:${new Date(now).toISOString().slice(0, 10)}`;
    const daily = await tx.get("settings", dailyId);
    const count = daily?.count || 0;
    const size = daily?.bytes || 0;
    const images = service.imageReservations || [];
    if (count >= 20 || size + bytes > 40 * 1024 * 1024 || images.length >= 6)
      fail("RATE_LIMITED");
    const id = uuid();
    const cloudPath = `published/services/${serviceId}/${id}.webp`;
    await tx.set(
      "upload_intents",
      id,
      stamped(
        {
          actorId,
          serviceId,
          cloudPath,
          maxBytes: bytes,
          status: "RESERVED",
          expiresAt: now + 300000,
          dailyId,
        },
        now,
      ),
    );
    await tx.set("settings", dailyId, {
      ...stamped({ count: count + 1, bytes: size + bytes }, now),
      createdAt: daily?.createdAt || now,
    });
    await tx.set("services", serviceId, {
      ...service,
      imageReservations: [...images, id],
      updatedAt: now,
    });
    return { id, cloudPath };
  });
}
export async function claimImage(
  db: Store,
  id: string,
  actorId: string,
  now: number,
) {
  return db.transaction(async (tx) => {
    const i = await tx.get("upload_intents", id);
    if (
      !i ||
      i.actorId !== actorId ||
      i.status !== "RESERVED" ||
      i.expiresAt <= now
    )
      fail("FORBIDDEN");
    await tx.set("upload_intents", id, {
      ...i,
      status: "UPLOADING",
      updatedAt: now,
    });
    return i;
  });
}
export async function finishImage(
  db: Store,
  id: string,
  fileId: string,
  now: number,
) {
  return db.transaction(async (tx) => {
    const i = await tx.get("upload_intents", id);
    if (!i || i.status !== "UPLOADING") fail("FORBIDDEN");
    const s = await tx.get("services", i.serviceId);
    if (!s) fail("INVALID_ARGUMENT");
    await tx.set("services", i.serviceId, {
      ...s,
      imageFileIds: [...(s.imageFileIds || []), fileId],
      updatedAt: now,
    });
    await tx.set("upload_intents", id, {
      ...i,
      status: "PUBLISHED",
      fileId,
      expiresAt: now + 7 * 86400000,
      updatedAt: now,
    });
    return { fileId };
  });
}

export async function cleanupImages(
  db: Store,
  now: number,
  deletePath: (path: string) => Promise<void>,
) {
  const candidates = await db.query("upload_intents", {
    before: { field: "expiresAt", value: now },
    limit: 50,
  });
  let removed = 0;
  for (const candidate of candidates) {
    const doomed = await db.transaction(async (tx) => {
      const i = await tx.get("upload_intents", candidate._id);
      if (!i || i.expiresAt >= now) return null;
      if (i.status === "PUBLISHED") {
        await tx.remove("upload_intents", i._id);
        return null;
      }
      if (i.status === "UPLOADING" && i.expiresAt + 86400000 >= now)
        return null;
      await tx.set("upload_intents", i._id, {
        ...i,
        status: "EXPIRING",
        updatedAt: now,
      });
      return i;
    });
    if (!doomed) continue;
    if (
      !/^published\/services\/[a-zA-Z0-9_-]{1,80}\/[0-9a-f-]{36}\.webp$/.test(
        doomed.cloudPath,
      )
    )
      throw new Error("Unexpected upload path");
    await deletePath(doomed.cloudPath);
    await db.transaction(async (tx) => {
      const i = await tx.get("upload_intents", doomed._id);
      if (!i || i.status !== "EXPIRING") return;
      const s = await tx.get("services", i.serviceId);
      const d = await tx.get("settings", i.dailyId);
      if (s)
        await tx.set("services", i.serviceId, {
          ...s,
          imageReservations: (s.imageReservations || []).filter(
            (x: string) => x !== i._id,
          ),
          updatedAt: now,
        });
      if (d)
        await tx.set("settings", i.dailyId, {
          ...d,
          count: Math.max(0, d.count - 1),
          bytes: Math.max(0, d.bytes - i.maxBytes),
          updatedAt: now,
        });
      await tx.remove("upload_intents", i._id);
    });
    removed++;
  }
  return { removed };
}
