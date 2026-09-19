import { PublicAppointment } from "../../../shared/types";
import { call, errorText, merchantCall } from "../../utils/api";
import { appointmentView } from "../../utils/presentation";
Page({
  data: {
    isMerchant: false,
    items: [] as ReturnType<typeof appointmentView>[],
    loading: false,
    error: "",
    cursor: null as string | null,
  },
  requestSequence: 0,
  activeRequest: null as Promise<void> | null,
  onShow() {
    this.loadMerchantRole();
    return this.load();
  },
  async loadMerchantRole() {
    this.setData({ isMerchant: false });
    try {
      const r = await merchantCall<{ isMerchant: boolean }>(
        "getMyMerchantRole",
      );
      this.setData({ isMerchant: r.isMerchant });
    } catch {
      this.setData({ isMerchant: false });
    }
  },
  openMerchant() {
    wx.navigateTo({ url: "/pages/merchant/dashboard" });
  },
  async load() {
    const sequence = ++this.requestSequence;
    this.setData({ items: [], cursor: null, loading: true, error: "" });
    // Let the prior request settle so the API request deduplicator cannot reuse it.
    // Its response is already invalidated, including any pending "load more" page.
    if (this.activeRequest) await this.activeRequest;
    if (sequence !== this.requestSequence) return;
    await this.fetch(false, sequence);
  },
  async more() {
    if (this.data.cursor && !this.data.loading)
      await this.fetch(true, this.requestSequence);
  },
  async fetch(more: boolean, sequence: number) {
    this.setData({ loading: true, error: "" });
    const request = (async () => {
      try {
        const r = await call<{
          items: PublicAppointment[];
          nextCursor: string | null;
        }>("listMyAppointments", more ? { cursor: this.data.cursor } : {});
        if (sequence !== this.requestSequence) return;
        this.setData({
          items: [
            ...(more ? this.data.items : []),
            ...r.items.map(appointmentView),
          ],
          cursor: r.nextCursor,
        });
      } catch (e) {
        if (sequence === this.requestSequence)
          this.setData({ error: errorText(e) });
      } finally {
        if (sequence === this.requestSequence) this.setData({ loading: false });
      }
    })();
    this.activeRequest = request;
    await request;
    if (this.activeRequest === request) this.activeRequest = null;
  },
  open(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({
      url: `/pages/appointment/detail?id=${e.currentTarget.dataset.id}`,
    });
  },
  book() {
    wx.switchTab({ url: "/pages/service/list" });
  },
});
