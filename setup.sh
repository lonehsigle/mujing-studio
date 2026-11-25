#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DSH_DIR="$ROOT/deepseek-harness"
MUJING_DIR="$ROOT/mujing"
export DSH_HOME="$ROOT/.dsh-mujing"
export DSH_CLIENT_COMMIT_HASH="${DSH_CLIENT_COMMIT_HASH:-4b399c39a6d1479cd84ca591b4d7c88e24d38a96}"

echo "==> [1/4] 检查运行环境"
command -v node >/dev/null 2>&1 || { echo "错误：未找到 node，请安装 Node.js >= 24.22.3（或 Node 24+）"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "错误：未找到 pnpm，请先运行 corepack enable 或安装 pnpm 11"; exit 1; }
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "提示：未检测到 ffmpeg（视频尾帧接续与成片合成需要 ffmpeg，可稍后通过 brew install ffmpeg / apt install ffmpeg 安装）"
fi

echo "==> [2/4] 安装并构建 deepseek-harness（首次约需 1-3 分钟）"
cd "$DSH_DIR"
pnpm install
pnpm run build

echo "==> [3/4] 构建幕境主插件 mujing-canvas"
node "$MUJING_DIR/canvas/build.mjs" --harness "$DSH_DIR"

echo "==> [4/4] 初始化独立 Profile 并挂载主插件与全部 73 个技能插件"
pnpm dsh --profile mujing --from-default-profile web --dump-default-config >/dev/null
pnpm dsh plugin --profile mujing add "$MUJING_DIR/canvas" "$MUJING_DIR"/skills/*/

# 默认启用「幕境导演」Agent 预设（安全替换初始化时的空数组 []）
PATCH_FILE="$DSH_HOME/profiles/mujing/cordis.patch.yml"
if [ -f "$PATCH_FILE" ] && ! grep -q "mujing-director" "$PATCH_FILE"; then
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    let text = fs.readFileSync(file, "utf8");
    const entry = [
      "- id: agent-preset-registry",
      "  name: \"@deepseek-ai/dsh-agent-preset-registry\"",
      "  config:",
      "    default: mujing-director",
      "",
    ].join("\n");
    if (/^\[\]\s*$/m.test(text)) {
      text = text.replace(/^\[\]\s*$/m, entry);
    } else {
      text = text.trimEnd() + "\n" + entry;
    }
    fs.writeFileSync(file, text, "utf8");
  ' "$PATCH_FILE"
fi

echo ""
echo "✅ 初始化完成！"
echo "  • 无密钥全链路体验（推荐先试）： ./start-mock.sh"
echo "  • 连接真实模型运行：            ./start.sh"
