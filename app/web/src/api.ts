export interface User {
  id: string;
  name: string;
  role: "student" | "teacher";
}
export interface Level {
  id: number;
  stage_id: number;
  title: string;
  description: string | null;
  pass_accuracy: number | null; // 合格の目安（正確率）。null なら目安なし（自由に練習）
  passed: boolean; // 自分が合格したか
}
export interface Stage {
  id: number;
  title: string;
  description: string | null;
  levels: Level[];
}
export interface AssignmentBody {
  title: string;
  levelId: number;
  dueAt: string; // ISO8601・UTC
  requiredPlays: number;
  minAccuracy: number | null;
}
export interface AssignmentProgress {
  done: number;
  required: number;
  achieved: boolean;
  overdue: boolean;
  threshold: number | null;
}
export interface MyAssignment extends AssignmentBody, AssignmentProgress {
  id: number;
  levelTitle: string;
  createdAt: string;
}
export interface TeacherAssignment extends AssignmentBody {
  id: number;
  levelTitle: string;
  createdAt: string;
  achievedCount: number;
  students: ({ id: string; name: string } & AssignmentProgress)[];
}
export interface KeyAssign {
  char: string; // keys.char（英字は大文字、; は KC_SCLN、/ は KC_SLSH、空白は Space）
  finger: string; // L1〜L5・R1〜R5（同時押しは L5+L2）
}
export interface KeyboardSettings {
  keyboards: { id: number; name: string; layout: "jis" | "us" | "keyball44" | "free"; used: boolean; keys: KeyAssign[] }[];
  defaultName: string;
  defaultKeys: KeyAssign[];
}
export interface Keyboard {
  id: number;
  name: string;
}
export interface Session {
  sessionId: string;
  level: { id: number; title: string };
  questions: string[];
  source: "ai" | "fixed" | "rule" | "retry"; // 問題の出どころ（画面には出さない。確認・テスト用）
  serverTime: string; // プレイ開始時のサーバー時刻
  receivedAt?: number; // それを受け取った時の端末の時刻（Date.now()）
  analysis?: string; // 苦手克服（トレーニング・レベルごと）のときだけ: 弱点の分析（AI または規則）
  keys?: KeyAssign[]; // このプレイのキーボードのキーと指の割り当て（画面のキーボードの表示用）
  layout?: "jis" | "us" | "keyball44" | "free"; // このプレイのキーボードの並び（画面のキーボードの形）
}
export interface LogInput {
  sessionId: string;
  questionNum: number;
  typed: string;
  startTime: string;
  endTime: string;
}
export interface Score {
  questions: number;
  correctChars: number;
  totalChars: number;
  extraChars: number;
  accuracy: number;
  seconds: number;
  wpm: number;
  cpm: number; // 1 分あたりの文字数
  japanese: boolean; // 日本語の問題が中心か（画面で WPM と 文字/分 のどちらを主に出すか）
}
export interface Analysis {
  total: Score;
  sessions: (Score & { sessionId: string; levelId: number; levelTitle: string; startedAt: string })[];
  chars: { char: string; attempts: number; misses: number; missRate: number }[];
  fingers: { finger: string; attempts: number; misses: number; missRate: number }[];
}
export interface StudentRow {
  id: string;
  name: string;
  sessions: number;
  questions: number;
  lastPlayed: string | null;
  total: Score;
}
export interface AdminLevel {
  id: number;
  stage_id: number;
  sort_order: number;
  title: string;
  description: string | null;
  prompt: string;
  is_active: 0 | 1;
  pass_accuracy: number | null;
  logCount: number;
}
export interface AdminStage {
  id: number;
  sort_order: number;
  title: string;
  description: string | null;
  is_active: 0 | 1;
  levels: AdminLevel[];
}
type StageBody = { title?: string; description?: string; sort_order?: number; is_active?: 0 | 1 };
type LevelBody = StageBody & { prompt?: string; stage_id?: number; pass_accuracy?: number | null };
export interface Result {
  summary: Score;
  levelId: number | null;
  passAccuracy: number | null;
  passed: boolean;
  nextLevel: { id: number; title: string } | null;
  questions: {
    questionNum: number;
    target: string;
    typed: string;
    accuracy: number;
    seconds: number;
    wpm: number;
    cpm: number;
    japanese: boolean;
    mistakes: { index: number; expected: string; actual: string | null }[];
  }[];
}

