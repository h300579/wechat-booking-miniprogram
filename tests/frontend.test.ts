import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import vm from "node:vm";
import { MemoryStore } from "./memory";
import { seed } from "../server/operations";
import { api } from "../server/api";
type PageDate = {
  new (value: number): Date;
  now(): number;
};
function page(
  file: string,
  wx: any,
  options: { env?: Record<string, unknown>; date?: PageDate } = {},
) {
  let definition: any;
  const code = buildSync({
    stdin: {
      contents: `import { ENV } from "./miniprogram/config/env";
        Object.assign(ENV, ${JSON.stringify(options.env || {})});
        require(${JSON.stringify("./" + file)});`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "neutral",
    format: "cjs",
    target: "es2020",
  }).outputFiles[0].text;
  vm.runInNewContext(code, {
    Page: (p: any) => (definition = p),
    wx,
    console,
    setTimeout,
    clearTimeout,
    Date: options.date || Date,
    Map,
    Promise,
    Uint8Array,
    ArrayBuffer,
    Error,
    exports: {},
  });
  definition.data = structuredClone(definition.data);
  definition.setData = function (v: any) {
    Object.assign(this.data, v);
  };
  return definition;
}
test("real page handlers complete browse → select → create → list → cancel using backend contract", async () => {
  const db = new MemoryStore();
  const now = Date.now();
  await seed(
    db,
    {
      ...JSON.parse(readFileSync("config/development.example.json", "utf8")),
      environmentId: "test",
    },
    now,
  );
  const run = api(db, "app");
  const storage = new Map<string, any>();
  let route = "";
  const wx = {
    cloud: {
      callFunction: async ({ data }: any) => ({
        result: await run(data, { APPID: "app", OPENID: "frontend" }),
      }),
    },
    getStorageSync: (k: string) => storage.get(k),
    setStorageSync: (k: string, v: any) => storage.set(k, v),
    removeStorageSync: (k: string) => storage.delete(k),
    getRandomValues: ({ length, success }: any) =>
      success({
        randomValues: Uint8Array.from({ length }, (_, i) => i + 1).buffer,
      }),
    redirectTo: ({ url }: any) => (route = url),
    navigateTo: ({ url }: any) => (route = url),
    switchTab: ({ url }: any) => (route = url),
    showModal: async () => ({ confirm: true }),
    showToast: () => {},
  };
  const list = page("miniprogram/pages/service/list.ts", wx);
  await list.load();
  assert.equal(list.data.services.length, 3);
  assert.equal(list.data.loading, false);
  const s = page("miniprogram/pages/booking/select.ts", wx);
  s.setData({
    id: "service-60",
    date: new Date(Date.now() + 86400000 + 8 * 3600000)
      .toISOString()
      .slice(0, 10),
  });
  await s.load();
  assert.ok(s.data.slots.length > 0);
  s.select({ currentTarget: { dataset: { time: s.data.slots[0].startTime } } });
  await s.submit();
  assert.ok(route.startsWith("/pages/booking/result?id="));
  assert.equal(storage.has("bookingIntent"), false);
  const id = route.split("=")[1];
  const mine = page("miniprogram/pages/appointment/list.ts", wx);
  await mine.load();
  assert.equal(mine.data.items.length, 1);
  const detail = page("miniprogram/pages/appointment/detail.ts", wx);
  detail.setData({ id });
  await detail.load();
  await detail.cancel();
  assert.equal(detail.data.appointment.status, "CANCELLED");
  assert.equal(
    (await db.get("resource_days", "main:" + s.data.date))!.intervals.length,
    0,
  );
});
test("network loss preserves original key across manual retry", async () => {
  const storage = new Map();
  let calls = 0;
  const keys: string[] = [];
  const wx = {
    cloud: {
      callFunction: async ({ data }: any) => {
        keys.push(data.data.idempotencyKey);
        if (++calls === 1) throw new Error("network");
        return {
          result: {
            code: "OK",
            data: { appointmentId: "same" },
            requestId: "x",
          },
        };
      },
    },
    getStorageSync: (k: string) => storage.get(k),
    setStorageSync: (k: string, v: any) => storage.set(k, v),
    removeStorageSync: (k: string) => storage.delete(k),
    getRandomValues: ({ success }: any) =>
      success({ randomValues: new Uint8Array(24).buffer }),
    redirectTo: () => {},
  };
  const s = page("miniprogram/pages/booking/select.ts", wx);
  s.setData({ id: "service-60", selected: Date.now() + 86400000 });
  await s.submit();
  assert.equal(s.data.pending, true);
  assert.ok(storage.get("bookingIntent"));
  await s.submit();
  assert.equal(keys[0], keys[1]);
  assert.equal(storage.has("bookingIntent"), false);
});
test("all WXML control directives use data bindings instead of literal strings", async () => {
  const { globSync } = await import("node:fs");
  for (const file of globSync("miniprogram/pages/**/*.wxml")) {
    const wxml = readFileSync(file, "utf8");
    for (const m of wxml.matchAll(/wx:(?:if|elif|for)="([^"]*)"/g))
      assert.ok(
        m[1].startsWith("{{") && m[1].endsWith("}}"),
        `${file}: unbound directive ${m[0]}`,
      );
  }
});

function appointment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    serviceName: "测试服务",
    durationMinutes: 30,
    priceFen: 9950,
    localDate: "2026-09-12",
    startTime: Date.now() + 86400000,
    endTime: Date.now() + 88200000,
    status: "CONFIRMED",
    ...overrides,
  };
}
function controlledCloud() {
  const requests: {
    data: any;
    resolve: (value: any) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const wx = {
    cloud: {
      callFunction: ({ data, name }: any) =>
        name === "operations"
          ? Promise.resolve({ result: { code: "OK", data: { isMerchant: false }, requestId: "role" } })
          : new Promise((resolve, reject) => {
          requests.push({ data, resolve, reject });
        }),
    },
  };
  const respond = (index: number, data: unknown) =>
    requests[index].resolve({
      result: { code: "OK", data, requestId: "test" },
    });
  return { wx, requests, respond };
}

test("returning to appointments during load more discards its stale response and reloads the first page", async () => {
  const cloud = controlledCloud();
  const mine = page("miniprogram/pages/appointment/list.ts", cloud.wx);
  const first = mine.load();
  cloud.respond(0, { items: [appointment("first")], nextCursor: "page-2" });
  await first;
  const more = mine.more();
  assert.equal(cloud.requests[1].data.data.cursor, "page-2");
  const refresh = mine.onShow();
  cloud.respond(1, { items: [appointment("stale-second")], nextCursor: null });
  await more;
  assert.equal(cloud.requests.length, 3);
  assert.equal(cloud.requests[2].data.data.cursor, undefined);
  assert.equal(mine.data.items.length, 0);
  assert.equal(mine.data.loading, true);
  cloud.respond(2, {
    items: [appointment("first", { status: "CANCELLED" })],
    nextCursor: "fresh-page-2",
  });
  await refresh;
  assert.equal(mine.data.items[0]._id, "first");
  assert.equal(mine.data.items[0].status, "CANCELLED");
  const next = mine.more();
  cloud.respond(3, { items: [appointment("fresh-second")], nextCursor: null });
  await next;
  assert.deepEqual(
    Array.from(mine.data.items, (a: any) => a._id),
    ["first", "fresh-second"],
  );
});

test("refresh during a pending first page makes a new request after the old one and ignores its errors", async () => {
  const cloud = controlledCloud();
  const mine = page("miniprogram/pages/appointment/list.ts", cloud.wx);
  const first = mine.load();
  const refresh = mine.onShow();
  cloud.requests[0].reject(new Error("old request failed"));
  await first;
  assert.equal(cloud.requests.length, 2);
  assert.equal(mine.data.error, "");
  assert.equal(mine.data.loading, true);
  cloud.respond(1, { items: [appointment("fresh")], nextCursor: null });
  await refresh;
  assert.equal(mine.data.items[0]._id, "fresh");
  assert.equal(mine.data.loading, false);
});

test("all service and appointment views preserve price cents", async () => {
  const service = {
    _id: "custom",
    name: "测试服务",
    durationMinutes: 30,
    priceFen: 9950,
    status: "ACTIVE",
    version: 1,
  };
  const wx = {
    cloud: {
      callFunction: async ({ data }: any) => ({
        result: {
          code: "OK",
          requestId: "test",
          data:
            data.action === "listServices"
              ? { items: [service], nextCursor: null }
              : data.action === "getAvailability"
                ? { slots: [], durationMinutes: 30, priceFen: 9950 }
                : data.action === "getAppointment"
                  ? appointment("one")
                  : data.action === "listMyAppointments"
                    ? { items: [appointment("one")], nextCursor: null }
                    : service,
        },
      }),
    },
  };
  const list = page("miniprogram/pages/service/list.ts", wx);
  await list.load();
  assert.equal(list.data.services[0].price, "99.50");
  const detail = page("miniprogram/pages/service/detail.ts", wx);
  detail.setData({ id: service._id });
  await detail.load();
  assert.equal(detail.data.price, "99.50");
  const select = page("miniprogram/pages/booking/select.ts", wx);
  select.setData({ id: service._id, date: "2026-09-12" });
  await select.load();
  assert.equal(select.data.price, "99.50");
  const mine = page("miniprogram/pages/appointment/list.ts", wx);
  await mine.load();
  assert.equal(mine.data.items[0].price, "99.50");
  const appointmentDetail = page("miniprogram/pages/appointment/detail.ts", wx);
  appointmentDetail.setData({ id: "one" });
  await appointmentDetail.load();
  assert.equal(appointmentDetail.data.appointment.price, "99.50");
});

test("booking boundaries use the configured horizon and the current Shanghai date at onLoad", () => {
  let now = Date.parse("2026-09-11T15:59:00.000Z");
  class TestDate extends Date {
    static now() {
      return now;
    }
  }
  const select = page(
    "miniprogram/pages/booking/select.ts",
    { getStorageSync: () => undefined },
    { env: { bookingDays: 7, timeZone: "Asia/Shanghai" }, date: TestDate },
  );
  select.load = () => {};
  // Page definitions can remain loaded across midnight before a new page opens.
  now = Date.parse("2026-09-11T16:01:00.000Z");
  select.onLoad({ id: "custom" });
  assert.equal(select.data.date, "2026-09-12");
  assert.equal(select.data.minDate, "2026-09-12");
  assert.equal(select.data.endDate, "2026-09-18");
  now = Date.parse("2026-09-12T16:01:00.000Z");
  select.onLoad({ id: "custom" });
  assert.equal(select.data.minDate, "2026-09-13");
  assert.equal(select.data.endDate, "2026-09-19");
});

test("unsupported timezone is explicit and production pages use the configured store without demo labels", () => {
  const unsupported = page(
    "miniprogram/pages/booking/select.ts",
    {},
    { env: { timeZone: "Europe/London" } },
  );
  assert.throws(() => unsupported.onLoad({}), /Asia\/Shanghai/);
  let title = "";
  const production = page(
    "miniprogram/pages/service/list.ts",
    { setNavigationBarTitle: (v: any) => (title = v.title) },
    { env: { storeName: "真实门店", stage: "production" } },
  );
  production.load = () => {};
  production.onLoad();
  assert.equal(title, "真实门店");
  assert.equal(production.data.storeName, "真实门店");
  assert.equal(production.data.isDevelopment, false);
  const detail = page(
    "miniprogram/pages/service/detail.ts",
    {},
    {
      env: { stage: "production" },
    },
  );
  assert.equal(detail.data.isDevelopment, false);
  for (const file of ["list", "detail"])
    assert.match(
      readFileSync(`miniprogram/pages/service/${file}.wxml`, "utf8"),
      /wx:if="{{isDevelopment}}" class="demo"/,
    );
});
