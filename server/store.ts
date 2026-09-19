export type Doc = Record<string, any>;
export interface Reader {
  get(collection: string, id: string): Promise<Doc | null>;
  set(collection: string, id: string, data: Doc): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
}
export interface Query {
  equals?: Doc;
  idAfter?: string;
  before?: { field: string; value: number };
  after?: { createdAt: number; id: string };
  order?: { field: string; direction: "asc" | "desc" }[];
  limit: number;
}
export interface Store extends Reader {
  transaction<T>(fn: (tx: Reader) => Promise<T>): Promise<T>;
  query(collection: string, query: Query): Promise<Doc[]>;
}
