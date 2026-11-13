import { defineConfig } from "@playwright/test";

// AI モック（~/mock-ai、OpenAI 互換。既定 http://127.0.0.1:4999/v1）につないだ通し確認。
// 実行: モックを起動してから npm run test:e2e:mock
// 本物の AI には送信しない。一時 DB を使う（正本 タイピング.db は使わない）。
const DB_PATH = "/tmp/typing-e2e-mock.db";
const AI = process.env.MOCK_AI_URL ?? "http://127.0.0.1:4999/v1";

export default defineConfig({
  testDir: "e2e",
  testMatch: "mock-ai.spec.ts",
  use: { baseURL: "http://127.0.0.1:5175" },
  webServer: [
    {
      command: `DB_PATH=${DB_PATH} npx tsx server/initDb.ts && DB_PATH=${DB_PATH} PORT=3011 TEACHER_IDS=t001 AI_BASE_URL=${AI} AI_MODEL=mock-model npx tsx server/index.ts`,
      url: "http://127.0.0.1:3011/api/stages",
      reuseExistingServer: false,
    },
    {
      command: "E2E_API=http://127.0.0.1:3011 npx vite --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
    },
  ],
});
