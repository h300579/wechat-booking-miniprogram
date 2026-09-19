import { ENV } from "../../config/env";
import { catalog, descriptions } from "../../config/catalog";
import { Service } from "../../../shared/types";
import { call, errorText } from "../../utils/api";
import { money, contact } from "../../utils/presentation";
Page({
  data: {
    isDevelopment: ENV.stage !== "production",
    storeName: ENV.storeName,
    storeMark: ENV.storeName.slice(0, 2),
    services: catalog.map((s) => ({
      ...s,
      price: money(s.priceFen),
      ...descriptions[s._id],
    })) as unknown[],
    loading: true,
    error: "",
    nextCursor: null as string | null,
  },
  onLoad() {
    wx.setNavigationBarTitle({ title: ENV.storeName });
    this.load();
  },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const r = await call<{ items: Service[]; nextCursor: string | null }>(
        "listServices",
      );
      this.setData({
        services: r.items.map((s) => ({
          ...s,
          price: money(s.priceFen),
          ...descriptions[s._id],
        })),
        nextCursor: r.nextCursor,
      });
    } catch (e) {
      this.setData({ error: errorText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async more() {
    if (this.data.loading || !this.data.nextCursor) return;
    this.setData({ loading: true });
    try {
      const r = await call<{ items: Service[]; nextCursor: string | null }>(
        "listServices",
        { cursor: this.data.nextCursor },
      );
      this.setData({
        services: [
          ...this.data.services,
          ...r.items.map((s) => ({
            ...s,
            price: money(s.priceFen),
            ...descriptions[s._id],
          })),
        ],
        nextCursor: r.nextCursor,
      });
    } catch (e) {
      this.setData({ error: errorText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  open(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/service/detail?id=${e.currentTarget.dataset.id}`,
    });
  },
  contact,
});
