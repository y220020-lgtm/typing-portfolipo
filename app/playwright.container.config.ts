import { defineConfig } from "@playwright/test";

// コンテナで起動したシステム（container/typing.sh start）に対する通し確認。サーバーは起動しない。
// 実行: container/typing.sh start のあと npm run test:e2e:container
//   CONTAINER_URL   アプリの URL（既定 http://127.0.0.1:3000/）
//   CONTAINER_DB    アプリの DB（コンテナの外。既定 ~/typing-data/typing.db）
export default defineConfig({
  testDir: "e2e",
  testMatch: "container.spec.ts",
  use: { baseURL: process.env.CONTAINER_URL ?? "http://127.0.0.1:3000/" },
});
