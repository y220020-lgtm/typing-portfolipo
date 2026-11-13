import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { openDb, type DB } from "./db";
import { createServer } from "./index";
import { initDb } from "./initDb";

// 画面と API を 1 つのサーバーで配る（npm start）。研究室 Web サーバーの /typing/ の下に置く場合も含めて確かめる。
let dir: string;
let dist: string;
let db: DB;
let api: ReturnType<typeof createApp>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-server-"));
  initDb(path.join(dir, "t.db"));
  db = openDb(path.join(dir, "t.db"));
  api = createApp(db, { teachers: { ids: [], passcode: null }, ai: null, auth: { mode: "local" } });
  // ビルド済みの画面の代わり
  dist = path.join(dir, "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), "<title>タイピング練習</title>");
  fs.writeFileSync(path.join(dist, "assets", "a.js"), "console.log(1)");
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createServer（パスの前置きなし）", () => {
  it("画面・API・画面のファイルを配り、存在しない API は 404（画面を返さない）", async () => {
    const s = createServer(api, "", dist);
    expect((await request(s).get("/")).text).toContain("タイピング練習");
    expect((await request(s).get("/assets/a.js")).status).toBe(200);
    expect((await request(s).get("/api/auth-mode")).body).toEqual({ mode: "local" });
    expect((await request(s).get("/api/nothing")).status).toBe(404);
    expect((await request(s).get("/api/nothing")).body).toEqual({ error: "見つかりません" });
  });
  it("深い URL には画面を返さない（相対パスの JS や API まで HTML が返って壊れるのを防ぐ）", async () => {
    const s = createServer(api, "", dist);
    expect((await request(s).get("/foo/bar")).status).toBe(404);
    expect((await request(s).get("/foo/assets/a.js")).status).toBe(404);
    expect((await request(s).get("/foo/api/me")).status).toBe(404);
    expect((await request(s).get("/oauth2/sign_out")).status).toBe(404);
  });
});

describe("createServer（BASE_PATH=/typing）", () => {
  it("/typing/ の下で画面と API を配る", async () => {
    const s = createServer(api, "/typing", dist);
    expect((await request(s).get("/typing/")).text).toContain("タイピング練習");
    expect((await request(s).get("/typing/assets/a.js")).status).toBe(200);
    expect((await request(s).get("/typing/api/stages")).body[0].title).toBe("ホームポジション基礎");
    // 画面は相対パス（api/...）で呼ぶので、/typing は /typing/ に移動させる
    const r = await request(s).get("/typing");
    expect(r.status).toBe(302); // 301 はブラウザに長く記憶されるため 302
    expect(r.headers.location).toBe("/typing/");
    expect((await request(s).get("/typing?x=1")).headers.location).toBe("/typing/?x=1");
    // 深い URL・パスの下の oauth2 は 404（アプリは画面を返さない）
    expect((await request(s).get("/typing/foo/assets/a.js")).status).toBe(404);
    expect((await request(s).get("/typing/foo/api/me")).status).toBe(404);
    expect((await request(s).get("/typing/oauth2/sign_out")).status).toBe(404);
    // パスの外は配らない
    expect((await request(s).get("/api/stages")).status).toBe(404);
    expect((await request(s).get("/")).status).toBe(404);
  });
  it("末尾の / は無視し、不正な値は起動しない", () => {
    expect(() => createServer(api, "/typing/", dist)).not.toThrow();
    expect(() => createServer(api, "typing", dist)).toThrow(/BASE_PATH/);
    expect(() => createServer(api, "/a b", dist)).toThrow(/BASE_PATH/);
  });
});
