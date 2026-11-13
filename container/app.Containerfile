# タイピング練習 Web アプリのコンテナ（Podman / Docker 共通）
#
# この研究室 VM はそれ自体がコンテナの中で動いており、ビルド中にコマンドを実行する（RUN）ことができない。
# そのため依存のインストールと画面のビルドはコンテナの外（container/build.sh）で行い、ここではコピーだけを行う。
# better-sqlite3 は alpine（musl）用のビルド済みファイルを同梱しているので、コンパイルは不要。
#
# 作り方: container/build.sh（一時フォルダー container/.build に必要なファイルを揃えてからイメージを作る）
# DB はコンテナの外のフォルダーを /data につないで置く（コンテナを作り直しても記録は消えない）
FROM docker.io/library/node:22-alpine
WORKDIR /srv/typing/app
COPY .build/app/ ./
# server/db.ts は ../db/schema.sql を読む（DB の初期化用）
COPY .build/db/schema.sql /srv/typing/db/schema.sql
COPY entrypoint.sh /usr/local/bin/typing-entrypoint
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/data/typing.db
EXPOSE 3000
ENTRYPOINT ["/bin/sh", "/usr/local/bin/typing-entrypoint"]