// API の場所。ページの場所からの相対パスにして、研究室 Web サーバーの /typing/ などのパスの下でも動くようにする
export function apiUrl(path: string): string {
  return `api/${path}`;
}

// ログインの方式。local = 学籍番号でログイン（開発・単体での利用）、proxy = 研究室 Web サーバーの SSO（大学のアカウント）
export type AuthMode = "local" | "proxy";

// proxy 方式では、通信の失敗は SSO のログインの期限切れ（大学のログイン画面への移動）のことが多い
let currentMode: AuthMode = "local";
export function setAuthMode(m: AuthMode) {
  currentMode = m;
}
const unreachable = () =>
  currentMode === "proxy"
    ? "サーバーにつながりません。ログインの期限が切れた可能性があります。ページを再読み込みしてください"
    : "サーバーにつながりません";

// ログインのトークン（タブを閉じると消える）
const TOKEN_KEY = "typing-token";
export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function authHeaders(): Record<string, string> {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers = authHeaders();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(unreachable(), 0);
  }
  if (res.status === 204) return undefined as T;
  // JSON 以外（ログイン画面の HTML など）は成功として扱わない
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) throw new ApiError(unreachable(), res.status);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `通信エラー（${res.status}）`, res.status);
  return data as T;
}

// 練習に使うキーボード（トップやキーボードの設定で選んだもの。結果画面からの「次の問題」でも使う）。
// ブラウザを閉じても覚えておく（端末ごと）。ログインし直した別の人の番号は、一覧にないので使われない（LevelSelect が確かめる）
export const keyboardChoice = {
  get: (): number | null => {
    const v = localStorage.getItem("typing-keyboard");
    return v === null || v === "" ? null : Number(v);
  },
  set: (id: number | null) => localStorage.setItem("typing-keyboard", id === null ? "" : String(id)),
};

