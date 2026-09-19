import { ENV } from "./config/env";
App({
  onLaunch() {
    if (wx.cloud && ENV.id) wx.cloud.init({ env: ENV.id, traceUser: false });
  },
});
