#!/bin/sh
# コンテナの起動時: DB がなければ作る（INIT_DB=demo ならデモ用の初期データ入り。既定は空の表だけ）。あれば何もしない
set -eu
if [ ! -f "$DB_PATH" ]; then
  if [ "${INIT_DB:-}" = "demo" ]; then
    echo "DB を作成します（デモ用の初期データ入り）: $DB_PATH"
    node --import tsx server/initDb.ts
  else
    echo "DB がありません: $DB_PATH"
    echo "試験運用用の DB を作ってから起動してください（app/README.md）。デモ用で作るなら INIT_DB=demo"
    exit 1
  fi
fi
exec node --import tsx server/index.ts
