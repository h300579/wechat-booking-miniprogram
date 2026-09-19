import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";
import cloudbase from "@cloudbase/node-sdk";
import { CloudStore } from "../server/cloud-store";
import { reserveImage, claimImage, finishImage } from "../server/images";
const c = JSON.parse(
  await readFile(
    process.env.BOOKING_CONFIG || (existsSync("config/development.local.json") ? "config/development.local.json" : "config/development.example.json"),
    "utf8",
  ),
);
if (c.exampleOnly) throw new Error("示例配置不能操作云端");
if (process.env.BOOKING_TARGET_ENV !== c.environmentId)
  throw new Error("目标环境不匹配");
if (!process.env.TENCENTCLOUD_SECRETID || !process.env.TENCENTCLOUD_SECRETKEY)
  throw new Error("只支持受控管理员执行环境");
const [serviceId, file] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(serviceId)) throw new Error("项目 ID 无效");
const size = (await stat(file)).size;
if (size < 1 || size > 2 * 1024 * 1024) throw new Error("原图必须不超过 2 MB");
const source = await readFile(file);
const decoder = sharp(source, { limitInputPixels: 12000000, animated: false });
const metadata = await decoder.metadata();
if (
  !["jpeg", "png", "webp"].includes(metadata.format || "") ||
  (metadata.pages || 1) > 1
)
  throw new Error("只允许单帧 JPEG/PNG/WebP");
const encoded = await decoder
  .rotate()
  .resize({
    width: 1600,
    height: 1600,
    fit: "inside",
    withoutEnlargement: true,
  })
  .webp({ quality: 82 })
  .toBuffer();
if (encoded.length > 2 * 1024 * 1024) throw new Error("压缩后仍超过 2 MB");
const db = new CloudStore(c.environmentId);
const actor = "iam-admin";
const intent = await reserveImage(
  db,
  actor,
  serviceId,
  encoded.length,
  Date.now(),
);
await claimImage(db, intent.id, actor, Date.now());
const storage = cloudbase.init({ env: c.environmentId });
const result = await storage.uploadFile({
  cloudPath: intent.cloudPath,
  fileContent: encoded,
});
console.log(await finishImage(db, intent.id, result.fileID, Date.now()));
// Files are validated and re-encoded locally BEFORE the authenticated SDK transmits bytes.
// No browser/client upload permission, signed upload URL, or arbitrary remote URL is exposed.
