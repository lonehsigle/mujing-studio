# mujing-canvas

幕境主插件：双模影视工作台（会话右侧分屏工作台 + 左侧全屏工作台 + 对话富媒体卡片）、`ctx.mujing` 宿主服务（项目持久化、图/视/音多模态生成、小说→短剧故事板流水线、FFmpeg 混流与剪映专业版导出）、12 个 Agent 工具与「幕境导演」Agent 预设。

插件中心详情见 [docs/DETAIL.zh.md](docs/DETAIL.zh.md)，整体架构、安装与无密钥联调指南见上级 [README](../README.md)。

构建：`node build.mjs --harness ../../deepseek-harness`，产出 `lib/index.js`（host 服务与 HTTP 路由）、`lib/tools.js`（Agent 工具与上下文注入）、`lib/client.js`（Web 客户端插件）。
