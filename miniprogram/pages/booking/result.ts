Page({
  data: { id: "" },
  onLoad(q: Record<string, string | undefined>) {
    this.setData({ id: q.id || "" });
  },
  detail() {
    wx.redirectTo({ url: `/pages/appointment/detail?id=${this.data.id}` });
  },
  home() {
    wx.switchTab({ url: "/pages/service/list" });
  },
});
