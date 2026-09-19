import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryStore } from "./memory";
import { seed } from "../server/operations";
import { create, cancel, availability } from "../server/appointment";
import { ensureUser } from "../server/security";
import { merchantDay, merchantList, merchantDetail, merchantDashboard, setDayClosed } from "../server/merchant";
import { toUTC } from "../server/time";
const now = Date.parse("2026-09-11T00:00:00Z"), date = "2026-09-12", dayId = `main:${date}`;
const at = (clock: string) => toUTC(date, clock, "Asia/Shanghai");
async function setup() {
  const db = new MemoryStore();
  await seed(db, {...JSON.parse(readFileSync("config/development.example.json", "utf8")), environmentId: "test"}, now);
  const user = await ensureUser(db, "merchant-test", now);
  return {db, user};
}
const book = (db: MemoryStore, user: any) => create(db, user._id, {serviceId: "service-60", startTime: new Date(at("14:00")).toISOString(), idempotencyKey: "merchant-test-key-0001"}, now);
test("close/reopen is idempotent and preserves windows, blocks and occupancy", async () => {
  const {db,user} = await setup(); await book(db,user);
  const before = (await db.get("resource_days",dayId))!;
  before.blockedIntervals = [{startTime:at("10:00"),endTime:at("11:00")}];
  await db.set("resource_days",dayId,before);
  await setDayClosed(db,{date},"owner",now,true);
  const closed = await db.get("resource_days",dayId);
  await setDayClosed(db,{date},"owner",now,true);
  assert.deepEqual(await db.get("resource_days",dayId),closed);
  assert.equal((await availability(db,{date,serviceId:"service-60"},now)).slots.length,0);
  await setDayClosed(db,{date},"owner",now,false);
  const opened = (await db.get("resource_days",dayId))!;
  for (const field of ["windows","blockedIntervals","intervals"]) assert.deepEqual(opened[field],before[field]);
  const audits = await db.query("audit_logs",{equals:{actorId:"owner"},limit:100});
  assert.equal(audits.length,2);
});
test("merchant cancellation remains idempotent after start and never reopens a closed day", async () => {
  const {db,user}=await setup(); await book(db,user);
  const a=(await db.query("appointments",{limit:1}))[0];
  await setDayClosed(db,{date},"owner",now,true);
  await cancel(db,"owner",{appointmentId:a._id},now,true);
  await cancel(db,"owner",{appointmentId:a._id},at("15:00"),true);
  const day=(await db.get("resource_days",dayId))!;
  assert.equal(day.manuallyClosed,true); assert.equal(day.intervals.length,0);
});
test("closed day rejects creation and missing/rest/history dates cannot be reopened", async () => {
  const {db,user}=await setup();
  await setDayClosed(db,{date},"owner",now,true);
  await assert.rejects(book(db,user));
  const day=(await db.get("resource_days",dayId))!;
  await db.set("resource_days",dayId,{...day,windows:[]});
  await assert.rejects(setDayClosed(db,{date},"owner",now,false),{code:"REST_DAY"});
  await db.remove("resource_days",dayId);
  await assert.rejects(setDayClosed(db,{date},"owner",now,false),{code:"SCHEDULE_UNAVAILABLE"});
  await assert.rejects(setDayClosed(db,{date:"2026-09-10"},"owner",now,false));
});
test("day states distinguish no services, no remaining slots, full occupancy and business end", async () => {
  const {db}=await setup();
  assert.equal((await merchantDay(db,{date},now)).state,"AVAILABLE");
  const day=(await db.get("resource_days",dayId))!;
  await db.set("resource_days",dayId,{...day,intervals:day.windows});
  assert.equal((await merchantDay(db,{date},now)).state,"FULLY_BOOKED");
  await db.set("resource_days",dayId,day);
  assert.equal((await merchantDay(db,{date},at("18:45"))).state,"NO_SLOTS");
  assert.equal((await merchantDay(db,{date},at("19:00"))).state,"BUSINESS_ENDED");
  for(const s of await db.query("services",{limit:100})) await db.set("services",s._id,{...s,status:"INACTIVE"});
  assert.equal((await merchantDay(db,{date},now)).state,"NO_SERVICES");
});
test("daily pagination returns all 200 records, rejects 201 and dashboard ignores cancellation volume", async () => {
  const {db}=await setup();
  const a={resourceId:"main",localDate:date,startTime:at("14:00"),endTime:at("15:00"),priceFen:19900,durationMinutes:60,serviceName:"service",status:"CANCELLED",userId:"secret",idempotencyId:"secret"};
  for(let i=0;i<200;i++) await db.set("appointments",String(i).padStart(4,"0"),a);
  const result=await merchantList(db,{date},now);
  assert.equal(result.total,200); assert.equal(result.complete,true);
  assert.equal("userId" in result.items[0],false); assert.equal("idempotencyId" in result.items[0],false);
  await db.set("appointments","0200",{...a,status:"CONFIRMED"});
  await assert.rejects(merchantList(db,{date},now),{code:"MERCHANT_QUERY_TOO_LARGE"});
  const dashboard=await merchantDashboard(db,at("09:00"));
  assert.equal(dashboard.activeCount,1); assert.equal(dashboard.upcomingCount,1);
  assert.equal(dashboard.next!.appointmentId,"0200");
  await db.set("appointments","foreign",{...a,resourceId:"other"});
  await assert.rejects(merchantDetail(db,{appointmentId:"foreign"},now),{code:"FORBIDDEN"});
});
test("concurrent close and booking preserve a serializable final occupancy", async () => {
  for(let i=0;i<10;i++) {
    const {db,user}=await setup();
    const results=await Promise.allSettled([book(db,user),setDayClosed(db,{date},"owner",now,true)]);
    assert.equal(results[1].status,"fulfilled");
    const day=(await db.get("resource_days",dayId))!;
    assert.equal(day.manuallyClosed,true);
    const appointments=await db.query("appointments",{limit:100});
    assert.equal(day.intervals.length,appointments.length);
    assert.equal(appointments.length,results[0].status==="fulfilled"?1:0);
  }
});