export const api = {
  authMode: () => call<{ mode: AuthMode; signOutUrl?: string }>("GET", apiUrl("auth-mode")),
  login: (id: string) => call<{ token: string; user: User }>("POST", apiUrl("login"), { id }),
  logout: () => call<void>("POST", apiUrl("logout")),
  me: () => call<User>("GET", apiUrl("me")),
  stages: () => call<Stage[]>("GET", apiUrl("stages")),
  keyboards: () => call<Keyboard[]>("GET", apiUrl("me/keyboards")),
  // キーボードの設定（学生）
  keyboardSettings: () => call<KeyboardSettings>("GET", apiUrl("me/keyboard-settings")),
  // template: 初めの割り当て（keyball44・jis・us・empty）。copyFrom があれば使わない
  addKeyboard: (name: string, copyFrom: number | null, layout: string, template?: string) =>
    call<{ id: number }>("POST", apiUrl("me/keyboards"), { name, copyFrom, layout, template }),
  updateKeyboard: (id: number, b: { name?: string; keys?: KeyAssign[]; layout?: string }) => call<void>("PATCH", apiUrl(`me/keyboards/${id}`), b),
  deleteKeyboard: (id: number) => call<void>("DELETE", apiUrl(`me/keyboards/${id}`)),
  startSession: async (levelId: number, keyboardId: number | null, retryOf?: string) => {
    const s = await call<Session>("POST", apiUrl("sessions"), { levelId, keyboardId, retryOf });
    // サーバーは問題を用意したあと（AI につないでいると LLM の返事を待ったあと）、返す直前に serverTime を付ける。
    // 往復の真ん中とみなすと、待ち時間の半分だけ端末の時計を進めてしまい「未来の時刻」で断られる（2026-10-23 試作品で、
    // 苦手克服に続き通常のレベルでも発生）。受け取った時刻とみなす（ずれは返事の通信時間だけで、許容 5 秒に収まる）
    return { ...s, receivedAt: Date.now() };
  },
  // 苦手克服トレーニング: 記録から弱点を分析し、次の問題でプレイを始める
  nextTraining: async (keyboardId: number | null) => {
    const s = await call<Session>("POST", apiUrl("training/next"), { keyboardId });
    // サーバーは LLM の返事を待ったあと（返す直前）に serverTime を付ける。往復の真ん中とみなすと、
    // LLM の待ち時間（15 秒ほど）の半分だけ端末の時計を進めてしまい、記録が「未来の時刻」で断られる（2026-10-23 試作品）。
    // 受け取った時刻とみなす（ずれは返事の通信時間だけで、サーバーの許容 5 秒に収まる）
    return { ...s, receivedAt: Date.now() };
  },
  // レベルごとの苦手克服: そのレベルの記録から弱点を分析し、そのレベルの範囲で苦手を補う問題でプレイを始める
  levelTraining: async (levelId: number, keyboardId: number | null) => {
    const s = await call<Session>("POST", apiUrl(`levels/${levelId}/training`), { keyboardId });
    // serverTime は LLM の返事を待ったあとに付くので、受け取った時刻とみなす（nextTraining と同じ理由）
    return { ...s, receivedAt: Date.now() };
  },
  saveLog: (log: LogInput) => call<{ id: number }>("POST", apiUrl("logs"), log),
  myAnalysis: () => call<Analysis>("GET", apiUrl("me/analysis")),
  myAssignments: () => call<MyAssignment[]>("GET", apiUrl("me/assignments")),
  teacherAssignments: () => call<TeacherAssignment[]>("GET", apiUrl("teacher/assignments")),
  createAssignment: (b: AssignmentBody) => call<{ id: number }>("POST", apiUrl("teacher/assignments"), b),
  updateAssignment: (id: number, b: Partial<AssignmentBody>) => call<void>("PATCH", apiUrl(`teacher/assignments/${id}`), b),
  deleteAssignment: (id: number) => call<void>("DELETE", apiUrl(`teacher/assignments/${id}`)),
  classWeakness: () =>
    call<{
      chars: { char: string; attempts: number; misses: number; missRate: number }[];
      fingers: { finger: string; attempts: number; misses: number; missRate: number }[];
      students: number;
    }>("GET", apiUrl("teacher/class-weakness")),
  students: () => call<StudentRow[]>("GET", apiUrl("teacher/students")),
  addStudents: (users: { id: string; name: string }[], keyboard = true) =>
    call<{ added: string[] }>("POST", apiUrl("teacher/users"), { users, keyboard }),
  renameStudent: (id: string, name: string) => call<void>("PATCH", apiUrl(`teacher/users/${encodeURIComponent(id)}`), { name }),
  deleteStudent: (id: string) => call<void>("DELETE", apiUrl(`teacher/users/${encodeURIComponent(id)}`)),
  studentAnalysis: (id: string) =>
    call<Analysis & { user: { id: string; name: string } }>("GET", apiUrl(`teacher/students/${encodeURIComponent(id)}/analysis`)),
  adminStages: () => call<AdminStage[]>("GET", apiUrl("teacher/stages")),
  createStage: (b: StageBody) => call<{ id: number }>("POST", apiUrl("teacher/stages"), b),
  updateStage: (id: number, b: StageBody) => call<void>("PATCH", apiUrl(`teacher/stages/${id}`), b),
  deleteStage: (id: number) => call<void>("DELETE", apiUrl(`teacher/stages/${id}`)),
  createLevel: (b: LevelBody) => call<{ id: number }>("POST", apiUrl("teacher/levels"), b),
  updateLevel: (id: number, b: LevelBody) => call<void>("PATCH", apiUrl(`teacher/levels/${id}`), b),
  deleteLevel: (id: number) => call<void>("DELETE", apiUrl(`teacher/levels/${id}`)),
  logsCsv: async () => {
    const res = await fetch(apiUrl("teacher/logs.csv"), { headers: authHeaders() });
    if (!res.ok) throw new ApiError(`CSV を取り出せませんでした（${res.status}）`, res.status);
    return res.blob();
  },
  result: (sessionId: string) => call<Result>("GET", apiUrl(`sessions/${encodeURIComponent(sessionId)}/result`)),
};
