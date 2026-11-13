// AI による問題生成（データベース仕様書 🅳 / データベース説明 🅲 の方針）
// - AI との通信はサーバー側だけで行う（API キーを画面に渡さない）
// - 生成した問題はレベルごとに一定時間キャッシュして使い回す（呼び出し回数と待ち時間を減らす）
// - 設定がない・失敗した・結果が使えないときは固定問題（questions.ts）で出題する
//
// 接続先は OpenAI 互換の /chat/completions 形式（研究室の LiteLLM プロキシなど）。
//   AI_BASE_URL=http://.../v1   AI_API_KEY=...   AI_MODEL=...   AI_CACHE_SECONDS=3600（省略時 1 時間）

export interface AiConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  cacheSeconds: number;
  timeoutMs: number;
  // 研究室の Qwen（vLLM）は、答える前に長く「考える」ため、止めないと返答が遅く本文が空になる（2026-10-23 実測）。
  // AI_DISABLE_THINKING=1 のとき chat_template_kwargs.enable_thinking=false を送る（vLLM の Qwen3 用の指定）
  disableThinking?: boolean;
  maxTokens?: number; // 返答の長さの上限（AI_MAX_TOKENS。未指定なら送らない）
}

export function aiConfigFromEnv(env = process.env): AiConfig | null {
  if (!env.AI_BASE_URL || !env.AI_MODEL) return null;
  return {
    baseUrl: env.AI_BASE_URL.replace(/\/+$/, ""),
    apiKey: env.AI_API_KEY ? env.AI_API_KEY : null,
    model: env.AI_MODEL,
    cacheSeconds: Number(env.AI_CACHE_SECONDS ?? 3600),
    timeoutMs: Number(env.AI_TIMEOUT_MS ?? 15000),
    disableThinking: env.AI_DISABLE_THINKING === "1",
    maxTokens: env.AI_MAX_TOKENS ? Number(env.AI_MAX_TOKENS) : undefined,
  };
}

// 出題に使える問題の条件: 1〜40 文字で、次の文字だけ（キーボードと日本語入力で打てる文字）
// - 半角の英数字・記号・空白
// - ひらがな・カタカナ（長音「ー」を含む）・漢字（常用の範囲の CJK 統合漢字と「々」）
// - 日本語の句読点・括弧・記号（、。・「」『』！？ など）と全角の空白
// 全角の英数字（Ａ、１）は、半角と見分けにくく打つ人が迷うため受け付けない。絵文字なども受け付けない。
export const MAX_LEN = 40;
const TYPABLE =
  /^[\x20-\x7e\u3000-\u3003\u3005\u300c-\u300f\u3041-\u3096\u309b-\u309e\u30a1-\u30fa\u30fc-\u30fe\u4e00-\u9fff\uff01\uff1f\uff08\uff09]+$/;

export function isTypable(q: string): boolean {
  const n = Array.from(q).length;
  return n >= 1 && n <= MAX_LEN && TYPABLE.test(q);
}

// AI の返答から問題のリストを取り出す。返答の中の最初の JSON 文字列配列だけを使う。
// 読み取れない返答は空（→ 固定問題で出題）にする。形の崩れた問題が logs に残らないよう、推測で読み取らない。
export function parseQuestions(text: string): string[] {
  const body = text.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");
  const items = firstJsonArray(body);
  if (!items) return [];
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const q = item.trim();
    if (isTypable(q) && !result.includes(q)) result.push(q);
  }
  return result;
}

// 文字列中で、JSON として読める最初の配列を探す（"[10]" のような前置きの括弧は飛ばす。末尾カンマは許す）
function firstJsonArray(text: string): unknown[] | null {
  for (let start = text.indexOf("["); start >= 0; start = text.indexOf("[", start + 1)) {
    for (let end = text.indexOf("]", start); end >= 0; end = text.indexOf("]", end + 1)) {
      const candidate = text.slice(start, end + 1).replace(/,\s*\]$/, "]");
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.some((x) => typeof x === "string")) return parsed;
      } catch {
        // 次の候補へ
      }
    }
  }
  return null;
}

export function buildMessages(prompt: string) {
  return [
    {
      role: "system",
      content:
        "あなたはタイピング練習の問題を作るアシスタントです。指示に従って問題を作り、" +
        '説明を付けずに JSON の文字列配列だけを返してください（例: ["asdf","jkl;"]）。' +
        `各問題は ${MAX_LEN} 文字以内で、指示に合わせて半角英数字・記号・空白、またはひらがな・カタカナ・漢字・日本語の句読点を使ってください。` +
        "ローマ字の指示のときは、日本語ではなくローマ字（半角の小文字）で返してください。",
    },
    { role: "user", content: prompt },
  ];
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class AiQuestionSource {
  private cache = new Map<number, { questions: string[]; expires: number }>();
  private pending = new Map<number, Promise<string[] | null>>();
  // forget() のたびに増やす。問い合わせ中に指示文が変わったら、その古い結果はキャッシュしない
  private generation = new Map<number, number>();

  constructor(
    private readonly config: AiConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  // キャッシュがあればそれを返す。なければ AI に問い合わせる。使える問題が 1 つもなければ null。
  async questionsFor(levelId: number, prompt: string): Promise<string[] | null> {
    const hit = this.cache.get(levelId);
    if (hit && hit.expires > this.now()) return hit.questions;
    // 同じレベルへの同時アクセスは 1 回の問い合わせにまとめる
    const running = this.pending.get(levelId);
    if (running) return running;
    const gen = this.generation.get(levelId) ?? 0;
    const p = this.generate(prompt)
      .then((questions) => {
        const ok = questions && questions.length > 0 ? questions : null;
        if (ok && (this.generation.get(levelId) ?? 0) === gen)
          this.cache.set(levelId, { questions: ok, expires: this.now() + this.config.cacheSeconds * 1000 });
        return ok;
      })
      .finally(() => {
        if (this.pending.get(levelId) === p) this.pending.delete(levelId);
      });
    this.pending.set(levelId, p);
    return p;
  }

  // レベルの指示文を変えた・消したときにキャッシュを捨てる
  forget(levelId: number): void {
    this.cache.delete(levelId);
    this.pending.delete(levelId);
    this.generation.set(levelId, (this.generation.get(levelId) ?? 0) + 1);
  }

  private async generate(prompt: string): Promise<string[] | null> {
    const content = await this.chat(buildMessages(prompt), "AI 問題生成");
    if (content === null) return null;
    const questions = parseQuestions(content);
    if (questions.length === 0) console.warn("AI 問題生成に失敗しました（返答から問題を読み取れません）。固定問題で出題します");
    return questions;
  }

  // LLM にメッセージを送り、返答の本文を返す（失敗したら null）。API キーはヘッダーにだけ載せ、ログには出さない
  async chat(messages: { role: string; content: string }[], label: string): Promise<string | null> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    try {
      const res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.7,
          ...(this.config.maxTokens ? { max_tokens: this.config.maxTokens } : {}),
          ...(this.config.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!res.ok) {
        console.warn(`${label}に失敗しました（HTTP ${res.status}）`);
        return null;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        console.warn(`${label}に失敗しました（返答の形が違います）`);
        return null;
      }
      return content;
    } catch (e) {
      console.warn(`${label}に失敗しました（${e instanceof Error ? e.name : "error"}）`);
      return null;
    }
  }
}
