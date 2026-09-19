import { Store } from "./store";
import { stamped } from "./common";
// Adapter input must come from trusted monitoring/operations, never a mini program endpoint.
export async function applyBudgetSample(
  db: Store,
  sample: { used: number; quota: number; period: string },
  now: number,
) {
  if (
    !Number.isFinite(sample.used) ||
    !Number.isFinite(sample.quota) ||
    sample.used < 0 ||
    sample.quota <= 0 ||
    !/^\d{4}-\d{2}$/.test(sample.period)
  )
    throw new Error("Invalid budget sample");
  return db.transaction(async (tx) => {
    const id = `budget:${sample.period}`;
    const state = await tx.get("settings", id);
    const ratio = sample.used / sample.quota;
    const level = ratio >= 0.9 ? 90 : ratio >= 0.8 ? 80 : ratio >= 0.5 ? 50 : 0;
    const last = state?.level || 0;
    if (level >= 90) {
      const c = await tx.get("settings", "booking");
      if (c)
        await tx.set("settings", "booking", {
          ...c,
          newBookingsEnabled: false,
          updatedAt: now,
        });
    }
    await tx.set("settings", id, {
      ...stamped(
        {
          level: Math.max(level, last),
          used: sample.used,
          quota: sample.quota,
        },
        now,
      ),
      createdAt: state?.createdAt || now,
    });
    return {
      level,
      notify: level > last,
      stopNewBookings: level >= 90,
      message:
        level >= 90
          ? "资源达到 90%，已关闭新预约与图片上传"
          : level >= 80
            ? "资源达到 80%，检查异常流量并暂停非必要任务"
            : level >= 50
              ? "资源达到 50%，检查本月消耗趋势"
              : "",
    };
  });
}
