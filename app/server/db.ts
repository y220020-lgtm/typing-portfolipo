import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SCHEMA_PATH = path.resolve(appDir, "..", "db", "schema.sql");
// 開発用 DB。正本 タイピング.db は使わない（AGENTS.md §4）。
export const DEFAULT_DB_PATH = path.join(appDir, "data", "dev.db");

export type DB = Database.Database;

export function openDb(file = process.env.DB_PATH ?? DEFAULT_DB_PATH): DB {
  const db = new Database(file);
  // 外部キーは接続ごとに有効化が必要（データベース仕様書 §3 🅴）
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  return db;
}
