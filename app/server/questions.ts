// 出題する問題を用意する。
// AI の設定がない・AI が使えないときは、レベルごとの固定問題から出題する（AI 生成は aiQuestions.ts）。

export const QUESTIONS_PER_SESSION = 10;

// levels.id ごとの固定問題。levels.prompt（AI への指示）の内容に合わせて用意している。
const FIXED: Record<number, string[]> = {
  1: ["ffff", "jjjj", "fjfj", "jfjf", "ffjj", "jjff", "fjjf", "jffj", "fffj", "jjjf", "fjf", "jfj"],
  2: ["dddd", "kkkk", "dkdk", "kdkd", "ddkk", "kkdd", "dkkd", "kddk", "dkdd", "kdkk", "dkd", "kdk"],
  3: ["apple", "water", "light", "music", "happy", "green", "table", "smile", "house", "dream", "river", "cloud"],
};

// ホームポジションのキーを使った予備の問題（固定問題のないレベル用）
const FALLBACK = ["asdf", "jkl;", "fdsa", ";lkj", "asdfjkl;", "fjdk", "slal", "dkfj", "ajsk", "fjfj"];

export function fixedQuestions(levelId: number): string[] {
  return FIXED[levelId] ?? FALLBACK;
}

export function pickQuestions(levelId: number, count = QUESTIONS_PER_SESSION, random = Math.random): string[] {
  return pickFrom(fixedQuestions(levelId), count, random);
}

// 候補から count 問を選ぶ（並びはランダム。候補が足りなければ繰り返す）
export function pickFrom(pool: string[], count = QUESTIONS_PER_SESSION, random = Math.random): string[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const result: string[] = [];
  while (result.length < count) result.push(shuffled[result.length % shuffled.length]);
  return result;
}
