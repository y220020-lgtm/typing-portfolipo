# タイピング練習 Web アプリ

`db/schema.sql` の設計（7 テーブル）を使う Web アプリ。次の機能が動く。

- 学生: 学籍番号でログイン → レベルを選ぶ → 10 問打つ（Enter で 1 問ずつ `logs` に保存）→ 結果表示
- 学生: これまでの記録（WPM・正確率の推移、間違えやすい文字、指ごとのミス率）
- 教員: 学生一覧（検索・並べ替え）→ 学生ごとの学習状況、記録の CSV 出力
- 教員: 学生の追加（1 人・まとめて）、名前の変更、練習の記録がない学生の削除
- 教員: ステージ・レベルの管理（表示順・タイトル・説明・AI への指示文・合格の目安の変更、追加、削除）、課題（締め切り・回数・正確率）
- 教員: 「練習（学生の画面）」で学生と同じ画面で練習（記録は教員の ID で残り、学生の集計には入らない）
- 学生: 苦手克服トレーニング、レベルごとの苦手克服（そのレベルの範囲で、記録から苦手を補う問題を AI が作る）、間違えた問題の再挑戦
- 学生: キーボードの設定（JIS・US・Keyball44・自由な配列、キーを押して登録、同時押しの指）

- 問題は、AI の設定があれば `levels.prompt` で AI が作った問題（キャッシュ）から、なければ固定問題から出題する。
- 開発用 DB `app/data/dev.db` を使う。正本の `タイピング.db` は読み書きしない。

## 動かし方

VM のターミナルで、`app` フォルダーに移動して実行する。

```bash
cd ~/y220020-takagi-yuusuke-typing/app
npm install        # 初回のみ
npm run db:init    # 開発用 DB を作る（作り直すときも同じ。記録は消える）
npm run dev        # サーバー（3000 番）と画面（5173 番）を起動
```

VS Code が 5173 番ポートを転送するので、手元のブラウザで `http://localhost:5173` を開く。
止めるときはターミナルで `Ctrl + C`。

### 1 つのサーバーで動かす（試験運用向け）

```bash
npm run build      # 画面を dist/ に作る
npm start          # API と画面を 3000 番で配る（http://localhost:3000）
```

既定では VM の中（127.0.0.1）だけで待ち受ける。同じネットワークの他の PC から使う場合は `HOST=0.0.0.0 npm start` とするが、外部に公開することになるため、ネットワークの管理者（指導教員）に確認してから行う。

### 評価用の集計

```bash
DB_PATH=data/dev.db npm run report                      # 学生ごとの最初/最後のプレイ、間違えやすい文字、指ごとのミス率
DB_PATH=data/dev.db npm run report -- --since 2026-11-01 # 期間を絞る
```

DB は読み取り専用で開くので、記録は変わらない。

## 確認

```bash
npm test             # スコア計算・API のテスト
npm run typecheck    # 型チェック
npm run test:e2e     # ブラウザでの通し確認（一時 DB /tmp/typing-e2e.db を使う）
npm run test:e2e:mock  # AI モックにつないだ通し確認（先にモックを起動する。下の「AI モック」を参照）
npm run build && npm run test:e2e:sso  # 研究室 Web サーバー経由・SSO の構成を手元に再現した通し確認
npm run test:e2e:container  # コンテナで起動したシステムの通し確認（先に container/typing.sh start。../container/README.md）
```

## 構成

| フォルダー | 内容 |
|---|---|
| `server/` | API サーバー（Express + better-sqlite3）。`app.ts` に API、`questions.ts` に固定問題 |
| `shared/` | スコア計算（WPM・正確率）と学習分析の集計。画面とサーバーで共通 |
| `web/` | 画面（React）。ログイン・レベル選択・タイピング・結果 |
| `seed/` | 開発用 DB の初期データ（`タイピング.db` の users / stages / levels / keyboards / keys を複製） |
| `e2e/` | ブラウザでの通し確認 |

## SSO（Web サーバーの oauth2-proxy 経由）で動かす

`AUTH_MODE=proxy` で起動すると、前段の Web サーバーの oauth2-proxy（大学の Google アカウントなど）が付けるヘッダーで本人を判定する。
ヘッダーは、プロキシとアプリだけが知る合言葉（`PROXY_SECRET`）のヘッダーが付いた要求のときだけ信じる（なりすまし対策）。主な設定は `AUTH_MODE=proxy`・`PROXY_SECRET`（16 文字以上）・`ALLOWED_EMAIL_DOMAIN`・`TEACHER_EMAILS`・`BASE_PATH`。
アプリ側は実装し、偽の oauth2-proxy を使った E2E（`npm run test:e2e:sso`）で確認済み。本物の SSO での確認はしていない。

