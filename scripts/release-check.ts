import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const requiredEvidence = [
  "cloudTransactions",
  "rules",
  "indexes",
  "platformRateLimits",
  "overageDisabled",
  "alerts50_80_90",
  "backupRestore",
  "realDevice",
] as const;

/** Checks configuration declarations only; passing cannot prove cloud acceptance. */
export function validateReleaseConfig(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return ["生产配置必须是对象"];
  const c = value as Record<string, unknown>;
  const issues: string[] = [];
  if (c.stage !== "production") issues.push("必须使用生产配置");
  for (const key of [
    "environmentId",
    "developmentEnvironmentId",
    "appId",
    "storeName",
    "contactPhone",
    "timeZone",
    "alarmRecipient",
    "incidentOwner",
  ]) {
    if (typeof c[key] !== "string" || !(c[key] as string).trim())
      issues.push(`缺少有效字符串参数: ${key}`);
    else if (c[key] !== (c[key] as string).trim())
      issues.push(`参数不能包含首尾空白: ${key}`);
  }
  if (typeof c.appId === "string" && !/^wx[0-9a-f]{16}$/.test(c.appId))
    issues.push("appId 必须是有效的微信小程序 AppID");
  if (c.environmentId === c.developmentEnvironmentId)
    issues.push("生产环境不得使用已知开发环境");
  if (c.timeZone !== "Asia/Shanghai")
    issues.push("当前客户端仅支持 Asia/Shanghai 时区");
  if (
    typeof c.monthlyPlanCost !== "number" ||
    !Number.isFinite(c.monthlyPlanCost) ||
    c.monthlyPlanCost < 0
  )
    issues.push("monthlyPlanCost 必须是大于等于 0 的有限数值");
  if (
    typeof c.resourceQuota !== "number" ||
    !Number.isFinite(c.resourceQuota) ||
    c.resourceQuota <= 0
  )
    issues.push("resourceQuota 必须是大于 0 的有限数值");
  if (c.overageEnabled !== false) issues.push("超额付费必须关闭");
  const evidence =
    c.evidence && typeof c.evidence === "object" && !Array.isArray(c.evidence)
      ? (c.evidence as Record<string, unknown>)
      : {};
  for (const key of requiredEvidence)
    if (evidence[key] !== true) issues.push(`缺少实际验收证据: ${key}`);
  for (const key of Object.keys(evidence))
    if (!(requiredEvidence as readonly string[]).includes(key))
      issues.push(`未知验收证据名称: ${key}`);
  return issues;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const config = JSON.parse(
      readFileSync(
        process.env.BOOKING_CONFIG || "config/production.example.json",
        "utf8",
      ),
    );
    const issues = validateReleaseConfig(config);
    if (issues.length) {
      console.error(
        "暂不具备正式发布条件：\n" + issues.map((x) => "• " + x).join("\n"),
      );
      process.exitCode = 1;
    } else console.log("配置门禁通过；仍需由门店负责人核对实测证据");
  } catch (error) {
    console.error("无法读取有效的生产配置：", (error as Error).message);
    process.exitCode = 1;
  }
}
