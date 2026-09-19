import { ENV } from "../config/env";
import { PublicAppointment } from "../../shared/types";
// The first release supports Shanghai explicitly; the config validator rejects other zones.
function checkTimeZone() {
  if (ENV.timeZone !== "Asia/Shanghai")
    throw new Error("当前版本仅支持 Asia/Shanghai 时区");
}
export function money(priceFen: number) {
  return (priceFen / 100).toFixed(2);
}
export function dateRange(now = Date.now()) {
  if (!Number.isInteger(ENV.bookingDays) || ENV.bookingDays < 1)
    throw new Error("bookingDays 必须是正整数");
  return {
    date: dateKey(now),
    minDate: dateKey(now),
    endDate: dateKey(now + (ENV.bookingDays - 1) * 86400000),
  };
}
export function dateKey(n = Date.now()) {
  checkTimeZone();
  return new Date(n + 8 * 3600000).toISOString().slice(0, 10);
}
export function clock(n: number) {
  checkTimeZone();
  return new Date(n + 8 * 3600000).toISOString().slice(11, 16);
}
export function appointmentView(a: PublicAppointment) {
  return {
    ...a,
    price: money(a.priceFen),
    timeLabel: `${clock(a.startTime)} – ${clock(a.endTime)}`,
    dateLabel: a.localDate.replace(/-/g, "."),
    statusLabel:
      a.status === "CANCELLED"
        ? "已取消"
        : a.endTime < Date.now()
          ? "已结束"
          : "预约成功",
    canCancel: a.status === "CONFIRMED" && a.startTime > Date.now(),
  };
}
export function contact() {
  if (ENV.contactPhone) wx.makePhoneCall({ phoneNumber: ENV.contactPhone });
  else wx.showToast({ title: "请通过门店原有渠道联系", icon: "none" });
}
