import type { Database as BunDatabase } from "bun:sqlite";
import type DatabaseConstructor from "better-sqlite3";

export interface Statement {
  all(params?: Record<string, unknown>): unknown[];
  get(params?: Record<string, unknown>): unknown | undefined;
}

export interface Database {
  prepare(sql: string): Statement;
  close(): void;
}

function isBun(): boolean {
  return typeof (globalThis as Record<string, unknown>).Bun !== "undefined";
}

function stripParamPrefix(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key.replace(/^[$:@]/, "")] = value;
  }
  return result;
}

export async function openDatabase(path: string): Promise<Database> {
  if (isBun()) {
    const { Database } = await import("bun:sqlite");
    const db = new Database(path, { readonly: true, create: false }) as BunDatabase;
    return {
      prepare: (sql) => {
        const stmt = db.query(sql) as unknown as {
          all(params?: Record<string, unknown>): unknown[];
          get(params?: Record<string, unknown>): unknown | undefined;
        };
        return {
          all: (params) => (params ? stmt.all(params) : stmt.all()) as unknown[],
          get: (params) =>
            (params ? stmt.get(params) : stmt.get()) as unknown | undefined,
        };
      },
      close: () => db.close(),
    };
  }

  const { default: Database } = await import("better-sqlite3");
  const db = new Database(path, { readonly: true, fileMustExist: true }) as ReturnType<typeof DatabaseConstructor>;
  return {
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        all: (params) =>
          (params ? stmt.all(stripParamPrefix(params)) : stmt.all()) as unknown[],
        get: (params) =>
          (params
            ? stmt.get(stripParamPrefix(params))
            : stmt.get()) as unknown | undefined,
      };
    },
    close: () => db.close(),
  };
}
