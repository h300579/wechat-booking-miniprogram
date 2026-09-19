import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { CloudStore } from "../server/cloud-store";
import { applyBudgetSample } from "../server/budget";
const c = JSON.parse(
  await readFile(
    process.env.BOOKING_CONFIG || (existsSync("config/development.local.json") ? "config/development.local.json" : "config/development.example.json"),
    "utf8",
  ),
);
if (c.exampleOnly) throw new Error("示例配置不能操作云端");
if (process.env.BOOKING_TARGET_ENV !== c.environmentId)
  throw new Error("环境不匹配");
const sample = JSON.parse(await readFile(process.argv[2], "utf8"));
const result = await applyBudgetSample(
  new CloudStore(c.environmentId),
  sample,
  Date.now(),
);
console.log(JSON.stringify(result));
if (result.notify) process.exitCode = 2;
// Exit 2 signals the trusted scheduler's email/SMS integration. Delivery must be configured and tested before release.
