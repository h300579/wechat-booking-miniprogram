import test from "node:test";
import assert from "node:assert/strict";
import { CloudStore } from "../server/cloud-store";
import { MemoryStore } from "./memory";
import { applyBudgetSample } from "../server/budget";
import { reserveImage, claimImage, finishImage } from "../server/images";
test("CloudBase adapter stops after exactly three conflicts, rolls back each attempt", async () => {
  const store = new CloudStore("test");
  let starts = 0,
    rollbacks = 0;
  (store as any).db = {
    startTransaction: async () => {
      starts++;
      return {
        commit: async () => {
          throw { code: "DATABASE_TRANSACTION_CONFLICT" };
        },
        rollback: async () => {
          rollbacks++;
        },
      };
    },
  };
  await assert.rejects(
    store.transaction(async () => 1),
    { code: "SERVICE_BUSY" },
  );
  assert.equal(starts, 3);
  assert.equal(rollbacks, 3);
});
test("CloudBase adapter never retries an ambiguous technical commit failure", async () => {
  const store = new CloudStore("test");
  let starts = 0;
  (store as any).db = {
    startTransaction: async () => {
      starts++;
      return {
        commit: async () => {
          throw new Error("response lost");
        },
        rollback: async () => {},
      };
    },
  };
  await assert.rejects(store.transaction(async () => 1));
  assert.equal(starts, 1);
});
test("budget thresholds deduplicate alerts and close new booking at 90%", async () => {
  const db = new MemoryStore();
  await db.set("settings", "booking", { newBookingsEnabled: true });
  let now = 1;
  for (const used of [50, 80, 90]) {
    const r = await applyBudgetSample(
      db,
      { used, quota: 100, period: "2026-09" },
      now++,
    );
    assert.equal(r.notify, true);
    assert.equal(r.level, used);
    assert.equal(
      (
        await applyBudgetSample(
          db,
          { used, quota: 100, period: "2026-09" },
          now++,
        )
      ).notify,
      false,
    );
  }
  assert.equal(
    (await db.get("settings", "booking"))!.newBookingsEnabled,
    false,
  );
});
test("images enforce project capacity, one-time authorization and owner", async () => {
  const db = new MemoryStore();
  await db.set("settings", "booking", { newBookingsEnabled: true });
  await db.set("services", "s", { name: "s" });
  const r = await Promise.allSettled(
    Array.from({ length: 8 }, () => reserveImage(db, "admin", "s", 1024, 1000)),
  );
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 6);
  const first = (r[0] as PromiseFulfilledResult<{ id: string }>).value;
  await assert.rejects(claimImage(db, first.id, "stranger", 1001), {
    code: "FORBIDDEN",
  });
  await claimImage(db, first.id, "admin", 1001);
  await assert.rejects(claimImage(db, first.id, "admin", 1002), {
    code: "FORBIDDEN",
  });
  await finishImage(db, first.id, "cloud://safe", 1003);
  await assert.rejects(finishImage(db, first.id, "cloud://safe", 1004), {
    code: "FORBIDDEN",
  });
  await assert.rejects(
    reserveImage(db, "admin", "s", 2 * 1024 * 1024 + 1, 1000),
    { code: "INVALID_ARGUMENT" },
  );
});
