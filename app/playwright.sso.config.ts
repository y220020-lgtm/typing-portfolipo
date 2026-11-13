import { defineConfig } from "@playwright/test";

// 研究室 Web サーバーに置いたときの構成を手元で再現する通し確認（SSO・Web サーバー経由・AI モック）。
//   ブラウザ → テスト用 SSO プロキシ（Caddy + oauth2-proxy の代わり、/typing/）→ アプリ（AUTH_MODE=proxy, BASE_PATH=/typing）
//   アプリ → AI モック（起動していれば。~/mock-ai/mock-ai.sh start）
// 実行: npm run build && npm run test:e2e:sso
// 本物の SSO・本物の AI は使わない。一時 DB を使う（正本 タイピング.db は使わない）。
export const SSO = {
  db: "/tmp/typing-e2e-sso.db",
  secret: "e2e-proxy-secret-0123456789abcdef",
  appPort: 3012,
  proxyPort: 5180,
  ai: process.env.MOCK_AI_URL ?? "http://127.0.0.1:4999/v1",
};

export default defineConfig({
  testDir: "e2e",
  testMatch: "sso.spec.ts",
  use: { baseURL: `http://127.0.0.1:${SSO.proxyPort}` },
  webServer: [
    {
      command:
        `DB_PATH=${SSO.db} npx tsx server/initDb.ts && ` +
        `DB_PATH=${SSO.db} PORT=${SSO.appPort} BASE_PATH=/typing AUTH_MODE=proxy PROXY_SECRET=${SSO.secret} ` +
        `TEACHER_EMAILS=teacher@mail.example.ac.jp AI_BASE_URL=${SSO.ai} AI_MODEL=mock-model AI_TIMEOUT_MS=3000 npx tsx server/index.ts`,
      url: `http://127.0.0.1:${SSO.appPort}/typing/api/auth-mode`,
      reuseExistingServer: false,
    },
    {
      command: `PORT=${SSO.proxyPort} UPSTREAM=http://127.0.0.1:${SSO.appPort} PROXY_SECRET=${SSO.secret} node e2e/fakeSsoProxy.mjs`,
      url: `http://127.0.0.1:${SSO.proxyPort}/typing/api/auth-mode`,
      reuseExistingServer: false,
    },
  ],
});
