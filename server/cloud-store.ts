import cloudbase from "@cloudbase/node-sdk";
import { BusinessError } from "./common";
import { Doc, Query, Reader, Store } from "./store";
export class CloudStore implements Store {
  private db: any;
  constructor(env: string) {
    this.db = cloudbase.init({ env }).database();
  }
  private reader(db: any): Reader {
    return {
      get: async (c, id) => {
        const r = await db.collection(c).doc(id).get();
        if (r.code) throw r;
        return Array.isArray(r.data) ? r.data[0] || null : r.data || null;
      },
      set: async (c, id, data) => {
        const { _id, ...body } = data;
        const r = await db.collection(c).doc(id).set(body);
        if (r.code) throw r;
      },
      remove: async (c, id) => {
        const r = await db.collection(c).doc(id).remove();
        if (r.code) throw r;
      },
    };
  }
  get(c: string, id: string) {
    return this.reader(this.db).get(c, id);
  }
  set(c: string, id: string, d: Doc) {
    return this.reader(this.db).set(c, id, d);
  }
  remove(c: string, id: string) {
    return this.reader(this.db).remove(c, id);
  }
  async transaction<T>(fn: (r: Reader) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tx = await this.db.startTransaction();
      try {
        const value = await fn(this.reader(tx));
        await tx.commit();
        return value;
      } catch (e: any) {
        try {
          await tx.rollback();
        } catch {}
        if (e.code !== "DATABASE_TRANSACTION_CONFLICT") throw e;
        if (attempt === 2) throw new BusinessError("SERVICE_BUSY", 2);
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 40));
      }
    }
    throw new BusinessError("SERVICE_BUSY", 2);
  }
  async query(c: string, q: Query) {
    const cmd = this.db.command;
    const terms: any[] = [q.equals || {}];
    if (q.idAfter) terms.push({ _id: cmd.gt(q.idAfter) });
    if (q.before) terms.push({ [q.before.field]: cmd.lt(q.before.value) });
    if (q.after)
      terms.push(
        cmd.or([
          { createdAt: cmd.lt(q.after.createdAt) },
          { createdAt: q.after.createdAt, _id: cmd.lt(q.after.id) },
        ]),
      );
    let query = this.db.collection(c).where(cmd.and(terms));
    for (const o of q.order || []) query = query.orderBy(o.field, o.direction);
    const result = await query.limit(q.limit).get();
    if (result.code) throw result;
    return result.data as Doc[];
  }
}