test("operations entry authorizes trusted identity and denies every merchant action after revocation", async () => {
  const { build } = await import("esbuild");
  const vm = await import("node:vm");
  const { principal } = await import("../server/security");
  const {db}=await setup();
  const context={APPID:"app",OPENID:"owner"};
  const identity=principal(context,"app");
  const owner=await ensureUser(db,identity,now);
  const compiled=await build({entryPoints:["server/ops-entry.ts"],bundle:true,write:false,platform:"node",format:"cjs",plugins:[{
    name:"local-only-storage",
    setup(b) {
      b.onResolve({filter:/^(wx-server-sdk|\.\/cloud-store)$/},args=>({path:args.path,namespace:"test-stubs"}));
      b.onLoad({filter:/.*/,namespace:"test-stubs"},args=>({contents:args.path==="wx-server-sdk"
        ? "export default {init(){},getWXContext(){return globalThis.context}}"
        : "export class CloudStore { constructor(){return globalThis.db} }",loader:"js"}));
    }
  }]});
  const module={exports:{} as any};
  vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:(await import("node:module")).createRequire(import.meta.url),process:{env:{TCB_ENV:"test",WECHAT_APP_ID:"app"}},db,context,console});
  const run=(action:string,data={})=>module.exports.main({action,data});
  const actions=["getMerchantDashboard","getMerchantAppointments","getMerchantAppointment","getMerchantDay","closeDay","reopenDay","cancelAppointment"];
  assert.equal((await run("getMyMerchantRole")).data.isMerchant,false);
  for(const action of actions) assert.equal((await run(action)).code,"FORBIDDEN");
  await db.set("admin_roles",identity,{userId:owner._id,status:"ACTIVE"});
  assert.equal((await run("getMyMerchantRole")).data.isMerchant,true);
  assert.equal((await run("getMerchantAppointments",{date})).code,"OK");
  await db.set("users",owner._id,{...owner,status:"DISABLED"});
  for(const action of actions) assert.equal((await run(action)).code,"FORBIDDEN");
  await db.set("users",owner._id,owner);
  await db.set("wechat_accounts",identity,{userId:"someone-else"});
  assert.equal((await run("getMyMerchantRole")).data.isMerchant,false);
  for(const action of actions) assert.equal((await run(action)).code,"FORBIDDEN");
  context.OPENID="";
  assert.equal((await run("getMyMerchantRole")).code,"UNAUTHENTICATED");
});
