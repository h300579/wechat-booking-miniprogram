import { Result } from "../../shared/types";
import { ENV } from "../config/env";
const messages: Record<string, string> = {
  MERCHANT_QUERY_TOO_LARGE: "当日记录较多，暂无法完整展示，请联系维护人员",
  REST_DAY: "休息日不能通过此操作开放",
  UNAUTHENTICATED: "微信身份验证失败，请重新进入小程序",
  FORBIDDEN: "无法访问这条预约",
  INVALID_ARGUMENT: "信息有误，请重新选择",
  RATE_LIMITED: "操作较频繁，请稍后再试",
  APPOINTMENT_TIME_CONFLICT: "这个时段刚被预约，请重新选择",
  IDEMPOTENCY_KEY_REUSED: "预约信息已变化，请重新选择时段",
  SERVICE_BUSY: "服务暂时繁忙，请稍后重试",
  MAINTENANCE: "预约服务暂时维护中，请稍后再来",
  SCHEDULE_UNAVAILABLE: "这一天暂未开放预约",
  SERVICE_UNAVAILABLE: "该项目暂不可预约",
  APPOINTMENT_QUOTA_EXCEEDED: `最多保留 ${ENV.maxFuture} 个未来预约，请先处理已有预约`,
  CANCELLATION_CLOSED: "预约已开始，无法在线取消",
  NOT_CONFIGURED: "预约服务正在准备中，暂未开放",
  NETWORK_ERROR: "网络连接中断，请重试",
};
export class ApiError extends Error {
  constructor(
    public code: string,
    public requestId = "",
    public retryAfterSeconds = 0,
  ) {
    super(messages[code] || "暂时无法完成，请稍后重试");
  }
}
const inFlight = new Map<string, Promise<unknown>>();
const cooldown = new Map<string, number>();
export function call<T>(
  action: string,
  data: Record<string, unknown> = {},
  functionName: "booking" | "operations" = "booking",
): Promise<T> {
  if (!ENV.id) return Promise.reject(new ApiError("NOT_CONFIGURED"));
  const actionKey = functionName + ":" + action;
  const wait = cooldown.get(actionKey) || 0;
  if (Date.now() < wait)
    return Promise.reject(
      new ApiError("RATE_LIMITED", "", Math.ceil((wait - Date.now()) / 1000)),
    );
  const key = JSON.stringify([functionName, action, data]);
  const current = inFlight.get(key);
  if (current) return current as Promise<T>;
  const promise = (async () => {
    let result: Result<T>;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const response = await Promise.race([
        wx.cloud.callFunction({
          name: functionName,
          data: { action, data },
          config: { env: ENV.id },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ApiError("NETWORK_ERROR")),
            12000,
          );
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      result = response.result as unknown as Result<T>;
    } catch {
      throw new ApiError("NETWORK_ERROR");
    }
    if (!result || typeof result.code !== "string")
      throw new ApiError("MAINTENANCE");
    if (result.code !== "OK") {
      if (result.retryAfterSeconds)
        cooldown.set(actionKey, Date.now() + result.retryAfterSeconds * 1000);
      throw new ApiError(
        result.code,
        result.requestId,
        result.retryAfterSeconds,
      );
    }
    return result.data as T;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
export const errorText = (e: unknown) =>
  e instanceof ApiError
    ? e.message +
      (e.retryAfterSeconds ? `（${e.retryAfterSeconds} 秒后重试）` : "")
    : "暂时无法完成，请稍后重试";

export const merchantCall = <T>(
  action: string,
  data: Record<string, unknown> = {},
) => call<T>(action, data, "operations");
