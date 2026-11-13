// テスト用の「研究室 Web サーバー（Caddy + oauth2-proxy）」の代わり。本番では使わない。
// - /typing/ の下だけをアプリへ転送する（パスは付けたまま。アプリは BASE_PATH=/typing で起動）
// - SSO でログインした人として、X-Forwarded-Email と、プロキシとアプリだけが知る X-Proxy-Secret を付ける
// - ブラウザが送ってきた同名のヘッダーは消してから付け直す（oauth2-proxy と同じく、利用者には偽れない）
// - /oauth2/sign_out（oauth2-proxy の既定の受け口。/typing/ の外）は「ログアウトしました」を返す
//
// 環境変数: PORT（既定 5180）、UPSTREAM（アプリ。既定 http://127.0.0.1:3012）、SSO_EMAIL、PROXY_SECRET
import http from "node:http";

const PORT = Number(process.env.PORT ?? 5180);
const UPSTREAM = new URL(process.env.UPSTREAM ?? "http://127.0.0.1:3012");
const EMAIL = process.env.SSO_EMAIL ?? "y220020@mail.example.ac.jp";
const SECRET = process.env.PROXY_SECRET ?? "";

http
  .createServer((req, res) => {
    if (req.url === "/oauth2/sign_out") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("ログアウトしました（テスト用プロキシ）");
    }
    if (!req.url.startsWith("/typing")) {
      res.writeHead(404);
      return res.end("not found");
    }
    const headers = { ...req.headers };
    for (const h of Object.keys(headers))
      if (["x-forwarded-email", "x-proxy-secret", "x-forwarded-user"].includes(h.toLowerCase())) delete headers[h];
    headers["x-forwarded-email"] = EMAIL;
    headers["x-proxy-secret"] = SECRET;
    headers.host = UPSTREAM.host;
    const up = http.request({ hostname: UPSTREAM.hostname, port: UPSTREAM.port, path: req.url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502);
      res.end("upstream error");
    });
    req.pipe(up);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`テスト用 SSO プロキシ: http://127.0.0.1:${PORT}/typing/ → ${UPSTREAM.href}（${EMAIL}）`));
