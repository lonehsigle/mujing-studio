# 幕境（Mujing）：基于 DeepSeek Harness 的 AI 影视与短剧创作插件集

> **主语言声明**：`zh-CN`（简体中文）。界面文案、默认运行语言（`html[lang="zh-CN"]` 与宿主默认 `zh` 语言配置）、「幕境导演」Agent 对话与文档均以简体中文为主语言。

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）原生插件体系构建的 AI 短剧 / 漫剧 / 影视创作工作台。Agent 运行时、模型接入、多轮会话、上下文压缩、技能机制与 Web 外壳由 `dsh` 提供；幕境通过标准宿主与客户端插槽（全屏主视图、右侧可停靠副驾抽屉、会话顶栏、空白会话引导坞、工具富媒体卡片）提供完整的端到端 AI 影视生产能力。

## 目录结构

```text
mujing/
  canvas/                         主插件 mujing-canvas（双模工作台 + 多模态生成 + 「幕境导演」Agent 预设）
    src/host/                     ctx.mujing 服务、项目存储、图/视/音多接口池生成、短剧流水线、剪映导出、/mujing/api 接口
    src/tools.ts                  12 个 Agent 创作工具 + <mujing_studio_context> 实时上下文注入
    src/client/                   Web 客户端插件（全屏工作台 + AI 导演副驾抽屉 + 富媒体对话卡片 + 一键样板坞）
    cordis.patch.yml              bundle 层：mujing 服务配置 + 「幕境导演」Agent 预设
    locale/ docs/ icon.svg        插件中心标题、简介、详情页、图标
  skills/<name>/                  73 个影视专业技能插件 mujing-skill-<name>，每个都是独立的 dsh 插件包
    index.js                      向 dsh 技能注册表注册单个技能
    skill/SKILL.md                技能正文与参考资源（references/、cards/ …）
    locale/ docs/ icon.svg        插件中心元数据与详情
  skills/INDEX.json               技能清单（调用名、包名、中文名、分类）
  scripts/mock-upstream.mjs       无密钥全链路联调服务（多轮导演 Agent + 真实画幅图片 + FFmpeg 视频 + TTS 语音）
  dev/mock.patch.yml              联调时将模型指向本地 Mock Director
```

## 核心能力

| 模块 | 能力说明 |
|---|---|
| **幕境常驻主应用外壳（Mujing-First）** | 1. **全局常驻工作台壳层**：启动直达全屏「幕境 AI 影视工作台」（`mujing.canvas`），通过常驻左侧导航栏（`248px ⇄ 56px` 可折叠图标导轨）统一承载 **🏠 剧目广场**、剧目工程列表、工程导入导出、引擎状态与子视图切换。<br>2. **可折叠「✨ AI 导演副驾」抽屉**：将实时对话引擎（`conversation.content`）内嵌于工作台右侧抽屉，支持直接切换历史导演会话 / 新建对话，边聊剧本边实时联动短剧分镜台、无限画布与成片时间线，内置 12 类工具富媒体画廊卡片（`tool.call.toolview`）。<br>3. **零侵入底座架构**：通过标准插件插槽无缝集成 DeepSeek Harness 运行时，无需侵入底座核心代码。 |
| **短剧分镜故事板流水线** | 小说/剧本拆集分镜 → **角色 / 场景 / 道具三视图设定卡锁定**与角色专属 TTS 音色绑定 → **单镜故事板关键帧（Keyframe）**与**角色对白 TTS 配音**单独生成与重抽 → 行内增删改镜头与分段视频提示词 → **FFmpeg 自动抽取上一段真实尾帧接下一段首帧**连续生成整集视频。 |
| **无限画布（Board）** | 支持文本（`text`）、图片（`image`）、视频（`video`）、配音（`audio`）四类节点与有向参考连线，支持本地图片/视频/音频文件直接拖拽上传入画布、缩放自适应（Fit）、撤销/重做（`⌘Z` / `⇧⌘Z`）、`.mujing.json` 项目导入导出与 SSE 实时同步。 |
| **多模态多接口池调度** | 生图 / 视频 / 配音均支持多接口池可视化配置、节点权重、动态轮询 / 主备容灾 / 随机均衡策略与自动故障切换。 |
| **多轨成片与剪映导出** | 视频主轨道编排 + 配音音轨绑定，**FFmpeg 音画混流合成整集 MP4 成片 + SRT 时间轴字幕**，并支持一键生成**剪映专业版（JianyingPro）草稿包**（含完整本地媒体与轨道时间轴 JSON）。 |
| **「幕境导演」Agent + 73 个技能** | 每轮自动注入 `<mujing_studio_context>` 工作室实时快照；配备 12 个创作工具（`canvas_list_projects`、`canvas_create_project`、`canvas_get_state`、`canvas_apply_ops`、`generate_media`、`drama_save_plan`、`drama_generate_casts`、`drama_generate_shot_media`、`drama_run_episode`、`timeline_compose`、`timeline_export_jianying`、`media_status`）及 73 个可按需加载的影视方法论技能插件。 |

