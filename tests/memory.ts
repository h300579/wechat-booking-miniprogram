import { Store, Reader, Doc, Query } from "../server/store";
const copy = <T>(v: T): T => structuredClone(v);
export class MemoryStore implements Store {
  data = new Map<string, Doc>();
  versions = new Map<string, number>();
  injectFailure = false;
  conflicts = 0;
  key(c: string, id: string) {
    return `${c}/${id}`;
  }
  async get(c: string, id: string) {
    return copy(this.data.get(this.key(c, id)) || null);
  }
  async set(c: string, id: string, d: Doc) {
    const k = this.key(c, id);
    this.data.set(k, copy({ ...d, _id: id }));
    this.versions.set(k, (this.versions.get(k) || 0) + 1);
  }
  async remove(c: string, id: string) {
    this.data.delete(this.key(c, id));
    this.versions.set(
      this.key(c, id),
      (this.versions.get(this.key(c, id)) || 0) + 1,
    );
  }
  async transaction<T>(fn: (tx: Reader) => Promise<T>): Promise<T> {
    // The emulator retries optimistically; platform retry policy is separately tested.
    for (let n = 0; n < 150; n++) {
      const reads = new Map<string, number>();
      const writes = new Map<string, Doc | null>();
      const tx: Reader = {
        get: async (c, id) => {
          const k = this.key(c, id);
          reads.set(k, this.versions.get(k) || 0);
          return copy(
            writes.has(k) ? writes.get(k)! : this.data.get(k) || null,
          );
        },
        set: async (c, id, d) => {
          const k = this.key(c, id);
          if (!reads.has(k)) reads.set(k, this.versions.get(k) || 0);
          writes.set(k, copy({ ...d, _id: id }));
        },
        remove: async (c, id) => {
          const k = this.key(c, id);
          if (!reads.has(k)) reads.set(k, this.versions.get(k) || 0);
          writes.set(k, null);
        },
      };
      let value;
      try {
        value = await fn(tx);
      } catch (e) {
        throw e;
      }
      if ([...reads].some(([k, v]) => (this.versions.get(k) || 0) !== v)) {
        this.conflicts++;
        continue;
      }
      if (
        this.injectFailure &&
        [...writes.keys()].some((k) => k.startsWith("appointments/"))
      )
        throw new Error("injected commit failure");
      for (const [k, d] of writes) {
        if (d) this.data.set(k, d);
        else this.data.delete(k);
        this.versions.set(k, (this.versions.get(k) || 0) + 1);
      }
      return value;
    }
    throw new Error("retry exhausted");
  }
  async query(c: string, q: Query) {
    let rows = [...this.data]
      .filter(([k]) => k.startsWith(c + "/"))
      .map(([, v]) => copy(v));
    if (q.equals)
      rows = rows.filter((r) =>
        Object.entries(q.equals!).every(([k, v]) => r[k] === v),
      );
    if (q.idAfter) rows = rows.filter((r) => r._id > q.idAfter!);
    if (q.before)
      rows = rows.filter((r) => r[q.before!.field] < q.before!.value);
    if (q.after)
      rows = rows.filter(
        (r) =>
          r.createdAt < q.after!.createdAt ||
          (r.createdAt === q.after!.createdAt && r._id < q.after!.id),
      );
    for (const o of [...(q.order || [])].reverse())
      rows.sort(
        (a, b) =>
          (a[o.field] > b[o.field] ? 1 : a[o.field] < b[o.field] ? -1 : 0) *
          (o.direction === "asc" ? 1 : -1),
      );
    return rows.slice(0, q.limit);
  }
}
