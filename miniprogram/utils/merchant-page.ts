import { merchantCall, errorText, ApiError } from "./api";
type Mode = "dashboard" | "list" | "day" | "detail";
export function merchantPage(mode: Mode) {
  Page({
    data: {
      mode,
      loading: false,
      busy: false,
      error: "",
      denied: false,
      date: "",
      payload: null as any,
      items: [] as any[],
      listError: "",
    },
    appointmentId: "",
    sequence: 0,
    onLoad(options: Record<string, string>) {
      if (options.date) this.setData({ date: options.date });
      this.appointmentId = options.id || "";
    },
    onShow() {
      this.load();
    },
    onHide() {
      this.sequence++;
    },
    onUnload() {
      this.sequence++;
    },
    async load() {
      const seq = ++this.sequence;
      this.setData({
        loading: true,
        error: "",
        denied: false,
        listError: "",
        payload: null,
        items: [],
      });
      try {
        if (mode === "detail") {
          const payload = await merchantCall<any>("getMerchantAppointment", {
            appointmentId: this.appointmentId,
          });
          if (seq === this.sequence) this.setData({ payload });
        } else if (mode === "dashboard") {
          const payload = await merchantCall<any>("getMerchantDashboard");
          if (seq === this.sequence)
            this.setData({ payload, date: payload.today });
        } else {
          const payload = await merchantCall<any>(
            "getMerchantDay",
            this.data.date ? { date: this.data.date } : {},
          );
          if (seq !== this.sequence) return;
          this.setData({ payload, date: payload.date });
          try {
            const result = await merchantCall<any>("getMerchantAppointments", {
              date: payload.date,
            });
            if (seq === this.sequence) this.setData({ items: result.items });
          } catch (e) {
            if (e instanceof ApiError && e.code === "FORBIDDEN") throw e;
            if (seq === this.sequence)
              this.setData({ listError: errorText(e) });
          }
        }
      } catch (e) {
        if (seq === this.sequence)
          this.setData({
            error: errorText(e),
            denied: e instanceof ApiError && e.code === "FORBIDDEN",
            payload: null,
            items: [],
          });
      } finally {
        if (seq === this.sequence) this.setData({ loading: false });
      }
    },
    changeDate(e: WechatMiniprogram.PickerChange) {
      if (this.data.busy) return;
      this.setData({ date: String(e.detail.value) });
      this.load();
    },
    openList() {
      wx.navigateTo({ url: `/pages/merchant/list?date=${this.data.date}` });
    },
    openDay() {
      wx.navigateTo({ url: `/pages/merchant/day?date=${this.data.date}` });
    },
    openDetail(e: WechatMiniprogram.TouchEvent) {
      wx.navigateTo({
        url: `/pages/merchant/detail?id=${e.currentTarget.dataset.id}`,
      });
    },
    async closeDay() {
      await this.mutate("closeDay");
    },
    async reopenDay() {
      await this.mutate("reopenDay");
    },
    async cancelBooking() {
      await this.mutate("cancelAppointment");
    },
    async mutate(action: string) {
      if (this.data.busy || this.data.loading || !this.data.payload) return;
      this.setData({ busy: true });
      const cancelling = action === "cancelAppointment";
      const closing = action === "closeDay";
      const payload = this.data.payload;
      try {
        const answer = await wx.showModal({
          title: cancelling
            ? "取消这笔预约？"
            : closing
              ? "停止当天接单？"
              : "恢复当天接单？",
          content: cancelling
            ? `${payload.localDate} ${payload.timeLabel} ${payload.serviceName}。取消后释放时段；是否可再次预约以当天开放设置为准。不会自动发送通知。`
            : `${this.data.date}。${closing ? "已有预约保持有效，仅停止新预约。" : "撤销手动关闭，已有预约继续占用原时段。"}`,
          confirmText: cancelling
            ? "确认取消"
            : closing
              ? "停止接单"
              : "恢复接单",
        });
        if (!answer.confirm) return;
        await merchantCall(
          action,
          cancelling
            ? { appointmentId: this.appointmentId }
            : { date: this.data.date },
        );
        wx.showToast({ title: "操作成功", icon: "success" });
        await this.load();
      } catch (e) {
        await this.load();
        this.setData({
          error: `${errorText(e)}。如结果不确定，请刷新核对；重复相同操作不会切换状态。`,
        });
      } finally {
        this.setData({ busy: false });
      }
    },
    back() {
      wx.switchTab({ url: "/pages/appointment/list" });
    },
  });
}
