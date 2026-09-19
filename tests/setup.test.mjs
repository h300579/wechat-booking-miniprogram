import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "esbuild";

const owner = "a".repeat(64);
const config = JSON.parse(readFileSync("config/development.example.json", "utf8"));
const compiled = await build({
  entryPoints: ["server/development-setup.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: [
    "wx-server-sdk",
    "@cloudbase/manager-node",
    "./cloud-store",
    "./security",
  ],
});
const require = createRequire(import.meta.url);
function setup(identity, closed, overrides = {}) {
  let writes = 0;
  class Manager {
    database = { createCollectionIfNotExists: async () => {} };
    commonService() {
      return {
        call: async () => {
          writes++;
        },
      };
    }
  }
  class Store {
    async get() {
      return closed ? { createdAt: 1 } : null;
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module,
    exports: module.exports,
    console,
    process: { env: { TCB_ENV: config.environmentId, SETUP_OWNER_HASH: owner, SETUP_CONFIG_JSON: JSON.stringify({...config, exampleOnly:false}), ...overrides } },
    require: (id) => {
      if (id === "wx-server-sdk")
        return { init() {}, getWXContext: () => ({ identity }) };
      if (id === "@cloudbase/manager-node") return Manager;
      if (id === "./cloud-store") return { CloudStore: Store };
      // WXContext validation is tested independently; exercise the owner boundary here.
      if (id === "./security") return { principal: (ctx) => ctx.identity };
      return require(id);
    },
  });
  return { run: module.exports.main, writes: () => writes };
}

test("temporary setup no longer returns a diagnostic identity to callers", async () => {
  assert.equal((await setup(owner, false, { SETUP_OWNER_HASH: undefined }).run({action: "seed"})).code, "MAINTENANCE");
  assert.equal((await setup(owner, false, { TCB_ENV: "different-environment" }).run({action: "seed"})).code, "ENVIRONMENT_MISMATCH");
  const stranger = await setup("not-owner", false).run({
    action: "diagnostics",
  });
  assert.equal(stranger.code, "FORBIDDEN");
  assert.equal("principalHash" in stranger, false);
  const authorized = await setup(owner, false).run({ action: "diagnostics" });
  assert.equal(authorized.code, "INVALID_ARGUMENT");
  assert.equal("principalHash" in authorized, false);
});

test("closed setup also rejects reapplying the settings collection rules", async () => {
  const fixture = setup(owner, true);
  const result = await fixture.run({
    action: "collection",
    collection: "settings",
  });
  assert.equal(result.code, "FORBIDDEN");
  assert.equal(fixture.writes(), 0);
});
