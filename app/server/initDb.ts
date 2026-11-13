// 開発用 DB（app/data/dev.db）を schema.sql と初期データから作り直す。
// 実行: npm run db:init
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DB_PATH, SCHEMA_PATH, openDb } from "./db";

const SEED_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "seed", "seed.sql");

export function initDb(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  const db = openDb(file);
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  db.exec(fs.readFileSync(SEED_PATH, "utf8"));
  db.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  initDb(file);
  console.log(`開発用 DB を作成しました: ${file}`);
}
