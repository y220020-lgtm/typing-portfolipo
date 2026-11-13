// 苦手克服トレーニング: 学生の記録（logs）から弱点を要約し、LLM に次の問題を作らせる。
// LLM に渡すのは、logs から計算できる項目だけ（出題・入力・時間から求めた、文字ごと・指ごとのミス率、WPM、正確率、間違いの例）。
// 1 打ごとの時刻や Backspace の操作は記録していないので、渡さない。
import { isTypable } from "./aiQuestions";
import type { CharStat, FingerStat } from "../shared/analysis";
import { scoreQuestion, type LogRecord } from "../shared/score";

export const TRAINING_QUESTIONS = 10;
const RECENT_LOGS = 50; // 分析に使う最近の問題の数

export interface WeaknessSummary {
  questions: number; // 分析に使った問題の数
  wpm: number;
  accuracy: number;
  weakChars: { char: string; missRate: number; misses: number; attempts: number }[];
  weakFingers: { finger: string; missRate: number }[];
  mistakes: { target: string; typed: string }[]; // 最近の間違いの例
  japanese: boolean; // 最近の問題が日本語中心か
  stage: Stage; // 難しさの段階（正確率とトレーニングの回数から決める）
}

// 難しさの段階。正確さを優先し、正確率が上がり、回数を重ねてから長くする
export type Stage = 1 | 2 | 3;
export const STAGES: Record<Stage, { name: string; min: number; max: number; kind: string }> = {
  1: { name: "基礎", min: 4, max: 10, kind: "苦手な文字を含む短い単語（4〜8 文字）が中心。2 語の短い語句も少し" },
  2: { name: "標準", min: 6, max: 18, kind: "苦手な文字を含む単語と、2〜3 語の語句" },
  3: { name: "発展", min: 10, max: 30, kind: "苦手な文字を多く含む短い文（3〜6 語）。単語や語句も少し混ぜる" },
};
// 段階の決め方: 正確率 90% 未満、またはトレーニングが初めて → 1。95% 以上で 3 回以上解いた → 3。それ以外 → 2
export function stageOf(accuracy: number, trainingRounds: number): Stage {
  if (accuracy < 0.9 || trainingRounds === 0) return 1;
  if (accuracy >= 0.95 && trainingRounds >= 3) return 3;
  return 2;
}

