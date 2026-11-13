// generate.mjs（AI モックの問題の作り方。依存なしの JavaScript）の型定義。テスト（app/server/mockAi.test.ts）から使う
export type Length = "short" | "middle" | "long" | { min: number; max: number; unit: "char" | "word" };
export interface Generated {
  kind: string;
  length: Length;
  count: number;
  keys: string | null;
  questions: string[];
}
export function readLength(prompt: string): Length;
export function readCount(prompt: string): number;
export function readKeys(prompt: string): string | null;
export function readKind(prompt: string): string;
export function setRandom(fn: () => number): void;
export function generate(prompt: string): Generated;
export function isTrainingPrompt(prompt: string): boolean;
export function generateTraining(prompt: string): { analysis: string; questions: string[] };
