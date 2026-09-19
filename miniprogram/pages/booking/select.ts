import { ENV } from "../../config/env";
import { Availability, Service } from "../../../shared/types";
import { call, errorText, ApiError } from "../../utils/api";
import { dateKey, dateRange, money } from "../../utils/presentation";
interface Intent {
  key: string;
  serviceId: string;
  startTime: number;
  createdAt: number;
}
Page({
  data: {
    id: "",
    name: "",
    date: "",
    endDate: "",
    minDate: "",
    slots: [] as Availability["slots"],
    selected: 0,
    loading: false,
    submitting: false,
    error: "",
    duration: 0,
    price: "",
    pending: false,
    maxFuture: ENV.maxFuture,
  },
  requestSequence: 0,
  intent: null as Intent | null,
  onLoad(q: Record<string, string | undefined>) {
    this.setData({ id: q.id || "", ...dateRange() });
    const stored = wx.getStorageSync("bookingIntent") as Intent;
    if (
      stored &&
      stored.serviceId === this.data.id &&
      Date.now() - stored.createdAt < 7 * 86400000
    ) {
      this.intent = stored;
      this.setData({
        pending: true,
        selected: stored.startTime,
        date: dateKey(stored.startTime),
      });
    }
    this.load();
  },
  async load() {
    const seq = ++this.requestSequence;
    this.setData({ loading: true, error: "", slots: [] });
    try {
      const [s, a] = await Promise.all([
        call<Service>("getService", { serviceId: this.data.id }),
        call<Availability>("getAvailability", {
          serviceId: this.data.id,
          date: this.data.date,
        }),
      ]);
      if (seq !== this.requestSequence) return;
      this.setData({
        name: s.name,
        slots: a.slots,
        duration: a.durationMinutes,
        price: money(a.priceFen),
      });
    } catch (e) {
      if (seq === this.requestSequence) this.setData({ error: errorText(e) });
    } finally {
      if (seq === this.requestSequence) this.setData({ loading: false });
    }
  },
  changeDate(e: WechatMiniprogram.PickerChange) {
    if (this.data.pending || this.data.submitting) return;
    this.intent = null;
    this.setData({ date: String(e.detail.value), selected: 0 });
    this.load();
  },
  select(e: WechatMiniprogram.TouchEvent) {
    if (this.data.pending || this.data.submitting) return;
    this.intent = null;
    this.setData({ selected: Number(e.currentTarget.dataset.time), error: "" });
  },
  async submit() {
    if (this.data.submitting || !this.data.selected) return;
    this.setData({ submitting: true, error: "" });
    try {
      if (!this.intent) {
        const random = await new Promise<ArrayBuffer>((resolve, reject) =>
          wx.getRandomValues({
            length: 24,
            success: (r) => resolve(r.randomValues),
            fail: reject,
          }),
        );
        this.intent = {
          key: Array.from(new Uint8Array(random))
            .map((x) => x.toString(16).padStart(2, "0"))
            .join(""),
          serviceId: this.data.id,
          startTime: this.data.selected,
          createdAt: Date.now(),
        };
        wx.setStorageSync("bookingIntent", this.intent);
      }
      this.setData({ pending: true });
      const r = await call<{ appointmentId: string }>("createAppointment", {
        serviceId: this.intent.serviceId,
        startTime: new Date(this.intent.startTime).toISOString(),
        idempotencyKey: this.intent.key,
      });
      wx.removeStorageSync("bookingIntent");
      this.intent = null;
      wx.redirectTo({ url: `/pages/booking/result?id=${r.appointmentId}` });
    } catch (e) {
      this.setData({ error: errorText(e) });
      if (
        e instanceof ApiError &&
        [
          "APPOINTMENT_TIME_CONFLICT",
          "INVALID_ARGUMENT",
          "SERVICE_UNAVAILABLE",
          "IDEMPOTENCY_KEY_REUSED",
          "APPOINTMENT_QUOTA_EXCEEDED",
          "SCHEDULE_UNAVAILABLE",
          "MAINTENANCE",
        ].includes(e.code)
      ) {
        wx.removeStorageSync("bookingIntent");
        this.intent = null;
        this.setData({ pending: false, selected: 0 });
      }
    } finally {
      this.setData({ submitting: false });
    }
  },
  my() {
    wx.switchTab({ url: "/pages/appointment/list" });
  },
});
