// Only these public fields may enter the mini program. Never copy the entire config.
export function publicConfig(config, content) {
  if (
    !config ||
    !["development", "staging", "production"].includes(config.stage)
  )
    throw new Error("配置必须指定 development / staging / production");
  if (
    typeof config.appId !== "string" ||
    !/^wx[0-9a-f]{16}$/.test(config.appId)
  )
    throw new Error("配置必须指定有效的微信小程序 AppID");
  if (typeof config.environmentId !== "string" || !config.environmentId.trim())
    throw new Error("请填写明确的云环境 ID");
  if (typeof config.storeName !== "string" || !config.storeName.trim())
    throw new Error("请填写门店名称");
  if (config.timeZone !== "Asia/Shanghai")
    throw new Error("第一版前端仅支持 Asia/Shanghai，不支持静默切换其他时区");
  if (
    !Number.isInteger(config.bookingDays) ||
    config.bookingDays < 1 ||
    config.bookingDays > 90
  )
    throw new Error("bookingDays 必须为 1–90 天");
  if (
    !Number.isInteger(config.maxFuture) ||
    config.maxFuture < 1 ||
    config.maxFuture > 10
  )
    throw new Error("maxFuture 必须为 1–10");
  if (!Array.isArray(config.services)) throw new Error("配置缺少 services");
  const catalog = config.services
    .map((s) => {
      if (
        !s ||
        typeof s._id !== "string" ||
        typeof s.name !== "string" ||
        !Number.isSafeInteger(s.priceFen) ||
        s.priceFen < 0 ||
        !Number.isInteger(s.durationMinutes) ||
        s.durationMinutes <= 0 ||
        !["ACTIVE", "INACTIVE"].includes(s.status) ||
        !Number.isInteger(s.version)
      )
        throw new Error("服务项目配置无效");
      return {
        _id: s._id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceFen: s.priceFen,
        status: s.status,
        version: s.version,
      };
    })
    .filter((s) => s.status === "ACTIVE");
  const descriptions = {};
  for (const s of catalog) {
    const d = content[s._id];
    if (d)
      descriptions[s._id] = Object.fromEntries(
        ["intro", "note", "tag", "number"].map((key) => [
          key,
          typeof d[key] === "string" ? d[key] : "",
        ]),
      );
  }
  return {
    env: {
      id: config.environmentId,
      stage: config.stage,
      timeZone: config.timeZone,
      bookingDays: config.bookingDays,
      maxFuture: config.maxFuture,
      contactPhone:
        typeof config.contactPhone === "string" ? config.contactPhone : "",
      storeName: config.storeName,
    },
    catalog,
    descriptions,
  };
}
