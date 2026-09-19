import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  requiredEvidence,
  validateReleaseConfig,
} from "../scripts/release-check";
import { deployFunctions } from "../scripts/deploy";
import definitions from "../infra/functions.json";

const appId = "wx0123456789abcdef";
function releaseConfig(): Record<string, any> {
  return {
    stage: "production",
    environmentId: "booking-prod-123",
    developmentEnvironmentId: "booking-dev-example",
    appId,
    storeName: "真实门店",
    contactPhone: "021-12345678",
    timeZone: "Asia/Shanghai",
    alarmRecipient: "owner@example.test",
    incidentOwner: "门店负责人",
    monthlyPlanCost: 19.9,
    resourceQuota: 100,
    overageEnabled: false,
    evidence: Object.fromEntries(requiredEvidence.map((key) => [key, true])),
  };
}

test("release requires finite nonnegative cost and strictly positive quota", () => {
  assert.deepEqual(validateReleaseConfig(releaseConfig()), []);
  for (const field of ["monthlyPlanCost", "resourceQuota"]) {
    for (const value of [undefined, null, "100", true, NaN, Infinity, -1]) {
      const config = releaseConfig();
      config[field] = value;
      assert.ok(
        validateReleaseConfig(config).some((issue) => issue.includes(field)),
      );
    }
    const config = releaseConfig();
    delete config[field];
    assert.ok(
      validateReleaseConfig(config).some((issue) => issue.includes(field)),
    );
  }
  assert.deepEqual(
    validateReleaseConfig({ ...releaseConfig(), monthlyPlanCost: 0 }),
    [],
  );
  assert.ok(
    validateReleaseConfig({ ...releaseConfig(), resourceQuota: 0 }).length,
  );
});

test("release checks every named evidence instead of merely counting eight flags", () => {
  const config = releaseConfig();
  config.evidence = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`unrelated${i}`, true]),
  );
  const issues = validateReleaseConfig(config);
  for (const key of requiredEvidence)
    assert.ok(issues.some((issue) => issue.includes(key)));
  for (const key of requiredEvidence) {
    for (const value of [undefined, false, "true", 1]) {
      const c = releaseConfig();
      c.evidence[key] = value;
      assert.ok(validateReleaseConfig(c).some((issue) => issue.includes(key)));
    }
  }
  assert.ok(validateReleaseConfig({ ...releaseConfig(), evidence: [] }).length);
  config.evidence = { ...releaseConfig().evidence, unrelated: true };
  assert.ok(
    validateReleaseConfig(config).some((issue) => issue.includes("unrelated")),
  );
});

test("release rejects missing or malformed required strings, AppID, stage and overage", () => {
  for (const field of [
    "environmentId",
    "developmentEnvironmentId",
    "appId",
    "storeName",
    "contactPhone",
    "timeZone",
    "alarmRecipient",
    "incidentOwner",
  ]) {
    for (const value of [undefined, null, "", "   ", " padded ", 1, true, {}]) {
      const c = releaseConfig();
      c[field] = value;
      assert.ok(
        validateReleaseConfig(c).some((issue) => issue.includes(field)),
        `${field}: ${value}`,
      );
    }
  }
  for (const invalid of [null, [], 1, "config"])
    assert.ok(validateReleaseConfig(invalid).length);
  for (const patch of [
    { appId: "wx-not-valid" },
    { stage: "development" },
    { environmentId: "booking-dev-example" },
    { timeZone: "UTC" },
    { overageEnabled: true },
    { overageEnabled: undefined },
  ])
    assert.ok(validateReleaseConfig({ ...releaseConfig(), ...patch }).length);
});