## API

練習の API（権限が「学生・教員」）は、教員も「練習（学生の画面）」から使える。教員が初めて使うとき `users` に教員の ID の行を作り、教員の記録は学生一覧・課題・クラス全体の苦手から除く。

ログインで受け取ったトークンを `Authorization: Bearer <トークン>` で送る（「要ログイン」の API）。
`AUTH_MODE=proxy` では、トークンの代わりに oauth2-proxy が付けるヘッダーで本人を判定する。
トークンはサーバーのメモリにだけ置くので、サーバーを再起動するとログインし直しになる。

| メソッド | パス | 内容 | 権限 |
|---|---|---|---|
| GET | `/api/auth-mode` | ログインの方式（`local` / `proxy`） | なし |
| POST | `/api/login` | 学籍番号（教員は教員の ID）でログイン。`AUTH_MODE=proxy` では使えない（404） | なし |
| POST | `/api/logout` | ログアウト | 要ログイン |
| GET | `/api/me` | ログイン中のユーザー | 要ログイン |
| GET | `/api/stages` | ステージとレベル（`sort_order` 順） | なし |
| GET | `/api/me/keyboards` | 自分の有効なキーボード（`is_active = 1`） | 要ログイン |
| GET | `/api/me/assignments` | 自分の課題と進み具合（`done`・`required`・`achieved`・`overdue`） | 学生・教員 |
| GET / POST | `/api/teacher/assignments` | 課題の一覧（学生ごとの達成つき）/ 課題を出す（`title`・`levelId`・`dueAt`・`requiredPlays`・`minAccuracy`） | 教員 |
| PATCH / DELETE | `/api/teacher/assignments/:id` | 課題の変更 / 削除（`is_active = 0`） | 教員 |
| GET | `/api/teacher/class-weakness` | クラス全体の、文字ごと・指ごとのミス率 | 教員 |
| GET | `/api/me/keyboard-settings` | 自分のキーボードとキーの割り当て、記録があるか（`used`）、標準の割り当て | 学生・教員 |
| POST | `/api/me/keyboards` | キーボードの追加（`name`、`layout`（jis・us・keyball44・free）、`template`（keyball44・jis・us・empty）、`copyFrom` に自分のキーボードの id。なければ標準の割り当て） | 学生・教員 |
| PATCH / DELETE | `/api/me/keyboards/:id` | 名前・割り当て（`keys` を全部置き換え。記録があれば 409）の変更 / 削除（`is_active = 0`。keys と記録は残す） | 学生・教員 |
| POST | `/api/sessions` | プレイ開始。`session_id` と 10 問を返す（DB には書かない） | 学生・教員 |
| POST | `/api/training/next` | 苦手克服トレーニング。本人の最近の記録（最大 50 問）から苦手な文字・指・WPM・正確率・間違いの例を計算し、サーバーから LLM（`AI_BASE_URL`）に送って次の 10 問と分析文を作る。LLM が使えないときは苦手な文字で規則的に作る。記録がなければ通常の問題。返す `source` は `ai` / `rule` / `fixed` | 学生・教員 |
| POST | `/api/levels/:id/training` | レベルごとの苦手克服。そのレベルの範囲に合う本人の最近の記録（最大 50 問）から苦手を分析し、範囲の中で苦手を補う 10 問を返す（`analysis`・`weakness` つき。記録はそのレベルのもの） | 学生・教員 |
| POST | `/api/logs` | 1 問分の記録を保存（追加のみ。同じ問題の再送は 1 行にまとめる） | 学生・教員 |
| GET | `/api/sessions/:sessionId/result` | プレイの結果（`logs` から計算） | 本人・教員 |
| GET | `/api/me/analysis` | 自分の学習分析（プレイごとの推移・間違えやすい文字・指ごとのミス率） | 学生・教員 |
| GET | `/api/teacher/students` | 学生一覧（プレイ回数・問題数・最後の練習・全体の成績） | 教員 |
| POST | `/api/teacher/users` | 学生を追加（`{ users: [{ id, name }, ...], keyboard?: true }`。1〜500 人。1 人でも不正なら誰も追加しない。標準のキーボードの設定を付ける） | 教員 |
| PATCH / DELETE | `/api/teacher/users/:id` | 学生の名前の変更 / 削除（練習の記録がない学生だけ。キーボードの設定も消す） | 教員 |
| GET | `/api/teacher/students/:userId/analysis` | 学生 1 人の学習分析 | 教員 |
| GET | `/api/teacher/logs.csv` | `logs` の全記録 ＋ 計算したスコア（BOM 付き UTF-8） | 教員 |
| GET | `/api/teacher/stages` | 管理用のステージ・レベル一覧（`prompt` と記録件数つき。削除したものは出さない） | 教員 |
| POST / PATCH / DELETE | `/api/teacher/stages`、`/api/teacher/stages/:id` | ステージの追加・変更・削除（中のレベルも削除する。記録のあるレベルが残れば、ステージの行も残して `is_active = 0`） | 教員 |
| POST / PATCH / DELETE | `/api/teacher/levels`、`/api/teacher/levels/:id` | レベルの追加・変更・削除（記録がなければ行ごと消す。記録があれば記録を守るため行を残して `is_active = 0`。どちらも画面から消える） | 教員 |

