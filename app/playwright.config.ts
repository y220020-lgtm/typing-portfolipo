import { defineConfig } from "@playwright/test";

// 画面の通し確認。一時的な DB でサーバーと画面を起動する（正本 タイピング.db は使わない）。
const DB_PATH = "/tmp/typing-e2e.db";

export default defineConfig({
  testDir: "e2e",
  testIgnore: ["mock-ai.spec.ts", "sso.spec.ts", "container.spec.ts"], // 別の構成が必要なため test:e2e:mock / test:e2e:sso / test:e2e:container で別に実行する
  use: { baseURL: "http://127.0.0.1:5174" },
  webServer: [
    {
      command: `DB_PATH=${DB_PATH} npx tsx server/initDb.ts && DB_PATH=${DB_PATH} PORT=3001 TEACHER_IDS=t001 npx tsx server/index.ts`,
      url: "http://127.0.0.1:3001/api/stages",
      reuseExistingServer: false,
    },
    {
      command: "E2E_API=http://127.0.0.1:3001 npx vite --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
    },
  ],
});
