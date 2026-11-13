// ログイン状態の管理（DB には保存せず、サーバーのメモリに置く。サーバーを再起動するとログインし直しになる）
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type Role = "student" | "teacher";

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
}

// 教員の指定（DB の構造は変えず、起動時の設定で指定する）
//   TEACHER_IDS=t001,t002   教員として扱う ID（カンマ区切り）
export interface TeacherConfig {
  ids: string[];
  passcode?: string | null; // 使わない（2026-11-13 に教員の合言葉をなくした。古い設定・テストが渡しても無視する）
}

export function teacherConfigFromEnv(env = process.env): TeacherConfig {
  return {
    ids: (env.TEACHER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  };
}

export function passcodeMatches(expected: string | null, given: unknown): boolean {
  if (expected === null || typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ログインの有効期限（最後に使ってから 12 時間）
export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export class TokenStore {
  private tokens = new Map<string, { user: AuthUser; lastUsed: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(user: AuthUser): string {
    // 期限切れのトークンを片付ける
    for (const [t, v] of this.tokens) if (this.now() - v.lastUsed > TOKEN_TTL_MS) this.tokens.delete(t);
    const token = randomBytes(24).toString("hex");
    this.tokens.set(token, { user, lastUsed: this.now() });
    return token;
  }

  get(token: string): AuthUser | undefined {
    const v = this.tokens.get(token);
    if (!v) return undefined;
    if (this.now() - v.lastUsed > TOKEN_TTL_MS) {
      this.tokens.delete(token);
      return undefined;
    }
    v.lastUsed = this.now();
    return v.user;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }
}

// ---- SSO（研究室 Web サーバーの oauth2-proxy）から本人を受け取る方式 ----
// AUTH_MODE=proxy のとき、ログインは研究室 Web サーバーの oauth2-proxy（大学 Google アカウント）が行い、
// アプリは oauth2-proxy が付けるヘッダーのメールアドレスで本人を判定する。アプリはパスワードも Google の秘密も持たない。
//
//   AUTH_MODE=proxy
//   PROXY_SECRET=...                      プロキシとアプリだけが知る値。この値のヘッダー（PROXY_SECRET_HEADER）が
//                                         付いた要求だけ、本人のヘッダーを信じる（ブラウザからの偽のヘッダー対策）
//   PROXY_SECRET_HEADER=X-Proxy-Secret    上の値を載せるヘッダー名
//   PROXY_EMAIL_HEADER=X-Forwarded-Email  本人のメールアドレスのヘッダー名（oauth2-proxy の標準）
//   ALLOWED_EMAIL_DOMAIN=mail.example.ac.jp
//   TEACHER_EMAILS=a@mail.example.ac.jp   教員として扱うメールアドレス（カンマ区切り。ドメインは問わない）
//   SIGN_OUT_URL=/oauth2/sign_out         画面の「ログアウト」の移動先（oauth2-proxy のログアウト）
//
// 学生は「メールの @ より前 = 学籍番号」が users に登録されている人だけ（データベース説明.md: 学籍番号をログイン ID に使う）。

export interface ProxyAuthConfig {
  secret: string;
  secretHeader: string;
  emailHeader: string;
  allowedDomain: string;
  teacherEmails: string[];
  signOutUrl: string;
}

export type AuthMode = { mode: "local" } | ({ mode: "proxy" } & ProxyAuthConfig);

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== "");

// 設定が足りないときは起動させない（秘密なしでヘッダーを信じると、誰でも他人になりすませるため）
export function authModeFromEnv(env = process.env): AuthMode {
  const mode = env.AUTH_MODE ?? "local";
  // SSO の設定（PROXY_SECRET）があるのに AUTH_MODE を付け忘れると、学籍番号だけで誰にでもなれてしまうので起動しない
  if (mode === "local" && env.PROXY_SECRET) throw new Error("PROXY_SECRET が設定されています。SSO で使うなら AUTH_MODE=proxy を付けてください");
  if (mode === "local") return { mode: "local" };
  if (mode !== "proxy") throw new Error(`AUTH_MODE は local か proxy です: ${mode}`);
  if (!env.PROXY_SECRET || env.PROXY_SECRET.length < 16) throw new Error("AUTH_MODE=proxy には 16 文字以上の PROXY_SECRET が必要です");
  return {
    mode: "proxy",
    secret: env.PROXY_SECRET,
    secretHeader: env.PROXY_SECRET_HEADER ?? "X-Proxy-Secret",
    emailHeader: env.PROXY_EMAIL_HEADER ?? "X-Forwarded-Email",
    allowedDomain: (env.ALLOWED_EMAIL_DOMAIN ?? "mail.example.ac.jp").toLowerCase(),
    teacherEmails: list(env.TEACHER_EMAILS),
    // oauth2-proxy のログアウト先（既定の proxy-prefix は /oauth2）。研究室の設定に合わせて変える
    signOutUrl: env.SIGN_OUT_URL ?? "/oauth2/sign_out",
  };
}

export type ProxyIdentity =
  { ok: true; email: string; kind: "teacher" | "student"; studentId: string } | { ok: false; status: 401 | 403; error: string };

// ヘッダーから本人を読み取る（DB は見ない。学生が users にいるかは呼び出し側で確かめる）
export function readProxyIdentity(cfg: ProxyAuthConfig, get: (name: string) => string | undefined): ProxyIdentity {
  if (!passcodeMatches(cfg.secret, get(cfg.secretHeader)))
    return { ok: false, status: 401, error: "研究室の Web サーバーを経由してアクセスしてください" };
  const email = (get(cfg.emailHeader) ?? "").trim().toLowerCase();
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(email);
  if (!m) return { ok: false, status: 401, error: "ログインしてください（大学のアカウント）" };
  if (cfg.teacherEmails.includes(email)) return { ok: true, email, kind: "teacher", studentId: m[1] };
  if (m[2] !== cfg.allowedDomain) return { ok: false, status: 403, error: `大学のアカウント（@${cfg.allowedDomain}）でログインしてください` };
  return { ok: true, email, kind: "student", studentId: m[1] };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      token?: string;
    }
  }
}

function bearer(req: Request): string | null {
  const h = req.get("authorization") ?? "";
  const m = /^Bearer ([0-9a-f]+)$/.exec(h);
  return m ? m[1] : null;
}

// proxy 方式では、要求ごとにヘッダーから本人を決める（トークンは使わない）
export type ProxyResolver = (req: Request) => { user: AuthUser } | { status: number; error: string };

export function requireLogin(store: TokenStore, proxy?: ProxyResolver) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (proxy) {
      const r = proxy(req);
      if ("error" in r) return res.status(r.status).json({ error: r.error });
      req.user = r.user;
      return next();
    }
    const token = bearer(req);
    const user = token ? store.get(token) : undefined;
    if (!token || !user) return res.status(401).json({ error: "ログインしてください" });
    req.user = user;
    req.token = token;
    next();
  };
}

// ログインしていれば req.user を入れ、していなくても通す（ログイン前でも見られる API 用）
export function optionalLogin(store: TokenStore, proxy?: ProxyResolver) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (proxy) {
      const r = proxy(req);
      if (!("error" in r)) req.user = r.user;
      return next();
    }
    const token = bearer(req);
    const user = token ? store.get(token) : undefined;
    if (token && user) {
      req.user = user;
      req.token = token;
    }
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "この操作はできません" });
    next();
  };
}
