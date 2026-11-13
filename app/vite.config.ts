import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  // 画面のファイルを相対パスで読み込む（研究室 Web サーバーの /typing/ などのパスの下でも動くように）
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": process.env.E2E_API ?? "http://127.0.0.1:3000" }, // 開発時は 5173 の /api を API サーバーへ
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
