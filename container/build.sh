#!/bin/bash
# アプリのコンテナイメージ（typing-app）を作る。
#   container/build.sh
# 1. container/.build に、実行に必要なファイルだけを集める（依存は本番用のみ＋ tsx、画面はビルド済み）
# 2. podman build（コピーだけ。この VM ではビルド中のコマンド実行ができないため）
set -euo pipefail
cd "$(dirname "$0")"
REPO=$(cd .. && pwd)
OUT=.build
IMAGE=${IMAGE:-localhost/typing-app:latest}

[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
rm -rf "$OUT"
mkdir -p "$OUT/app" "$OUT/db"

# 画面をビルドする（リポジトリの app/ で）
(cd "$REPO/app" && npm run build >/dev/null)

# 実行に必要なファイルだけをコピーする（テスト・開発用の設定は入れない）
cp -r "$REPO/app/server" "$REPO/app/shared" "$REPO/app/seed" "$REPO/app/dist" "$REPO/app/package.json" "$REPO/app/package-lock.json" "$OUT/app/"
find "$OUT/app/server" "$OUT/app/shared" -name "*.test.ts" -delete
cp "$REPO/db/schema.sql" "$OUT/db/"

# 本番用の依存（package-lock.json どおり）
(cd "$OUT/app" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
# TypeScript をそのまま動かす tsx（npm start と同じ方法）。開発用の依存を巻き込まないよう、別の場所に入れてから合わせる
TSX_VERSION=$(node -p "require('$REPO/app/node_modules/tsx/package.json').version")
mkdir -p "$OUT/tsx" && (cd "$OUT/tsx" && npm init -y >/dev/null && npm install --no-audit --no-fund "tsx@$TSX_VERSION" >/dev/null)
cp -rn "$OUT/tsx/node_modules/." "$OUT/app/node_modules/"
rm -rf "$OUT/tsx"

# この VM の Podman の制限への対処（~/mock-ai/mock-ai.sh と同じ）
export USER=${USER_FOR_PODMAN:-y220020}
podman build -f app.Containerfile -t "$IMAGE" . 2>&1 | grep -v "Additional gid=" || true
podman image exists "$IMAGE" && echo "作成しました: $IMAGE"