## 手动构建与运行

> 推荐使用仓库根目录的一键脚本 `./setup.sh`、`./start-mock.sh` 和 `./start.sh`。如需手动分步构建，可参考以下命令：

前置：Node ≥ 24.22.3、pnpm 11（`corepack enable`）、系统已安装 `ffmpeg`；`../deepseek-harness` 已执行 `pnpm install && pnpm run build`。

```sh
# 1. 构建主插件
node canvas/build.mjs --harness ../deepseek-harness

# 2. 创建独立 profile 并安装插件（使用独立 DSH_HOME，不影响 ~/.dsh）
cd ../deepseek-harness
export DSH_HOME=$PWD/../.dsh-mujing
pnpm dsh --profile mujing --from-default-profile web --dump-default-config >/dev/null
pnpm dsh plugin --profile mujing add ../mujing/canvas ../mujing/skills/*/

# 3. 配置模型与多模态服务密钥并启动
export DEEPSEEK_API_KEY=sk-...
export MUJING_IMAGE_BASE_URL=https://api.openai.com/v1  MUJING_IMAGE_API_KEY=...
#   火山方舟 Seedream：MUJING_IMAGE_FLAVOR=ark MUJING_IMAGE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3 MUJING_IMAGE_MODEL=<模型>
export MUJING_VIDEO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3  MUJING_VIDEO_API_KEY=...
#   可选独立配音服务（默认复用 MUJING_IMAGE_BASE_URL / API_KEY 的 /audio/speech）：
#   MUJING_AUDIO_BASE_URL=... MUJING_AUDIO_API_KEY=... MUJING_AUDIO_MODEL=gpt-4o-mini-tts MUJING_AUDIO_VOICE=nova
pnpm dsh --profile mujing --port 3090
```

修改主插件源码后，执行 `node canvas/build.mjs --harness ../deepseek-harness`（若 profile 为拷贝安装则重新 `plugin add`）并重启 `dsh`。项目数据持久化在 `$DSH_HOME/mujing/`。

### 无密钥全链路联调（Mock Upstream）

无需任何真实 API Key，即可完整体验「小说拆集分镜 → 角色/场景三视图锁定 → 单镜关键帧与 TTS 配音 → 尾帧接续生视频 → 成片合成与剪映草稿导出」：

```sh
# 终端 1：启动本地多模态 Mock 服务（含真实 PNG 渲染、FFmpeg MP4 视频与 TTS 语音合成）
node scripts/mock-upstream.mjs 3199

# 终端 2：启动挂载 Mock Director 的 DeepSeek Harness
cd ../deepseek-harness
DSH_HOME=$PWD/../.dsh-mujing \
MOCK_LLM_KEY=mock \
MUJING_IMAGE_BASE_URL=http://127.0.0.1:3199/v1 MUJING_IMAGE_API_KEY=mock \
MUJING_VIDEO_BASE_URL=http://127.0.0.1:3199/v1 MUJING_VIDEO_API_KEY=mock \
MUJING_AUDIO_BASE_URL=http://127.0.0.1:3199/v1 MUJING_AUDIO_API_KEY=mock \
pnpm dsh --profile mujing --patch ../mujing/dev/mock.patch.yml --port 3090
```

在新建会话中选择「幕境导演」预设 + `Mock Director` 模型，直接点击样板卡片，即可端到端体验导演 Agent 自动出片与工作台实时联动。请求日志位于 `/tmp/mujing-mock.log`。

## 许可

技能内容沿用各技能目录内的署名与许可文件（含 `THIRD-PARTY-LICENSES.md`）；插件代码采用 MIT 许可。
