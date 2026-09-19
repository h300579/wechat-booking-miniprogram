import { ENV } from "../../config/env";
import { catalog, descriptions } from "../../config/catalog";
import { Service } from "../../../shared/types";
import { call, errorText } from "../../utils/api";
import { money } from "../../utils/presentation";
Page({
  data: {
    isDevelopment: ENV.stage !== "production",
    storeName: ENV.storeName,
    id: "",
    service: null as Service | null,
    price: "",
    intro: "",
    note: "",
    error: "",
    loading: true,
    ready: false,
  },
  onLoad(q: Record<string, string | undefined>) {
    this.setData({ id: q.id || "" });
    const preview = catalog.find((s) => s._id === this.data.id);
    if (preview)
      this.setData({
        service: preview,
        price: money(preview.priceFen),
        intro: descriptions[preview._id]?.intro || "",
        note: descriptions[preview._id]?.note || "",
      });
    this.load();
  },
  async load() {
    this.setData({ loading: true, ready: false, error: "" });
    try {
      const s = await call<Service>("getService", { serviceId: this.data.id });
      this.setData({
        service: s,
        ready: true,
        price: money(s.priceFen),
        intro: descriptions[s._id]?.intro || "选择适合你的时间，预约到店服务。",
        note: descriptions[s._id]?.note || "请提前到店。服务开始前可在线取消。",
      });
    } catch (e) {
      this.setData({ error: errorText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  book() {
    if (!this.data.ready) return;
    wx.navigateTo({ url: `/pages/booking/select?id=${this.data.id}` });
  },
});