`/api/logs` に保存する出題文・レベル・キーボード・ユーザーは、プレイ開始時にサーバーが決めた値を使う（画面から送られた値は使わない）。
`logs` はあとから直せないため、保存前に次を確かめ、満たさなければ保存しない。

- 問題番号は 1 から順番どおり（同じ番号の再送は既存の行を返す）
- 日時は実在する ISO8601・UTC・ミリ秒。開始はプレイ開始（または前の問題の終了）以降、終了はサーバーの現在時刻以前（許容誤差 5 秒）
- 画面はプレイ開始時にサーバー時刻（`serverTime`）を受け取り、端末の時計との差を補正して送る
- プレイの有効期限は 2 時間、ログインは最後に使ってから 12 時間
- 入力の長さは出題の文字数 ＋ 200 文字まで

## 教員の設定

教員は DB ではなく、サーバー起動時の環境変数で指定する（DB の構造は変えない）。

```bash
TEACHER_IDS=t001 npm run dev
```

- `TEACHER_IDS`: 教員として扱う ID（カンマ区切り）。`users` に登録されていなくてもよい

## AI による問題生成の設定

設計（`データベース仕様書.md` 🅳）どおり、AI とはサーバーだけが通信し、生成した問題はレベルごとに一定時間キャッシュする。
設定がない・AI が失敗した・使える問題が返らなかったときは、固定問題（`server/questions.ts`）で出題する。

```bash
AI_BASE_URL=http://（OpenAI 互換 API の URL）/v1 AI_MODEL=（モデル名） AI_API_KEY=（キー） npm run dev
```

| 変数 | 内容 |
|---|---|
| `AI_BASE_URL` | OpenAI 互換の `/chat/completions` がある URL（例: LiteLLM プロキシ）。未設定なら AI を使わない |
| `AI_MODEL` | モデル名。未設定なら AI を使わない |
| `AI_API_KEY` | API キー（必要な場合）。画面には渡さない |
| `AI_CACHE_SECONDS` | キャッシュの時間（秒）。省略時 3600 |
| `AI_TIMEOUT_MS` | 応答を待つ時間（ミリ秒）。省略時 15000 |

AI の返答のうち、最初の JSON 文字列配列から、40 文字以内で、半角の英数字・記号・空白、またはひらがな・カタカナ・漢字・日本語の句読点（、。「」！？ など）と全角の空白だけのものを問題として使う。全角の英数字や絵文字は使わない。
AI が使えずに固定問題へ切り替えたときは、サーバーのログに「AI 問題生成に失敗しました（理由）」と出る。
AI を使う設定では、レベルを選んでから問題が出るまで最大 `AI_TIMEOUT_MS` 待つことがある（その間、画面に「問題を準備しています…」と出る）。

### AI モック（本物の AI の代わり）で動かす

本物の AI には送信せずに AI 連携を試すため、AI モック（`~/mock-ai/`、リポジトリ外）を使う。
OpenAI 互換の `POST /v1/chat/completions` に、タイピング問題の JSON 配列を返す。
**本物の AI ではない。** 文章を理解するのではなく、指示文から次のことを読み取って問題を作る（`container/mock-ai/generate.mjs`）。