// 最近の記録から弱点を要約する（ミス率は 2 回以上出題された文字だけを対象にする。1 回だけの偶然のミスを苦手としないため）
export function summarizeWeakness(
  recentLogs: LogRecord[],
  chars: CharStat[],
  fingers: FingerStat[],
  trainingRounds = 0, // これまでに解いた苦手克服トレーニングの回数
): WeaknessSummary {
  const logs = recentLogs.slice(-RECENT_LOGS);
  let correct = 0;
  let total = 0;
  let seconds = 0;
  let nonAscii = 0;
  const mistakes: WeaknessSummary["mistakes"] = [];
  for (const l of logs) {
    const q = scoreQuestion(l);
    correct += q.correctChars;
    total += q.totalChars + q.extraChars;
    seconds += q.seconds;
    nonAscii += Array.from(l.target).filter((c) => !/^[\x20-\x7e]$/.test(c)).length;
    if (q.mistakes.length > 0 || q.extraChars > 0) mistakes.push({ target: l.target, typed: l.typed });
  }
  const targetChars = logs.reduce((n, l) => n + Array.from(l.target).length, 0);
  const accuracy = total > 0 ? correct / total : 1;
  return {
    questions: logs.length,
    wpm: seconds > 0 ? correct / 5 / (seconds / 60) : 0,
    accuracy,
    weakChars: chars
      .filter((c) => c.misses > 0 && c.attempts >= 2 && c.char !== " ")
      .slice(0, 8)
      .map((c) => ({ char: c.char, missRate: round(c.missRate), misses: c.misses, attempts: c.attempts })),
    weakFingers: fingers
      .filter((f) => f.misses > 0)
      .slice(0, 4)
      .map((f) => ({ finger: f.finger, missRate: round(f.missRate) })),
    mistakes: mistakes.slice(-5),
    japanese: targetChars > 0 && nonAscii * 2 >= targetChars,
    stage: stageOf(accuracy, trainingRounds),
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

// 指の記号（keys.finger の L2・R5 など）を、LLM が分析文にそのまま書いても学生に分かる名前にする
const FINGER_NAMES: Record<string, string> = { "1": "親指", "2": "人差し指", "3": "中指", "4": "薬指", "5": "小指" };
export function fingerName(f: string): string {
  const m = /^([LR])([1-5])$/.exec(f);
  return m ? `${m[1] === "L" ? "左" : "右"}${FINGER_NAMES[m[2]]}` : f;
}

// LLM への指示（system と user）。分析文と問題を、決まった JSON の形で返してもらう
export function buildTrainingMessages(w: WeaknessSummary) {
  return [
    {
      role: "system",
      content:
        "あなたはタイピング練習のコーチです。学生の練習記録の要約を読み、弱点を分析して、弱点を補う練習問題を作ります。" +
        '説明を付けずに、次の形の JSON だけを返してください: {"analysis":"弱点の分析（日本語で 100 文字以内）","questions":["問題1", ...]}。' +
        `questions は ${TRAINING_QUESTIONS} 個で、すべて異なる問題にしてください。半角英数字・記号・空白、またはひらがな・カタカナ・漢字・日本語の句読点だけを使ってください。` +
        "どの問題にも苦手な文字を 1 つ以上入れ、苦手な指で打つ文字も多く含めてください。意味のない文字の並びではなく、実際にある単語・語句・短い文にしてください。" +
        "要約の「難しさ」に書かれた文字数の範囲と内容に従い、前半は範囲の短めから、後半は長めになるよう、長さに変化をつけてください。" +
        "分析では、指を要約に書かれた名前（例: 右人差し指）で書き、L2・R5 のような記号は使わないでください。" +
        "要約の「ローマ字で出題」が true のときは、日本語の単語・文をローマ字（半角の小文字と空白。例: sakura no hana）で書いてください。かなや漢字は使わないでください。",
    },
    {
      role: "user",
      content:
        "苦手克服トレーニング用の問題を作ってください。学生の記録の要約（JSON）:\n" +
        JSON.stringify({
          直近の問題数: w.questions,
          WPM: Math.round(w.wpm * 10) / 10,
          正確率: round(w.accuracy),
          苦手な文字: w.weakChars,
          苦手な指: w.weakFingers.map((f) => ({ ...f, finger: fingerName(f.finger) })),
          最近の間違いの例: w.mistakes,
          日本語中心: w.japanese,
          // 日本語は変換した後の文字でしか採点できず、キーごとの分析ができないので、ローマ字で出してキーを練習する
          ローマ字で出題: w.japanese,
          難しさ: {
            段階: `${w.stage}（${STAGES[w.stage].name}）`,
            文字数: `${STAGES[w.stage].min}〜${STAGES[w.stage].max} 文字`,
            内容: STAGES[w.stage].kind,
          },
        }),
    },
  ];
}

// LLM の返答から { analysis, questions } を読む。最初の JSON オブジェクトだけを使い、読めなければ null
export function parseTrainingReply(text: string): { analysis: string; questions: string[] } | null {
  const body = text.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");
  for (let start = body.indexOf("{"); start >= 0; start = body.indexOf("{", start + 1)) {
    for (let end = body.lastIndexOf("}"); end > start; end = body.lastIndexOf("}", end - 1)) {
      try {
        const o = JSON.parse(body.slice(start, end + 1));
        if (o && Array.isArray(o.questions)) {
          const questions = [...new Set((o.questions as unknown[]).filter((q): q is string => typeof q === "string").map((q) => q.trim()))].filter(
            isTypable,
          );
          const analysis = typeof o.analysis === "string" ? Array.from(o.analysis.trim()).slice(0, 200).join("") : "";
          return questions.length > 0 ? { analysis, questions } : null;
        }
      } catch {
        // 次の候補へ
      }
    }
  }
  return null;
}

// 規則で作る問題（LLM が使えないとき・LLM の問題が足りないとき）。候補の単語から、苦手な文字を含むものを選ぶ
const WORDS = (
  "apple water light music happy green table smile house dream river cloud quick brown jumps over lazy fox " +
  "just join jump juice judge major enjoy object project subject keep kind know kick key make milk " +
  "fish fast first after often left soft gift field flag draft desk hand kids food good door " +
  "sky ask risk task disk silk salad small sale slow lake leaf lucky local glass fill " +
  "question queen quiz quite equal unique zero zone size lazy puzzle maze prize " +
  "box fix mix next text exit extra yes yellow young yard every early vote very move have give " +
  "power people paper open top pop stop plan play help keyboard typing practice skill focus finger " +
  "school study teacher student morning evening window number letter little winter summer"
).split(" ");
const ROMAJI_WORDS = (
  "asa ame inu umi eki kaze kutsu kodomo sakura sora tamago tsukue tegami tokei natsu neko hana hikari fune hoshi " +
  "mado mizu mori yama yuki ringo gakkou densha benkyou jikan genki gohan zasshi zenbu daigaku doubutsu basho " +
  "kyou shukudai choudo nyuugaku hyaku myouji ryokou konnichiwa arigatou sayounara ohayou oyasumi tanoshii " +
  "kirei yasashii atarashii furui ookii chiisai hayai osoi takai yasui"
).split(" ");

// 問題の長さ（文字数）を段階の範囲に収める。空白も 1 文字に数える
const lengthOk = (q: string, stage: Stage) => {
  const n = Array.from(q).length;
  return n >= STAGES[stage].min && n <= STAGES[stage].max;
};

// 規則で作る問題を、すでにある問題（have）と重ならないように need 個作る。
// 苦手な文字を含む単語を 1〜4 個つなぎ、段階の文字数に合わせる。苦手な文字がなければ全部の単語から選ぶ。
// それでも足りなければ、苦手な文字の並び（長さを変えて）で埋めるので、必ず need 個そろう
function ruleQuestions(w: WeaknessSummary | null, need: number, have: Set<string>, random: () => number): string[] {
  const stage = w?.stage ?? 1;
  const weak = w?.weakChars.map((c) => c.char) ?? [];
  // 日本語中心の学生にはローマ字の単語（キーごとに打つので、キーと指の分析ができる）
  const pool = w?.japanese ? ROMAJI_WORDS : WORDS;
  const sep = " ";
  const lower = (c: string) => c.toLowerCase();
  const withWeak = weak.length > 0 ? pool.filter((x) => weak.some((c) => x.includes(lower(c)) || x.includes(c))) : pool;
  const words = withWeak.length > 0 ? withWeak : pool;
  const pick = <T>(a: T[]) => a[Math.floor(random() * a.length)];
  const out: string[] = [];
  const add = (q: string) => {
    if (out.length < need && isTypable(q) && !have.has(q) && !out.includes(q)) out.push(q);
  };
  for (let tries = 0; out.length < need && tries < 1000; tries++) {
    // 前半は短め（1〜2 語）、後半は長め（2〜4 語）
    const late = out.length >= need / 2;
    const n = (stage === 1 ? 1 : 2) + (late ? 1 : 0) + Math.floor(random() * (stage === 3 ? 3 : 2));
    const parts = Array.from({ length: n }, (_, i) => (i === 0 ? pick(words) : pick(random() < 0.5 ? words : pool)));
    let q = parts[0];
    for (const p of parts.slice(1)) {
      if (Array.from(q + sep + p).length > STAGES[stage].max) break;
      q += sep + p;
    }
    if (lengthOk(q, stage)) add(q);
  }
  // 単語で足りないとき（苦手な文字を含む単語がない記号など）: 苦手な文字（なければホームポジション）の並びで埋める
  const keys = weak.length > 0 ? weak : Array.from("fjdksla");
  for (let n = STAGES[stage].min; out.length < need && n <= 40; n++) add(Array.from({ length: n }, (_, i) => keys[i % keys.length]).join(""));
  for (let n = 2; out.length < need && n < STAGES[stage].min; n++) add(Array.from({ length: n }, (_, i) => keys[i % keys.length]).join(""));
  // 短いものから長いものへ（はじめは短めで慣れ、だんだん長く）
  return out.sort((a, b) => Array.from(a).length - Array.from(b).length);
}

// 出題をちょうど 10 問の、すべて異なる問題にする（重なりは除き、足りない分は規則で作った問題で補う）。
// LLM が返した問題の順番はそのまま使う
// 段階より 2 文字以上短い問題（1〜3 文字の並びなど）は除き、規則の問題に入れ替える
export function completeTraining(questions: string[], w: WeaknessSummary | null, random = Math.random): string[] {
  const min = w ? STAGES[w.stage].min - 2 : 1;
  const out = [...new Set(questions)].filter((q) => Array.from(q).length >= min).slice(0, TRAINING_QUESTIONS);
  return [...out, ...ruleQuestions(w, TRAINING_QUESTIONS - out.length, new Set(out), random)];
}

// LLM が使えないときの問題: 苦手な文字を規則で並べる（苦手な文字がなければ null を返し、呼び出し側が通常の問題にする）
export function fallbackTraining(w: WeaknessSummary, random = Math.random): { analysis: string; questions: string[] } | null {
  const weak = w.weakChars.map((c) => c.char);
  if (weak.length === 0) return null;
  return {
    analysis: `苦手な文字（${weak.slice(0, 5).join("・")}）を多く含む問題です（AI が使えないため、規則で作りました）。`,
    questions: ruleQuestions(w, TRAINING_QUESTIONS, new Set(), random),
  };
}

// ---- レベルごとの苦手克服 ----
// レベルを解き終えたあと、そのレベルの記録から弱点を分析し、そのレベルの範囲（levelRules の決まり）の中で苦手を補う問題を作る。
// 例: 上の段なら q〜p のキーだけで、苦手な文字を多く含む問題。

export interface LevelScope {
  title: string;
  prompt: string; // levels.prompt（そのレベルで出す問題の指示）
  hint: string | null; // 決まり（levelRules）の文。決まりのないレベルは null
}

// LLM への指示。苦手克服トレーニングと同じ形の JSON で返してもらうが、問題はレベルの範囲に限る
export function buildLevelTrainingMessages(w: WeaknessSummary, scope: LevelScope) {
  const [system, user] = buildTrainingMessages(w);
  return [
    {
      role: "system",
      content:
        system.content +
        `ただし、今回は「${scope.title}」のレベルの練習です。問題は必ず次のレベルの指示の範囲で作り、範囲の外の文字は使わないでください（苦手な文字が範囲の外なら、その文字は使わない）。` +
        `レベルの指示: ${scope.prompt}` +
        (scope.hint ? ` 守ること: ${scope.hint}` : "") +
        " 文字数や「実際にある単語」の指示より、レベルの範囲を優先してください（キーの練習のレベルなら、キーの並びでよい）。",
    },
    user,
  ];
}
