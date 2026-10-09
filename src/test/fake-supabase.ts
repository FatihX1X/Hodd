// Minimal in-memory stand-in for the supabase-js query builder used by server
// modules under test: from().select/insert/update + eq/in/is filters, plus rpc.
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
export type RpcHandler = (name: string, params: Record<string, unknown>, tables: Record<string, Row[]>) => Result | Promise<Result>;

const read = (row: Row, key: string): unknown => {
  const [column, field] = key.split("->>");
  const value = row[column];
  return field === undefined ? value : value && typeof value === "object" ? String((value as Row)[field] ?? "") : undefined;
};
const clone = <T>(value: T): T => structuredClone(value);

class Query implements PromiseLike<Result> {
  private op: "select" | "update" | "insert" = "select";
  private values: Row | Row[] = {};
  private filters: ((row: Row) => boolean)[] = [];
  private returning = false;
  constructor(private readonly tables: Record<string, Row[]>, private readonly table: string, private readonly unique: string[][]) {}
  select() { if (this.op !== "select") this.returning = true; return this; }
  update(values: Row) { this.op = "update"; this.values = values; return this; }
  insert(values: Row | Row[]) { this.op = "insert"; this.values = values; return this; }
  eq(key: string, value: unknown) { this.filters.push((row) => read(row, key) === value); return this; }
  in(key: string, values: unknown[]) { this.filters.push((row) => values.includes(read(row, key))); return this; }
  is(key: string, value: null) { this.filters.push((row) => (read(row, key) ?? null) === value); return this; }
  order() { return this; }
  limit() { return this; }
  private run(): Result {
    const rows = this.tables[this.table] ??= [];
    if (this.op === "insert") {
      for (const value of ([] as Row[]).concat(this.values)) {
        if (this.unique.some((keys) => rows.some((row) => keys.every((key) => row[key] === value[key])))) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        rows.push(clone(value));
      }
      return { data: null, error: null };
    }
    const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.op === "update") {
      for (const row of matched) Object.assign(row, clone(this.values));
      return { data: this.returning ? matched.map(clone) : null, error: null };
    }
    return { data: matched.map(clone), error: null };
  }
  then<A = Result, B = never>(resolve?: ((value: Result) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null) { return Promise.resolve(this.run()).then(resolve, reject); }
  maybeSingle() { const result = this.run(); return Promise.resolve({ data: (result.data as Row[] | null)?.[0] ?? null, error: result.error }); }
  single() { const result = this.run(); const rows = (result.data as Row[] | null) ?? []; return Promise.resolve(rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not a single row" } }); }
}

/** Unique keys per table, mirroring the constraints the code relies on. */
export function fakeSupabase(tables: Record<string, Row[]>, rpc: RpcHandler = () => ({ data: null, error: { message: "unknown rpc" } }), unique: Record<string, string[][]> = {}) {
  return {
    tables,
    from: (table: string) => new Query(tables, table, unique[table] ?? [["id"]]),
    rpc: async (name: string, params: Record<string, unknown>) => rpc(name, params, tables),
  };
}
