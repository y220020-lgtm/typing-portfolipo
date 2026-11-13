import { defineConfig } from "vitest/config";

// vite.config.ts は画面用（root: web）なので、テストは別の設定で app/ 直下から探す。
// e2e/ は Playwright で実行するため対象外。
export default defineConfig({
  test: {
    root: ".",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "web/src/**/*.test.ts"],
  },
});
