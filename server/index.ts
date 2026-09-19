import cloud from "wx-server-sdk";
import { CloudStore } from "./cloud-store";
import { api } from "./api";
cloud.init({ env: process.env.TCB_ENV || process.env.SCF_NAMESPACE });
export const main = async (event: unknown) => {
  const env = process.env.TCB_ENV || process.env.SCF_NAMESPACE;
  if (!env || !process.env.WECHAT_APP_ID)
    return {
      code: "MAINTENANCE",
      data: null,
      requestId: "environment-missing",
    };
  return api(
    new CloudStore(env),
    process.env.WECHAT_APP_ID || "",
  )(event, cloud.getWXContext());
};
