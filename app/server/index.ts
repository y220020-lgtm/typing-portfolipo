import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { openDb } from "./db";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

// API と、npm run build で作った画面（dist/）を 1 つのサーバーで配る。
// basePath: 研究室 Web サーバーで /typing/ などのパスの下に置き、そのパスを付けたまま転送される場合に指定する
//           （パスを外して転送される場合や、単体で動かす場合は空のまま）。
export function createServer(api: Express, basePath = "", dist = DIST): Express {
  const base = basePath.replace(/\/+$/, "");
  if (base !== "" && !/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(base))
    throw new Error(`BASE_PATH は /typing のように / で始まるパスです: ${basePath}`);
  const hasDist = fs.existsSync(path.join(dist, "index.html"));
  const site = express();
  // 画面は相対パスで API を呼ぶので、/typing（末尾 / なし）は /typing/ に移動させる。
  // 302（一時的）にする: 301 はブラウザに長く記憶され、後で Caddy の設定を変えたときに古い移動が残るため
  if (base !== "")
    site.get("/", (req, res, next) => {
      const [p, q] = req.originalUrl.split("?");
      return p === base ? res.redirect(302, `${base}/${q === undefined ? "" : `?${q}`}`) : next();
    });
  site.use(api);
  if (hasDist) {
    // 画面は 1 ページだけ（URL は / のみ）。それ以外の不明なパスは 404 にする
    // （深い URL に画面を返すと、相対パスの JS や API まで画面の HTML が返って壊れるため）
    site.use(express.static(dist, { redirect: false }));
  }
  if (base === "") return site;
  const root = express();
  root.use(base, site);
  return root;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT ?? 3000);
  // 待ち受けるアドレス。既定は VM 内（127.0.0.1）だけ。
  // AUTH_MODE=proxy では、研究室 Web サーバー（プロキシ）以外から直接つながらないよう、127.0.0.1 のままにすること
  const HOST = process.env.HOST ?? "127.0.0.1";
  const db = openDb();
  // 表のない DB（ファイル名の間違いなどで新しく空のファイルができた場合）で起動しない
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  const missing = ["users", "stages", "levels", "keyboards", "keys", "logs"].filter((t) => !tables.includes(t));
  if (missing.length > 0) {
    console.error(`DB に表がありません（${missing.join(", ")}）: ${db.name}`);
    console.error("先に DB を作ってください（例: DB_PATH=同じパス npm run db:init。app/README.md）");
    process.exit(1);
  }
  const server = createServer(createApp(db), process.env.BASE_PATH ?? "");
  server.listen(PORT, HOST, () => {
    const mode = process.env.AUTH_MODE ?? "local";
    console.log(`サーバー: http://${HOST}:${PORT}${process.env.BASE_PATH ?? ""}/ （ログイン方式: ${mode}）`);
  });
}
