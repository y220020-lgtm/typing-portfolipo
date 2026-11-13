import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { authModeFromEnv, readProxyIdentity, type ProxyAuthConfig } from "./auth";
import { openDb, type DB } from "./db";
import { initDb } from "./initDb";

// SSO（研究室 Web サーバーの oauth2-proxy）から本人を受け取る方式のテスト。
// oauth2-proxy の代わりに、テストが直接ヘッダーを付ける。
const SECRET = "test-proxy-secret-0123456789";
const CFG: ProxyAuthConfig = {
  secret: SECRET,
  secretHeader: "X-Proxy-Secret",
  emailHeader: "X-Forwarded-Email",
  allowedDomain: "mail.example.ac.jp",
  teacherEmails: ["teacher@mail.example.ac.jp"],
  signOutUrl: "/oauth2/sign_out",
};

describe("authModeFromEnv", () => {
  it("既定は local", () => {
    expect(authModeFromEnv({})).toEqual({ mode: "local" });
  });
  it("proxy には 16 文字以上の PROXY_SECRET が必要（なければ起動しない）", () => {
    expect(() => authModeFromEnv({ AUTH_MODE: "proxy" })).toThrow(/PROXY_SECRET/);
    expect(() => authModeFromEnv({ AUTH_MODE: "proxy", PROXY_SECRET: "short" })).toThrow(/PROXY_SECRET/);
    expect(() => authModeFromEnv({ AUTH_MODE: "sso" })).toThrow(/local か proxy/);
  });
  it("PROXY_SECRET があるのに AUTH_MODE を付け忘れたら起動しない（学籍番号だけで誰にでもなれるのを防ぐ）", () => {
    expect(() => authModeFromEnv({ PROXY_SECRET: SECRET })).toThrow(/AUTH_MODE=proxy/);
  });
  it("ログアウト先は設定で変えられる", () => {
    expect(authModeFromEnv({ AUTH_MODE: "proxy", PROXY_SECRET: SECRET, SIGN_OUT_URL: "/typing/oauth2/sign_out" })).toMatchObject({
      signOutUrl: "/typing/oauth2/sign_out",
    });
  });
  it("proxy の既定値", () => {
    expect(authModeFromEnv({ AUTH_MODE: "proxy", PROXY_SECRET: SECRET, TEACHER_EMAILS: " A@Mail.example.ac.jp , " })).toEqual({
      mode: "proxy",
      ...CFG,
      teacherEmails: ["a@mail.example.ac.jp"],
    });
  });
});

describe("readProxyIdentity", () => {
  const h = (headers: Record<string, string>) => (name: string) => headers[name];
  it("秘密が合わなければ、メールがあっても 401", () => {
    expect(readProxyIdentity(CFG, h({ "X-Forwarded-Email": "y220020@mail.example.ac.jp" }))).toMatchObject({ ok: false, status: 401 });
    expect(readProxyIdentity(CFG, h({ "X-Proxy-Secret": "wrong", "X-Forwarded-Email": "y220020@mail.example.ac.jp" }))).toMatchObject({
      ok: false,
      status: 401,
    });
  });
  it("大学のアドレスは学籍番号として読む（大文字・空白を除く）", () => {
    expect(readProxyIdentity(CFG, h({ "X-Proxy-Secret": SECRET, "X-Forwarded-Email": " Y220020@Mail.Example.ac.jp " }))).toEqual({
      ok: true,
      email: "y220020@mail.example.ac.jp",
      kind: "student",
      studentId: "y220020",
    });
  });
  it("大学以外のアドレスは 403、形式が違えば 401", () => {
    expect(readProxyIdentity(CFG, h({ "X-Proxy-Secret": SECRET, "X-Forwarded-Email": "y220020@gmail.com" }))).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(readProxyIdentity(CFG, h({ "X-Proxy-Secret": SECRET, "X-Forwarded-Email": "y220020" }))).toMatchObject({ ok: false, status: 401 });
    expect(readProxyIdentity(CFG, h({ "X-Proxy-Secret": SECRET, "X-Forwarded-Email": "a@b@mail.example.ac.jp" }))).toMatchObject({
      ok: false,
      status: 401,
    });
  });
  it("TEACHER_EMAILS のアドレスは教員", () => {
    expect(readProxyIdentity(CFG, h({ "X-Proxy-Secret": SECRET, "X-Forwarded-Email": "teacher@mail.example.ac.jp" }))).toMatchObject({
      ok: true,
      kind: "teacher",
    });
  });
});

