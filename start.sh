#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DSH_DIR="$ROOT/deepseek-harness"
export DSH_HOME="$ROOT/.dsh-mujing"
PORT="${PORT:-3090}"
EXTRA_ARGS=()
if [ "${NO_OPEN:-0}" = "1" ]; then
  EXTRA_ARGS+=(--no-open)
fi

if [ ! -d "$DSH_DIR/node_modules" ] || [ ! -d "$DSH_HOME/profiles/mujing" ]; then
  echo "==> 检测到首次运行，自动执行初始化..."
  "$ROOT/setup.sh"
fi

echo "==> 启动幕境 AI 影视工作台（端口 ${PORT}）..."
echo "提示：生图 / 视频 / 配音多接口池与动态轮询可直接在界面左下角点击配置。"
cd "$DSH_DIR"
pnpm dsh --profile mujing --port "${PORT}" "${EXTRA_ARGS[@]}"