| 読み取ること | 例 |
|---|---|
| 種類（17 種類） | 指（人差し指・中指・薬指・小指）、段（ホームポジション・上の段・下の段・アルファベット全体）、英単語、大文字の単語（国名・曜日）、英文、ローマ字（単語・文）、ひらがな、カタカナ、漢字、日本語の文、数字、記号、プログラム |
| 使うキー | 「（s と l）」「a s d f j k l ;」のように書いたキーだけで作る |
| 長さ | 長い・上級・難しい / 短い・初心者・簡単、または「5文字」「3〜5語」。「40文字以内」は上限として扱う |
| 個数 | 「10個」「20問」（1〜50。既定 10） |

キーの練習は毎回ランダムに作り、単語や文は種類ごとの候補から選ぶ。読み取れなかったときはホームポジションの練習。どの問題も 40 文字以内。
問題の作り方のテストは `app/server/mockAi.test.ts`。

`container/mock-ai/` は、`~/mock-ai/`（別のセッションが作成）を元に作り直したもの（2026-10-16）。`~/mock-ai/` 自体は変更していない。

```bash
# 1. モックのコンテナを起動（Podman、root 不要）
~/mock-ai/mock-ai.sh start            # ok モード。http://127.0.0.1:4999/v1
~/mock-ai/mock-ai.sh status           # "mode":"ok" が出れば動いている

# 2. アプリをモックにつないで起動
cd ~/y220020-takagi-yuusuke-typing/app
AI_BASE_URL=http://127.0.0.1:4999/v1 AI_MODEL=mock-model npm run dev

# 3. モックにつないだブラウザでの通し確認（AI の問題で 10 問 → logs に保存）
npm run test:e2e:mock

# モックを止める
~/mock-ai/mock-ai.sh stop
```

- `mock-ai.sh` の操作: `start [ok|error|garbage|slow]` / `stop` / `status` / `logs` / `build`。別のポートで並べて起動する場合は `NAME=mock-ai-x PORT=4998 ~/mock-ai/mock-ai.sh start error`。
- この VM はそれ自体がコンテナの中にあるため、`/proc` を tmpfs にするなどの指定が必要（`mock-ai.sh` が行う）。あわせて `~/.config/containers/` の設定が必要で、この VM には設定済み（ホームディレクトリにあるので VM を再起動しても残る）。設定の理由は `~/mock-ai/README.md`。ホームディレクトリごと失った場合は、次の 2 ファイルを作り直す。

  ```
  # ~/.config/containers/containers.conf
  [containers]
  cgroups = "disabled"
  netns = "host"
  [engine]
  cgroup_manager = "cgroupfs"
  events_logger = "file"

  # ~/.config/containers/storage.conf
  [storage]
  driver = "vfs"
  [storage.options]
  ignore_chown_errors = "true"
  ```
- モードで失敗を試せる: `garbage`（読めない返答）・`error`（HTTP 500）・`slow`（20 秒後に返答）。いずれもアプリは固定問題で出題する。
- AI モックのソースは `container/mock-ai/` にもある（`~/mock-ai/` を元に、長さの言葉に反応するよう改良）。アプリと AI モックをまとめてコンテナで動かすときは `container/typing.sh`（`../container/README.md`）。
- 確認済み（2026-10-16）: ok（コンテナ）→ AI の問題で出題・2 回目以降はキャッシュ、garbage / error / AI 停止中 → 固定問題、slow → `AI_TIMEOUT_MS`（確認時は 3000）でタイムアウトして固定問題。
- 未確認: 本物の AI（研究室の LiteLLM など）との接続。外部サービスへの送信になるため、アプリ用のキーと予算の許可を得てから行う。

## スコアの計算方法

- 正確率 = 出題と同じ位置で一致した文字数 ÷（出題の文字数 ＋ 出題より多く打った文字数）
  - 例: `ffff` に `ffffjjjj` と打つと 4 ÷ 8 = 50%（打ちすぎも減点する）
  - 位置ごとに比べるため、途中で 1 文字抜けたり増えたりすると、それ以降の文字もミスになる（限界。論文に明記する）
- WPM = 正しく打てた文字数 ÷ 5 ÷ 所要時間（分）
- 所要時間 = `end_time` − `start_time`

## 学習分析の計算方法

- プレイごとの推移: `session_id` ごとに上のスコアを計算し、最初の問題の `start_time` 順に並べる
- 間違えやすい文字: 出題文の各文字について、同じ位置の入力と違った回数 ÷ 出題された回数
- 指ごとのミス率: プレイで使ったキーボード（`logs.keyboard_id`）の `keys` で文字を指（`finger`）に対応させて集計する。英字は大文字、`;` は `KC_SCLN`、`/` は `KC_SLSH`、空白は `Space` として `keys.char` と照合する。キーボード未指定や対応がない文字は「不明」
