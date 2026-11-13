#!/bin/bash
# タイピング練習システムのコンテナ（アプリ ＋ AI モック）をまとめて操作する（Podman、root 不要）
#
#   container/typing.sh build     イメージを作る（アプリ: build.sh、AI モック: container/mock-ai）
#   container/typing.sh start     AI モック → アプリの順に起動
#   container/typing.sh stop      両方を止めて削除（DB はコンテナの外の DATA_DIR に残る）
#   container/typing.sh status    状態と応答
#   container/typing.sh logs      アプリのログ（logs mock で AI モックのログ）
#
# 設定: container/typing.env（なければ typing.env.example の値）。別の設定ファイルを使うときは TYPING_ENV=パス
set -euo pipefail
cd "$(dirname "$0")"

set -a
# shellcheck disable=SC1091
. ./typing.env.example
ENV_FILE=${TYPING_ENV:-./typing.env}
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
set +a

APP_IMAGE=localhost/typing-app:latest
MOCK_IMAGE=localhost/mock-ai:latest

# この VM は自身がコンテナの中で動いており、/proc の新規マウント・ホスト名の変更・UID の追加ができない。
# そのため /proc は空の tmpfs、ネットワークとホスト名は VM と共有、コンテナ内の uid は 0（VM 上では本人の権限。root ではない）。
# 詳しくは app/README.md「AI モック」。~/.config/containers/ の設定が必要。
export USER=${USER:-y220020}
RUN_OPTS=(--network=host --uts=host --user 0 --mount type=tmpfs,dst=/proc)
podman_() { podman "$@" 2>&1 | grep -v "Additional gid=" || true; }

wait_http() { # URL が応答するまで最大 10 秒待つ
  for _ in $(seq 1 20); do curl -s -m 1 -o /dev/null "$1" && return 0; sleep 0.5; done
  return 1
}

start_mock() {
  [ "$USE_MOCK_AI" = "1" ] || return 0
  if podman container exists "$MOCK_NAME"; then echo "AI モック: すでに起動しています（$MOCK_NAME）"; return 0; fi
  podman image exists "$MOCK_IMAGE" || podman_ build -t "$MOCK_IMAGE" mock-ai
  # このスクリプトが起動した印（stop で止めてよいのは、この印のある AI モックだけ）
  podman_ run -d --name "$MOCK_NAME" --label typing.started-by=typing.sh "${RUN_OPTS[@]}" -e HOST=127.0.0.1 -e PORT="$MOCK_PORT" -e MOCK_MODE="$MOCK_MODE" "$MOCK_IMAGE" >/dev/null
  wait_http "http://127.0.0.1:$MOCK_PORT/health" || { echo "AI モックの起動を確認できません"; podman logs "$MOCK_NAME"; exit 1; }
  echo "AI モック: http://127.0.0.1:$MOCK_PORT/v1 （mode=$MOCK_MODE）"
}

start_app() {
  if podman container exists "$APP_NAME"; then echo "アプリ: すでにあります。止めてから起動してください: $0 stop"; exit 1; fi
  podman image exists "$APP_IMAGE" || { echo "アプリのイメージがありません。先に: $0 build"; exit 1; }
  mkdir -p "$DATA_DIR"
  local env=(-e HOST=127.0.0.1 -e PORT="$APP_PORT" -e AUTH_MODE="$AUTH_MODE")
  [ -n "$INIT_DB" ] && env+=(-e INIT_DB="$INIT_DB")
  for v in TEACHER_IDS PROXY_SECRET TEACHER_EMAILS BASE_PATH SIGN_OUT_URL; do
    [ -n "${!v}" ] && env+=(-e "$v")   # 値はコマンド行に出さず、環境から渡す
  done
  if [ "$USE_MOCK_AI" = "1" ]; then
    env+=(-e AI_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" -e AI_MODEL=mock-model)
  elif [ -n "${AI_API_KEY:-}" ]; then
    # 本物の LLM（typing.env に書く。AI_API_KEY の値はコマンド行に出さず、環境から渡す）
    for v in AI_BASE_URL AI_MODEL AI_API_KEY AI_TIMEOUT_MS AI_DISABLE_THINKING AI_MAX_TOKENS AI_CACHE_SECONDS; do
      [ -n "${!v:-}" ] && env+=(-e "$v")
    done
  else
    # キーが空なら LLM を使わない（キーなしで送っても断られるだけなので）。苦手克服は規則、レベルは固定の問題
    echo "AI_API_KEY が空のため、LLM を使いません（typing.env に書くと使います）"
  fi
  podman_ run -d --name "$APP_NAME" "${RUN_OPTS[@]}" -v "$DATA_DIR:/data" "${env[@]}" "$APP_IMAGE" >/dev/null
  if ! wait_http "http://127.0.0.1:$APP_PORT${BASE_PATH}/api/auth-mode"; then
    echo "アプリの起動を確認できません。ログ:"; podman logs "$APP_NAME" 2>&1 | tail -20; podman_ rm -f "$APP_NAME" >/dev/null; exit 1
  fi
  echo "アプリ: http://127.0.0.1:$APP_PORT${BASE_PATH}/ （ログイン方式: $AUTH_MODE、DB: $DATA_DIR/typing.db）"
}

case "${1:-}" in
  build)
    ./build.sh
    podman_ build -t "$MOCK_IMAGE" mock-ai
    podman image exists "$MOCK_IMAGE" && echo "作成しました: $MOCK_IMAGE"
    ;;
  start)
    start_mock
    start_app
    ;;
  stop)
    podman_ rm -f "$APP_NAME" >/dev/null
    echo "アプリを停止しました（DB は $DATA_DIR に残っています）"
    if podman container exists "$MOCK_NAME"; then
      # 別の方法（~/mock-ai/mock-ai.sh など）で起動された AI モックは止めない
      if [ "$(podman inspect "$MOCK_NAME" --format '{{index .Config.Labels "typing.started-by"}}' 2>/dev/null)" = "typing.sh" ]; then
        podman_ rm -f "$MOCK_NAME" >/dev/null
        echo "AI モックを停止しました"
      else
        echo "AI モック（$MOCK_NAME）は、このスクリプト以外で起動されたので止めません"
      fi
    fi
    ;;
  status)
    podman ps -a --filter "name=^(${APP_NAME}|${MOCK_NAME})$" --format '{{.Names}}  {{.Status}}  {{.Image}}'
    echo "アプリ: $(curl -s -m 2 "http://127.0.0.1:$APP_PORT${BASE_PATH}/api/auth-mode" || echo 応答なし)"
    [ "$USE_MOCK_AI" = "1" ] && echo "AI モック: $(curl -s -m 2 "http://127.0.0.1:$MOCK_PORT/health" || echo 応答なし)"
    ;;
  logs)
    if [ "${2:-}" = "mock" ]; then podman logs "$MOCK_NAME"; else podman logs "$APP_NAME"; fi
    ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
