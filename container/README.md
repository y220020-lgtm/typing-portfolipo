# コンテナで動かす（アプリ ＋ AI モック）

タイピング練習システムを、2 つのコンテナ（アプリと、AI の代わりに問題を返す AI モック）で動かす。この形のまま学内のサーバーに配置することを想定した構成。

| コンテナ | イメージ | 中身 | 待ち受け |
|---|---|---|---|
| アプリ | `localhost/typing-app` | Web アプリ（画面と API）。`app/` をそのまま動かす | `127.0.0.1:3000` |
| AI モック | `localhost/mock-ai` | 本物の AI の代わり（OpenAI 互換 `/v1/chat/completions`）。指示文の決まった言葉に反応して用意した問題を返す（指示文は理解しない）。外部には何も送らない | `127.0.0.1:4999` |

- DB はコンテナの外のフォルダー（既定 `~/typing-data/typing.db`）に置く。コンテナを止めても作り直しても、記録は残る。
- 正本の `db/タイピング.db` はイメージに入れない。
- 本物の AI は使わない（キーと予算の許可が必要なため）。

## 使い方

```bash
cd ~/y220020-takagi-yuusuke-typing
container/typing.sh build     # イメージを作る（初回と、コードを変えたとき）
container/typing.sh start     # AI モック → アプリの順に起動
container/typing.sh status    # 状態と応答
container/typing.sh logs      # アプリのログ（logs mock で AI モックのログ）
container/typing.sh stop      # 止めて削除（DB は残る。AI モックは、このスクリプトで起動したときだけ止める）
```

起動したら、手元のブラウザで `http://localhost:3000/` を開く（VS Code のポート転送）。既定の設定ではデモ用の初期データ（利用者 `y220020`・`sample`）で DB を作るので、学籍番号 `y220020` で練習できる。

## 設定（`container/typing.env`）

```bash
cp container/typing.env.example container/typing.env   # 見本をコピーして書き換える
```

`typing.env` は Git の管理外（合言葉などの秘密を書くため）。項目と既定値は `typing.env.example` を参照。主なもの:

| 項目 | 内容 | 既定 |
|---|---|---|
| `APP_PORT` | アプリのポート（127.0.0.1 だけで待ち受け） | `3000` |
| `DATA_DIR` | DB を置くフォルダー | `~/typing-data` |
| `INIT_DB` | DB がないとき `demo` ならデモ用データで作る。空なら作らずに止まる | `demo` |
| `AUTH_MODE` | `local`（学籍番号）/ `proxy`（研究室 Web サーバーの SSO） | `local` |
| `PROXY_SECRET`・`TEACHER_EMAILS`・`BASE_PATH`・`SIGN_OUT_URL` | SSO（proxy）のときの設定。意味は `app/README.md` の「SSO で動かす」 | 空 |
| `USE_MOCK_AI` | `1` ならアプリを AI モックにつなぐ。`0` なら下の `AI_*` で本物の LLM につなぐ（キーが空なら AI を使わず規則・固定の問題） | `1` |
| `AI_BASE_URL`・`AI_MODEL` | 研究室の Qwen の接続先とモデル名（見本に記入済み） | 見本の値 |
| `AI_API_KEY` | 研究室のトークン。**`typing.env` にだけ書く**（見本は空） | 空 |
| `AI_DISABLE_THINKING`・`AI_MAX_TOKENS`・`AI_TIMEOUT_MS` | Qwen 用の設定（考える部分を止める・返答の長さ・待ち時間） | `1`・`1500`・`60000` |
| `MOCK_MODE` | AI モックの動き: `ok` / `error` / `garbage` / `slow` | `ok` |

別の設定ファイルを使うときは `TYPING_ENV=パス container/typing.sh start`。

### 研究室の Qwen につなぐ（API キーの設定）

```bash
cp container/typing.env.example container/typing.env   # まだなければ
chmod 600 container/typing.env
# typing.env を開き、AI_API_KEY= の後ろにトークンを書き、USE_MOCK_AI=0 にする
container/typing.sh stop && container/typing.sh start
```