test("release CLI keeps success/failure exit codes and reports invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "booking-release-"));
  const configPath = join(dir, "config.json");
  const run = () =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/release-check.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, BOOKING_CONFIG: configPath },
        encoding: "utf8",
      },
    );
  try {
    writeFileSync(configPath, JSON.stringify(releaseConfig()));
    assert.equal(run().status, 0);
    const invalid = releaseConfig();
    delete invalid.resourceQuota;
    writeFileSync(configPath, JSON.stringify(invalid));
    const rejected = run();
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /resourceQuota/);
    writeFileSync(configPath, "{broken");
    assert.equal(run().status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

type FunctionService = Parameters<typeof deployFunctions>[0];
type FunctionDetail = Awaited<ReturnType<FunctionService["getFunctionDetail"]>>;
function deploymentMock(
  existing: boolean,
  options: {
    mismatch?: Partial<FunctionDetail>;
    runtime?: string;
    configError?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let mutated = false;
  let detail = {
    FunctionName: "operations",
    Runtime: options.runtime || definitions.operations.runtime,
    Handler: "index.main",
    Timeout: 3,
    MemorySize: 128,
    Status: "Active",
    Environment: {
      Variables: [
        { Key: "WECHAT_APP_ID", Value: "old-app" },
        { Key: "PRIVATE_TOKEN", Value: "synthetic-private-token" },
      ],
    },
  } as FunctionDetail;
  const apply = (
    func: Parameters<FunctionService["updateFunctionConfig"]>[0],
  ) => {
    detail = {
      ...detail,
      Timeout: func.timeout!,
      MemorySize: func.memorySize!,
      Environment: {
        Variables: Object.entries(func.envVariables!).map(([Key, Value]) => ({
          Key,
          Value: String(Value),
        })),
      },
    };
  };
  const service: FunctionService = {
    listFunctions: async () => {
      calls.push("list");
      return existing ? [{ FunctionName: "operations" }] : [];
    },
    getFunctionDetail: async () => {
      calls.push("read");
      return mutated ? { ...detail, ...options.mismatch } : detail;
    },
    waitFunctionActive: async () => {
      calls.push("wait");
    },
    updateFunctionCode: async ({ func }) => {
      calls.push("code");
      mutated = true;
      detail.Handler = func.handler!;
      return { RequestId: "mock" };
    },
    updateFunctionConfig: async (func) => {
      calls.push("config");
      if (options.configError) throw new Error("configuration rejected");
      apply(func);
      return { RequestId: "mock" };
    },
    createFunction: async ({ func }) => {
      calls.push("create");
      mutated = true;
      detail.Runtime = func.runtime!;
      detail.Handler = func.handler!;
      apply(func);
      return { RequestId: "mock" };
    },
  };
  return { service, calls };
}
const operationOnly = { operations: definitions.operations };

test("existing deployment applies code, configuration and verifies read-back in order", async () => {
  const mock = deploymentMock(true);
  assert.deepEqual(
    await deployFunctions(
      mock.service,
      operationOnly,
      appId,
      "/test/functions",
    ),
    ["operations"],
  );
  assert.deepEqual(mock.calls, [
    "list",
    "read",
    "code",
    "wait",
    "config",
    "wait",
    "read",
  ]);
});

test("new deployment waits for readiness and verifies persisted configuration", async () => {
  const mock = deploymentMock(false);
  assert.deepEqual(
    await deployFunctions(
      mock.service,
      operationOnly,
      appId,
      "/test/functions",
    ),
    ["operations"],
  );
  assert.deepEqual(mock.calls, ["list", "create", "wait", "read"]);
});

test("existing deployment preserves unrelated private environment variables", async () => {
  const mock = deploymentMock(true);
  const before = await mock.service.getFunctionDetail("operations");
  const original = before.Environment.Variables.find(
    ({ Key }) => Key === "PRIVATE_TOKEN",
  )!.Value;
  await deployFunctions(mock.service, operationOnly, appId, "/test/functions");
  const after = await mock.service.getFunctionDetail("operations");
  const variables = after.Environment.Variables;
  // Boolean assertions prevent sensitive values appearing in failure output.
  assert.ok(
    variables.some(
      ({ Key, Value }) => Key === "PRIVATE_TOKEN" && Value === original,
    ),
    "existing private variable must be preserved",
  );
  assert.ok(
    variables.some(
      ({ Key, Value }) => Key === "WECHAT_APP_ID" && Value === appId,
    ),
    "AppID must be replaced with the configured value",
  );
});

test("deployment never reports success when any read-back setting differs", async () => {
  for (const existing of [true, false]) {
    for (const mismatch of [
      { Runtime: "Nodejs18.15" },
      { Handler: "old.main" },
      { Timeout: 3 },
      { MemorySize: 128 },
      { Status: "UpdateFailed" },
      {
        Environment: {
          Variables: [{ Key: "WECHAT_APP_ID", Value: "old-app" }],
        },
      },
    ]) {
      const mock = deploymentMock(existing, { mismatch });
      await assert.rejects(
        deployFunctions(mock.service, operationOnly, appId, "/test/functions"),
        /部署后配置核验失败/,
      );
    }
  }
});

test("deployment fails before mutation for unsupported runtime and invalid AppID", async () => {
  const runtime = deploymentMock(true, { runtime: "Nodejs18.15" });
  await assert.rejects(
    deployFunctions(runtime.service, operationOnly, appId, "/test/functions"),
    /运行时不匹配/,
  );
  assert.deepEqual(runtime.calls, ["list", "read"]);
  const invalid = deploymentMock(true);
  await assert.rejects(
    deployFunctions(invalid.service, operationOnly, "", "/test/functions"),
    /AppID/,
  );
  assert.deepEqual(invalid.calls, []);
  const failed = deploymentMock(true, { configError: true });
  await assert.rejects(
    deployFunctions(failed.service, operationOnly, appId, "/test/functions"),
    /configuration rejected/,
  );
  assert.deepEqual(failed.calls, ["list", "read", "code", "wait", "config"]);
});