describe("AUTH_MODE=proxy の API", () => {
  let dir: string;
  let db: DB;
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-proxy-"));
    const file = path.join(dir, "t.db");
    initDb(file);
    db = openDb(file);
    // 学籍番号ログインの設定（TEACHER_IDS）があっても、proxy 方式では使わないことを確かめる
    app = createApp(db, { teachers: { ids: ["t001"], passcode: "pass" }, ai: null, auth: { mode: "proxy", ...CFG } });
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const as = (email: string) => ({ "X-Proxy-Secret": SECRET, "X-Forwarded-Email": email });

  it("画面に方式を知らせる", async () => {
    expect((await request(app).get("/api/auth-mode")).body).toEqual({ mode: "proxy", signOutUrl: "/oauth2/sign_out" });
  });
  it("登録済みの学生は、ヘッダーのメールで本人として扱われる", async () => {
    const res = await request(app).get("/api/me").set(as("y220020@mail.example.ac.jp"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "y220020", name: "高木勇輔", role: "student" });
  });
  it("users にいない学生は 403", async () => {
    const res = await request(app).get("/api/me").set(as("y999999@mail.example.ac.jp"));
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("y999999");
  });
  it("なりすまし対策: 秘密のヘッダーがない・違うなら、メールのヘッダーを送っても 401", async () => {
    expect((await request(app).get("/api/me").set({ "X-Forwarded-Email": "y220020@mail.example.ac.jp" })).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/me")
          .set({ "X-Proxy-Secret": "x".repeat(28), "X-Forwarded-Email": "y220020@mail.example.ac.jp" })
      ).status,
    ).toBe(401);
  });
  it("学籍番号でのログインとトークンは使えない", async () => {
    expect((await request(app).post("/api/login").send({ id: "y220020" })).status).toBe(404);
    expect((await request(app).post("/api/login").send({ id: "t001", passcode: "pass" })).status).toBe(404);
    expect(
      (
        await request(app)
          .get("/api/me")
          .set({ Authorization: "Bearer " + "a".repeat(48) })
      ).status,
    ).toBe(401);
  });
  it("学生は練習して記録できる（user_id はヘッダーの本人）", async () => {
    const h = as("y220020@mail.example.ac.jp");
    const s = await request(app).post("/api/sessions").set(h).send({ levelId: 1, keyboardId: 1 });
    expect(s.status).toBe(200);
    const res = await request(app).post("/api/logs").set(h).send({
      sessionId: s.body.sessionId,
      questionNum: 1,
      typed: s.body.questions[0],
      startTime: s.body.serverTime,
      endTime: new Date().toISOString(),
    });
    expect(res.status).toBe(201);
    expect((db.prepare("SELECT user_id FROM logs").get() as { user_id: string }).user_id).toBe("y220020");
    // 他人のメールでは、そのプレイに記録できない
    const other = await request(app)
      .post("/api/logs")
      .set(as("sample@mail.example.ac.jp"))
      .send({ sessionId: s.body.sessionId, questionNum: 2, typed: "x", startTime: s.body.serverTime, endTime: new Date().toISOString() });
    expect(other.status).toBe(404);
  });
  it("教員は TEACHER_EMAILS のアドレスで、教員の API を使える。学生は使えない", async () => {
    const t = await request(app).get("/api/teacher/students").set(as("teacher@mail.example.ac.jp"));
    expect(t.status).toBe(200);
    expect((await request(app).get("/api/me").set(as("teacher@mail.example.ac.jp"))).body).toMatchObject({
      role: "teacher",
      id: "teacher@mail.example.ac.jp",
    });
    expect((await request(app).get("/api/teacher/students").set(as("y220020@mail.example.ac.jp"))).status).toBe(403);
  });
  it("SSO の教員も学生の画面で練習でき、学生一覧には出ない", async () => {
    const t = as("teacher@mail.example.ac.jp");
    const s = await request(app).post("/api/sessions").set(t).send({ levelId: 1 });
    expect(s.status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/logs")
          .set(t)
          .send({ sessionId: s.body.sessionId, questionNum: 1, typed: "f", startTime: s.body.serverTime, endTime: new Date().toISOString() })
      ).status,
    ).toBe(201);
    expect(((await request(app).get("/api/teacher/students").set(t)).body as { id: string }[]).map((u) => u.id)).not.toContain(
      "teacher@mail.example.ac.jp",
    );
    // 練習のために users に行ができても、本人は教員のまま
    expect((await request(app).get("/api/me").set(t)).body.role).toBe("teacher");
  });
  it("教員の名前は users を引かない（同じ ID の学生がいても、その学生の名前にならない）", async () => {
    const app2 = createApp(db, {
      teachers: { ids: [], passcode: null },
      ai: null,
      auth: { mode: "proxy", ...CFG, teacherEmails: ["y220020@mail.example.ac.jp"] },
    });
    expect((await request(app2).get("/api/me").set(as("y220020@mail.example.ac.jp"))).body).toEqual({
      id: "y220020@mail.example.ac.jp",
      name: "y220020",
      role: "teacher",
    });
  });
  it("大学以外のアドレスは 403", async () => {
    expect((await request(app).get("/api/me").set(as("y220020@gmail.com"))).status).toBe(403);
  });
});

describe("AUTH_MODE=local（既定）では SSO のヘッダーを無視する", () => {
  it("秘密とメールのヘッダーを送っても、トークンがなければ 401", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typing-local-"));
    const file = path.join(dir, "t.db");
    initDb(file);
    const db = openDb(file);
    const app = createApp(db, { teachers: { ids: [], passcode: null }, ai: null, auth: { mode: "local" } });
    expect((await request(app).get("/api/auth-mode")).body).toEqual({ mode: "local" });
    expect((await request(app).get("/api/me").set({ "X-Proxy-Secret": SECRET, "X-Forwarded-Email": "y220020@mail.example.ac.jp" })).status).toBe(401);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