確認: 学生でログインして「トレーニングを始める」を押し、15 秒ほどで問題が出れば接続できています（アプリのログ `container/typing.sh logs` にキーは出ません）。

## 本番のサーバーで使うとき

1. 本番用の DB を `DATA_DIR` に先に作る（`DB_PATH=… npm run db:init` などで作り、ファイル名は `typing.db`）。`INIT_DB` は空にする（デモ用データで作らないため）
2. SSO で使う場合は `AUTH_MODE=proxy` と `PROXY_SECRET` などを設定する（`app/README.md` の「SSO で動かす」）
3. `container/typing.sh build && container/typing.sh start`

## この VM での制限と対処

開発に使った VM は、それ自体がコンテナの中で動いているため、Podman に次の制限がある（2026-10-16 に確認）。

| 制限 | 対処 |
|---|---|
| コンテナの起動で `/proc` をマウントできない | `/proc` を空の tmpfs にする（`typing.sh` が指定） |
| UID が 1 つしか使えない | コンテナ内の uid は 0（VM 上では本人の権限。root ではない）。`~/.config/containers/storage.conf` で chown のエラーを無視 |
| cgroup を作れない | `~/.config/containers/containers.conf` で無効 |
| ネットワークの名前空間を作れない | VM とネットワークを共有（`--network=host`）。そのためアプリと AI モックは 127.0.0.1 だけで待ち受ける |
| **ビルド中にコマンドを実行できない（`RUN`）** | 依存のインストールと画面のビルドはコンテナの外（`build.sh`）で行い、イメージにはコピーだけする。better-sqlite3 は alpine 用のビルド済みファイルを同梱しているのでコンパイル不要 |

`~/.config/containers/` の 2 ファイルの内容は `app/README.md`「AI モック」。

**大学のサーバーで動かすとき**: 上の制限がない普通の環境なら、`typing.sh` の `RUN_OPTS`（`/proc` の tmpfs・`--user 0` など）は不要になる可能性がある。ただし、その環境では確認していない（未確認）。

## 確認

```bash
container/typing.sh start
cd app && npm run test:e2e:container   # コンテナのアプリで、AI モックの問題で 10 問 → 記録がコンテナの外の DB に入る
```

確認済み（2026-10-16、この VM）:

- `typing.sh start` で 2 つのコンテナが起動し、`status` で両方が応答する。2 回目の `start` は止まる
- コンテナのアプリで AI モックの問題で出題・記録・結果（curl と `npm run test:e2e:container` 1 件合格）。記録はコンテナの外の DB に入る
- コンテナを消して作り直しても、記録が残る
- DB がなく `INIT_DB` も空なら、起動せずに案内を出す（空の DB を作らない）
- `AUTH_MODE=proxy`・`BASE_PATH=/typing` でも動く（学生 200・合言葉なし 401・教員 200）。合言葉はコンテナの作成コマンドに残らない（`podman inspect` で確認）
- 既定の設定（`typing.env` なし）で、DB が `~/typing-data/typing.db` にでき、`npm run test:e2e:container` 1 件合格
- 同じ名前の AI モックが別の方法（`~/mock-ai/mock-ai.sh`）ですでに起動していれば、それを使い、`stop` でも止めない

## ファイル

| ファイル | 内容 |
|---|---|
| `typing.sh` | 2 つのコンテナをまとめて操作する |
| `typing.env.example` | 設定の見本 |
| `build.sh` | アプリのイメージを作る（`.build/` に必要なファイルを集めてからコピー） |
| `app.Containerfile` | アプリのイメージの定義 |
| `entrypoint.sh` | アプリのコンテナの起動時の処理（DB の確認） |
| `mock-ai/` | AI モック。`~/mock-ai/` を元に、指示文の長さの言葉（長い・短い・上級・初心者など）に反応するよう改良したもの。本物の AI ではなく、指示文の中身は理解しない（`app/README.md`「AI モック」） |
