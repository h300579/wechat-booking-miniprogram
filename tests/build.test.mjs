import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { publicConfig } from "../scripts/public-config.mjs";

const development = JSON.parse(readFileSync("config/development.example.json", "utf8"));

test("public config follows the selected environment and never copies private deployment fields", () => {
  const selected = {
    ...development,
    environmentId: "production-example",
    stage: "production",
    storeName: "真实门店",
    bookingDays: 7,
    maxFuture: 2,
    contactPhone: "12345678",
    secretKey: "must-not-reach-client",
    alarmRecipient: "private",
    services: [
      { ...development.services[0], priceFen: 9950, internalNote: "private" },
    ],
  };
  const c = publicConfig(selected, {
    "service-30": { intro: "真实介绍", secret: "private" },
  });
  assert.equal(c.env.id, selected.environmentId);
  assert.equal(c.env.bookingDays, 7);
  assert.equal(c.env.maxFuture, 2);
  assert.equal(c.env.storeName, "真实门店");
  assert.equal(c.catalog[0].priceFen, 9950);
  assert.equal(c.descriptions["service-30"].intro, "真实介绍");
  assert.ok(!JSON.stringify(c).includes("private"));
  assert.ok(!JSON.stringify(c).includes("must-not-reach-client"));
  assert.throws(
    () => publicConfig({ ...selected, timeZone: "America/New_York" }, {}),
    /Asia\/Shanghai/,
  );
  assert.throws(
    () => publicConfig({ ...selected, bookingDays: 0 }, {}),
    /bookingDays/,
  );
});

function frontend(wx) {
  const cache = new Map();
  let registered;
  function load(file) {
    file = path.resolve(file);
    if (!file.endsWith(".js")) file += ".js";
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    vm.runInNewContext(
      readFileSync(file, "utf8"),
      {
        module,
        exports: module.exports,
        require: (id) => load(path.resolve(path.dirname(file), id)),
        Page: (p) => {
          registered = p;
        },
        wx,
        console,
        Date,
        Map,
        Promise,
        setTimeout,
        clearTimeout,
        Uint8Array,
        ArrayBuffer,
        Error,
      },
      { filename: file },
    );
    return module.exports;
  }
  return (file) => {
    load(file);
    const page = registered;
    page.data = structuredClone(page.data);
    page.setData = (value) => Object.assign(page.data, value);
    return page;
  };
}

test("built detail and booking pages share in-flight API requests", async () => {
  const requests = [];
  const wx = {
    cloud: {
      callFunction: ({ data }) =>
        new Promise((resolve) => {
          requests.push({ action: data.action, resolve });
        }),
    },
  };
  const page = frontend(wx);
  const detail = page("miniprogram/pages/service/detail.js");
  const booking = page("miniprogram/pages/booking/select.js");
  detail.setData({ id: "service-30" });
  booking.setData({ id: "service-30", date: "2026-09-12" });
  const a = detail.load();
  const b = booking.load();
  assert.equal(requests.filter((r) => r.action === "getService").length, 1);
  for (const request of requests)
    request.resolve({
      result: {
        code: "OK",
        requestId: "test",
        data:
          request.action === "getService"
            ? development.services[0]
            : { slots: [], durationMinutes: 30, priceFen: 9900 },
      },
    });
  await Promise.all([a, b]);
  assert.equal(detail.data.ready, true);
  assert.equal(booking.data.price, "99.00");
});

test("generated operations timeout matches the shared deployment definition", () => {
  const definitions = JSON.parse(readFileSync("infra/functions.json", "utf8"));
  for (const [name, definition] of Object.entries(definitions)) {
    const config = JSON.parse(
      readFileSync(`cloudfunctions/${name}/config.json`, "utf8"),
    );
    assert.equal(config.timeout, definition.timeout);
  }
});
