// AI モックサーバー（本物の AI の代わり。外部には何も送らない）
// OpenAI 互換の POST /v1/chat/completions に、タイピング問題の JSON 配列を返す。
// 依存パッケージなし（Node.js 標準のみ）。コンテナでも、そのまま `node server.mjs` でも動く。
//
// 環境変数:
//   PORT=4999        待ち受けポート
//   HOST=127.0.0.1   待ち受けアドレス（コンテナ内では 0.0.0.0）
//   MOCK_MODE=ok     ok / error（HTTP 500 を返す）/ garbage（読めない文章を返す）/ slow（20 秒待つ）
//                    アプリが「AI が失敗したら固定問題」に切り替わるかを試すため
//
// 問題の作り方（generate）:
//   本物の AI のように文章を理解するのではなく、指示文（levels.prompt）から次のことを読み取って問題を作る。
//   - 種類: 指（人差し指・中指・薬指・小指）、段（ホームポジション・上の段・下の段・全部）、英単語、
//           大文字の単語、英文、ローマ字（単語・文）、日本語（ひらがな・カタカナ・漢字・文）、数字、記号、プログラム
//   - 使うキー: 「（s と l）」「a s d f」のように書いたキーがあれば、そのキーだけで作る
//   - 長さ: 長い・上級・難しい / 短い・初心者・簡単、または「5文字」「3〜6文字」「3語」など
//   - 個数: 「10個」「20問」など（1〜50。既定 10）
//   キーの練習は毎回ランダムに作り、単語や文は種類ごとの候補から毎回違う組み合わせで選ぶ。
//   読み取れなかったときは、ホームポジションの練習を作る。

import http from "node:http";
import { generate, generateTraining, isTrainingPrompt } from "./generate.mjs";

const PORT = Number(process.env.PORT ?? 4999);
const HOST = process.env.HOST ?? "127.0.0.1";
const MODE = process.env.MOCK_MODE ?? "ok";

let count = 0;

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/v1/models")) {
    return send(res, 200, { object: "list", data: [{ id: "mock-model", object: "model" }], mode: MODE, requests: count });
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") return send(res, 404, { error: { message: "not found" } });

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    count++;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: { message: "invalid JSON" } });
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const prompt = String(messages.filter((m) => m.role === "user").at(-1)?.content ?? "");
    const training = isTrainingPrompt(prompt);
    const result = training ? generateTraining(prompt) : generate(prompt);
    // 指示文の先頭と、読み取った内容だけ記録する（キーなどのヘッダーは記録しない）
    console.log(
      `${new Date().toISOString()} #${count} mode=${MODE} model=${body.model} kind=${result.kind} length=${result.length} n=${result.questions.length} prompt="${prompt.slice(0, 40)}"`,
    );

    if (MODE === "error") return send(res, 500, { error: { message: "mock error" } });
    const content = MODE === "garbage" ? "すみません、うまく作れませんでした。" : training
          ? JSON.stringify({ analysis: result.analysis, questions: result.questions })
          : JSON.stringify(result.questions);
    const reply = () =>
      send(res, 200, {
        id: `mock-${count}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "mock-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    if (MODE === "slow") setTimeout(reply, 20000);
    else reply();
  });
});

server.listen(PORT, HOST, () => console.log(`AI モック: http://${HOST}:${PORT}/v1 （mode=${MODE}）`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
