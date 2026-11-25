#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DSH_DIR="$ROOT/deepseek-harness"
MUJING_DIR="$ROOT/mujing"
export DSH_HOME="$ROOT/.dsh-mujing"
PORT="${PORT:-3090}"
MOCK_PORT="${MOCK_PORT:-3199}"
EXTRA_ARGS=()
if [ "${NO_OPEN:-0}" = "1" ]; then
  EXTRA_ARGS+=(--no-open)
fi

if [ ! -d "$DSH_DIR/node_modules" ] || [ ! -d "$DSH_HOME/profiles/mujing" ]; then
  echo "==> 检测到首次运行，自动执行初始化..."
  "$ROOT/setup.sh"
fi

echo "==> 启动本地多模态 Mock 服务（端口 ${MOCK_PORT}）..."
node "$MUJING_DIR/scripts/mock-upstream.mjs" "${MOCK_PORT}" >/tmp/mujing-mock.log 2>&1 &
MOCK_PID=$!
cleanup() {
  kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 0.5
echo "==> 启动幕境 AI 影视工作台（端口 ${PORT}，Mock 全链路模式）..."
cd "$DSH_DIR"
MOCK_LLM_KEY=mock \
MUJING_IMAGE_BASE_URL="http://127.0.0.1:${MOCK_PORT}/v1" MUJING_IMAGE_API_KEY=mock \
MUJING_VIDEO_BASE_URL="http://127.0.0.1:${MOCK_PORT}/v1" MUJING_VIDEO_API_KEY=mock \
MUJING_AUDIO_BASE_URL="http://127.0.0.1:${MOCK_PORT}/v1" MUJING_AUDIO_API_KEY=mock \
pnpm dsh --profile mujing --patch "$MUJING_DIR/dev/mock.patch.yml" --port "${PORT}" "${EXTRA_ARGS[@]}"
