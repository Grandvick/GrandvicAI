// A minimal, purpose-built fake Supabase client for unit tests that exercise
// the real business-logic and AI-tool layers without a live database.
//
// It supports exactly the query-builder surface those layers actually use
// (.select/.eq/.in/.not/.order/.limit/.update/.insert, plus the
// thenable/.maybeSingle/.single terminals), applying simple
// equality/membership filters against a pre-shaped, in-memory table of rows.
// Test data is supplied already in the same snake_case / nested-relation
// shape the real functions' `.select(...)` strings expect (e.g.
// `customers: { full_name: "..." }` for a joined relation) — this fake does
// not attempt to emulate real joins or Postgres filter semantics beyond
// that, which is enough for the AI Core's read-only tool tests (see
// src/lib/ai/tools/read-only.test.ts).
//
// `.insert()` genuinely persists: it generates an id (via randomUUID) for
// any row that doesn't already have one, and pushes the inserted row(s)
// onto the SAME array object backing that table — not a filtered local
// copy — so a later, independent `.from(table)` call (e.g. a business-logic
// function that re-selects what it just inserted, like
// leads.ts's notifyHotLead) sees it too. This is what lets a test prove
// real "insert, then retrieve through the normal read path" persistence
// end-to-end (see src/lib/ai/tools/create-lead-persistence.test.ts),
// something no test using this fake could do before (insert() used to be a
// complete no-op — see CHANGELOG.md).

import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeRow = Record<string, any>;

function makeBuilder(table: FakeRow[]) {
  let rows = table;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      rows = rows.filter((r) => r[col] === val);
      return builder;
    },
    neq(col: string, val: unknown) {
      rows = rows.filter((r) => r[col] !== val);
      return builder;
    },
    in(col: string, vals: unknown[]) {
      rows = rows.filter((r) => vals.includes(r[col]));
      return builder;
    },
    not(col: string, _op: string, val: unknown) {
      rows = rows.filter((r) => r[col] !== val);
      return builder;
    },
    gte(col: string, val: string | number) {
      rows = rows.filter((r) => r[col] >= val);
      return builder;
    },
    lte(col: string, val: string | number) {
      rows = rows.filter((r) => r[col] <= val);
      return builder;
    },
    or() {
      return builder;
    },
    order() {
      return builder;
    },
    limit(n: number) {
      rows = rows.slice(0, n);
      return builder;
    },
    update() {
      return builder;
    },
    insert(record: FakeRow | FakeRow[]) {
      const incoming = Array.isArray(record) ? record : [record];
      const inserted = incoming.map((r) => ({ id: randomUUID(), ...r }));
      // Mutate the ORIGINAL table array (not just this builder's local
      // `rows`) so every other .from(table) call — including one made
      // later, on a fresh builder — sees the new row(s) too.
      table.push(...inserted);
      // A chained .select(...).single()/.maybeSingle() right after
      // .insert(...) (the pattern every business-logic create* function
      // uses) must return exactly what was just inserted, not the whole
      // table.
      rows = inserted;
      return builder;
    },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null };
    },
    async single() {
      return rows[0] ? { data: rows[0], error: null } : { data: null, error: new Error("Row not found") };
    },
    // Makes `const { data, error } = await query` work exactly like the real
    // (thenable) Supabase query builder, for call sites that never invoke a
    // terminal method.
    then(resolve: (v: { data: FakeRow[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

export type FakeTables = Record<string, FakeRow[]>;

/** Builds a fake SupabaseClient-shaped object backed by the given table -> rows data. Cast to SupabaseClient at call sites. */
export function makeFakeSupabase(tables: FakeTables) {
  return {
    from(table: string) {
      // Initialize (once) and reuse the SAME array for this table name so
      // that inserts made through one .from(table) call are visible to a
      // later, separate .from(table) call — never a fresh `?? []` copy,
      // which would silently discard anything inserted so far.
      if (!tables[table]) tables[table] = [];
      return makeBuilder(tables[table]);
    },
  };
}
