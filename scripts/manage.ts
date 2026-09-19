import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import CloudBase from "@cloudbase/manager-node";
import { CloudStore } from "../server/cloud-store";
import {
  seed,
  generateDays,
  cleanup,
  reconcile,
  blockDay,
} from "../server/operations";
import { cleanupImages } from "../server/images";
import { cancel } from "../server/appointment";
import functionDefinitions from "../infra/functions.json";
import { deployFunctions } from "./deploy";
const command = process.argv[2] || "plan";
const config = JSON.parse(
  await readFile(
    process.env.BOOKING_CONFIG || (existsSync("config/development.local.json") ? "config/development.local.json" : "config/development.example.json"),
    "utf8",
  ),
);
const rules = JSON.parse(await readFile("infra/database.rules.json", "utf8"));
const indexes: Record<string, string[][]> = JSON.parse(
  await readFile("infra/indexes.json", "utf8"),
);
if (command === "plan") {
  console.log(
    JSON.stringify(
      {
        environmentId: config.environmentId,
        stage: config.stage,
        collections: Object.keys(rules),
        functions: functionDefinitions,
        note: "计划预览，不修改云端。先 migrate，验证规则，再 seed 和 deploy。",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (config.exampleOnly) throw new Error("示例配置仅供本地展示，不能操作云端");
if (
  !config.environmentId ||
  process.env.BOOKING_TARGET_ENV !== config.environmentId
)
  throw new Error("BOOKING_TARGET_ENV 必须明确匹配配置中的环境 ID");
if (!process.env.TENCENTCLOUD_SECRETID || !process.env.TENCENTCLOUD_SECRETKEY)
  throw new Error("需要受控执行环境的腾讯云凭证；不要把凭证写进代码或聊天");
const manager = new CloudBase({
  envId: config.environmentId,
  secretId: process.env.TENCENTCLOUD_SECRETID,
  secretKey: process.env.TENCENTCLOUD_SECRETKEY,
  token: process.env.TENCENTCLOUD_SESSIONTOKEN,
});
const db = new CloudStore(config.environmentId);
const now = Date.now();
switch (command) {
  case "migrate":
    for (const [collection, rule] of Object.entries(rules)) {
      await manager.database.createCollectionIfNotExists(collection);
      await manager.commonService().call({
        Action: "ModifySafeRule",
        Param: {
          CollectionName: collection,
          EnvId: config.environmentId,
          AclTag: "CUSTOM",
          Rule: JSON.stringify(rule),
        },
      });
      for (const keys of indexes[collection] || []) {
        const IndexName = "idx_" + keys.join("_");
        if (
          !(await manager.database.checkIndexExists(collection, IndexName))
            .Exists
        )
          await manager.database.updateCollection(collection, {
            CreateIndexes: [
              {
                IndexName,
                MgoKeySchema: {
                  MgoIsUnique: false,
                  MgoIndexKeys: keys.map((Name) => ({
                    Name,
                    Direction:
                      Name === "createdAt" ||
                      (Name === "_id" && collection === "appointments")
                        ? "-1"
                        : "1",
                  })),
                },
              },
            ],
          });
      }
      console.log(`已应用集合规则与索引: ${collection}`);
    }
    break;
  case "seed":
    console.log(await seed(db, config, now));
    break;
  case "deploy": {
    const names = await deployFunctions(
      manager.functions,
      functionDefinitions,
      config.appId,
      path.resolve("cloudfunctions"),
    );
    for (const name of names) console.log(`已部署并核验配置: ${name}`);
    break;
  }
  case "cleanup": {
    const report = await cleanup(db, now);
    console.log(report);
    if (report.backlog || !report.complete) process.exitCode = 1;
    break;
  }
  case "daily": {
    console.log(await generateDays(db, now));
    const report = await cleanup(db, now);
    console.log(report);
    if (report.backlog || !report.complete) process.exitCode = 1;
    console.log(
      await cleanupImages(db, now, async (p) => {
        await manager.storage.deleteFile([p]);
      }),
    );
    break;
  }
  case "reconcile": {
    const report = await reconcile(db, now);
    console.log(report);
    if (!report.ok) process.exitCode = 1;
    break;
  }
  case "maintenance":
    await db.transaction(async (tx) => {
      const c = await tx.get("settings", "booking");
      if (!c) throw new Error("尚未初始化");
      await tx.set("settings", "booking", {
        ...c,
        newBookingsEnabled: false,
        updatedAt: now,
      });
    });
    console.log("已关闭新预约；查询和取消保留");
    break;
  case "block-day":
    console.log(await blockDay(db, process.argv[3], "iam-operator", now));
    break;
  case "cancel":
    console.log(
      await cancel(
        db,
        "iam-operator",
        { appointmentId: process.argv[3] },
        now,
        true,
      ),
    );
    break;
  case "backup": {
    const c = await db.get("settings", "booking");
    if (c?.newBookingsEnabled !== false)
      throw new Error(
        "先开启维护状态，备份期间还须通过平台暂停预约写入入口（包括取消），以获得一致快照",
      );
    if (process.env.BOOKING_WRITES_STOPPED !== "yes")
      throw new Error(
        "请在平台停止所有预约写入口并确认 BOOKING_WRITES_STOPPED=yes",
      );
    const dir = path.resolve("work/backups", String(now));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const name of Object.keys(rules)) {
      let after;
      const all = [];
      while (true) {
        const rows = await db.query(name, {
          after,
          order: [
            { field: "createdAt", direction: "desc" },
            { field: "_id", direction: "desc" },
          ],
          limit: 100,
        });
        all.push(...rows);
        if (rows.length < 100) break;
        const last = rows[rows.length - 1];
        after = { createdAt: last.createdAt, id: last._id };
        if (all.length > 100000)
          throw new Error("备份超出本地脚本上限，请使用平台导出");
      }
      await writeFile(path.join(dir, name + ".json"), JSON.stringify(all), {
        mode: 0o600,
      });
    }
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        environmentId: config.environmentId,
        createdAt: now,
        collections: Object.keys(rules),
      }),
      { mode: 0o600 },
    );
    console.log(`备份已保存：${dir}`);
    break;
  }
  default:
    throw new Error("未知命令");
}
