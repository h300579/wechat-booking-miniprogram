/** Temporary development setup entry. Not part of production deployment. */
import cloud from "wx-server-sdk";
import CloudBase from "@cloudbase/manager-node";
import { CloudStore } from "./cloud-store";
import { principal } from "./security";
import { BusinessError, fail, fields, str } from "./common";
import { seed, generateDays, reconcile } from "./operations";
import rules from "../infra/database.rules.json";
import indexes from "../infra/indexes.json";
cloud.init({ env: process.env.TCB_ENV || process.env.SCF_NAMESPACE });
export async function main(event: unknown) {
  try {
    const env = process.env.TCB_ENV || process.env.SCF_NAMESPACE;
    const ownerHash = process.env.SETUP_OWNER_HASH;
    if (!ownerHash || !/^[a-f0-9]{64}$/.test(ownerHash) || !process.env.SETUP_CONFIG_JSON)
      fail("MAINTENANCE");
    const config = JSON.parse(process.env.SETUP_CONFIG_JSON!);
    if (!env || config.exampleOnly || env !== config.environmentId || config.stage !== "development")
      fail("ENVIRONMENT_MISMATCH");
    const e = fields(event, ["action", "collection", "userInfo"]);
    const identity = principal(cloud.getWXContext(), config.appId);
    if (identity !== ownerHash) fail("FORBIDDEN");
    const db = new CloudStore(env);
    const manager = new CloudBase({ envId: env });
    // Ensure the guard collection exists on the first authorized initialization.
    if (e.action === "collection" && e.collection === "settings")
      await manager.database.createCollectionIfNotExists("settings");
    if (await db.get("settings", "setupComplete")) fail("FORBIDDEN");
    switch (e.action) {
      case "collection": {
        const name = str(e.collection);
        if (!(name in rules)) fail("INVALID_ARGUMENT");
        await manager.database.createCollectionIfNotExists(name);
        await manager.commonService().call({
          Action: "ModifySafeRule",
          Param: {
            CollectionName: name,
            EnvId: env,
            AclTag: "CUSTOM",
            Rule: JSON.stringify((rules as any)[name]),
          },
        });
        for (const keys of (indexes as Record<string, string[][]>)[name] ||
          []) {
          const IndexName = "idx_" + keys.join("_");
          if (
            !(await manager.database.checkIndexExists(name, IndexName)).Exists
          )
            await manager.database.updateCollection(name, {
              CreateIndexes: [
                {
                  IndexName,
                  MgoKeySchema: {
                    MgoIsUnique: false,
                    MgoIndexKeys: keys.map((Name) => ({
                      Name,
                      Direction:
                        Name === "createdAt" ||
                        (Name === "_id" && name === "appointments")
                          ? "-1"
                          : "1",
                    })),
                  },
                },
              ],
            });
        }
        return { code: "OK", collection: name };
      }
      case "seed":
        return { code: "OK", data: await seed(db, config, Date.now()) };
      case "days":
        return { code: "OK", data: await generateDays(db, Date.now()) };
      case "check":
        return { code: "OK", data: await reconcile(db, Date.now()) };
      case "close":
        await db.set("settings", "setupComplete", {
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return { code: "OK" };
      default:
        fail("INVALID_ARGUMENT");
    }
  } catch (e: any) {
    return {
      code: e instanceof BusinessError ? e.code : "SETUP_FAILED",
      reason: String(e.code || e.message || "unknown").slice(0, 160),
    };
  }
}
