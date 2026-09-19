import { PublicAppointment } from "../../../shared/types";
import { call, errorText } from "../../utils/api";
import { appointmentView, contact } from "../../utils/presentation";
Page({
  data: {
    id: "",
    appointment: null as ReturnType<typeof appointmentView> | null,
    error: "",
    loading: false,
    cancelling: false,
  },
  onLoad(q: Record<string, string | undefined>) {
    this.setData({ id: q.id || "" });
    this.load();
  },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const a = await call<PublicAppointment>("getAppointment", {
        appointmentId: this.data.id,
      });
      this.setData({ appointment: appointmentView(a) });
    } catch (e) {
      this.setData({ error: errorText(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  async cancel() {
    if (this.data.cancelling) return;
    const r = await wx.showModal({
      title: "取消这次预约？",
      content: "取消后，此时段将重新开放预约。",
      confirmText: "确认取消",
      confirmColor: "#52745c",
    });
    if (!r.confirm) return;
    this.setData({ cancelling: true, error: "" });
    try {
      const a = await call<PublicAppointment>("cancelAppointment", {
        appointmentId: this.data.id,
      });
      this.setData({ appointment: appointmentView(a) });
      wx.showToast({ title: "已取消", icon: "success" });
    } catch (e) {
      this.setData({ error: errorText(e) });
    } finally {
      this.setData({ cancelling: false });
    }
  },
  contact,
});
