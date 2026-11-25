# 幕境（Mujing Studio）

> 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的开源 AI 影视与短剧全链路创作工作台。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524.22.3-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-11-orange.svg)](https://pnpm.io/)

**幕境（Mujing Studio）** 是一套开箱即用的 AI 影视、短剧与漫剧全流程创作平台。项目整合了完整的 DeepSeek Harness 运行底座、幕境双模可视化工作台插件（`mujing-canvas`）、**「幕境导演」Agent**、**12 个专业创作工具**以及 **73 个影视方法论技能插件**，覆盖从小说/剧本拆解、角色与场景资产锁定、分镜故事板生成、台词配音、尾帧接续生视频、多轨成片合成到剪映专业版草稿导出的全链路生产流程。

---

## 核心特性

### 1. 幕境一体化工作台与「AI 导演副驾」
- **常驻主应用壳层**：启动即进入全屏「幕境 AI 影视工作台」，左侧可折叠导航栏统一承载剧目广场、剧目工程管理、工程导入导出、引擎状态、历史导演会话、技能插件管理与系统设置。
- **可折叠「AI 导演副驾」抽屉**：内嵌实时多轮对话引擎，支持在创作过程中随时唤醒导演 Agent 协作讨论剧本、下达分镜与出图指令，并在对话流中直接呈现富媒体画廊预览卡片，实现画布、分镜台与时间线的实时双向联动。
- **空白会话样板坞**：内置多组影视与短剧开拍样板，一键即可体验完整创作流。

### 2. 短剧分镜故事板流水线
- **小说 / 剧本拆集分镜**：自动将故事梗概或小说原文拆解为分集结构、开篇钩子、结尾卡点与精细镜头表。
- **角色 / 场景 / 道具三视图锁定**：生成并锁定统一美术风格的设定卡，并为各角色绑定专属 TTS 配音音色，保障跨镜头、跨集数的人物与场景一致性。
- **单镜精修闭环**：支持单镜关键帧（Keyframe）与角色台词配音独立生成、局部重抽与行内编辑分镜提示词。
- **尾帧接续生视频**：支持多镜头分段聚合，自动通过 FFmpeg 抽取上一段真实尾帧作为下一段首帧参考，连续生成连贯视频片段。

### 3. 无限画布（Board）
- 支持 **文本（`text`）**、**图片（`image`）**、**视频（`video`）**、**配音（`audio`）** 四类创作节点与有向参考连线。
- 支持本地图片/视频/音频文件直接拖拽入画布、缩放自适应（Fit）、撤销/重做（`⌘Z` / `⇧⌘Z`）、`.mujing.json` 工程文件导入导出以及 SSE 实时状态同步。

### 4. 多轨成片合成与剪映草稿导出
- 视频主轨道编排与角色配音音轨绑定，支持自动生成标准 **SRT 时间轴字幕**。
- 通过 **FFmpeg** 一键音画混流输出整集 **MP4 成片**。
- 支持一键导出**剪映专业版（JianyingPro）草稿包**（含完整本地媒体素材与轨道时间轴 JSON），无缝衔接专业后期精剪。

### 5. 多模态多接口池与动态调度
- 生图、视频、配音服务均支持**多接口池可视化配置**（点击界面左下角 `● 生图` / `● 视频` / `● 配音` 即可管理），兼容 OpenAI 规范接口与火山方舟（Seedream / Seedance）接口。
- 支持节点权重配置、三种调度策略（**动态轮询** / **主备容灾** / **随机均衡**）以及异常冷却与自动故障切换。

### 6. 「幕境导演」Agent + 12 个工具 + 73 个专业技能
- 每轮对话自动注入 `<mujing_studio_context>` 工作台实时快照，让导演 Agent 准确掌握当前画布、角色设定、分镜与时间线进度。
- 内置 12 个结构化创作工具：
  - 画布操作：`canvas_list_projects`、`canvas_create_project`、`canvas_get_state`、`canvas_apply_ops`
  - 多模态生成：`generate_media`、`media_status`
  - 短剧流水线：`drama_save_plan`、`drama_generate_casts`、`drama_generate_shot_media`、`drama_run_episode`
  - 后期成片：`timeline_compose`、`timeline_export_jianying`
- 预置 **73 个独立技能插件**（见 [`mujing/skills/INDEX.json`](./mujing/skills/INDEX.json)），涵盖 5 大创作领域：
  - **影视与短剧（26 个）**：短剧实战手册、三幕式短剧工厂、一镜到底短剧流水线、分镜语法、视听理论基础、剧本撰写、对白工坊、AI 演员微表情导演、剪辑节奏、世界观美术设定等
  - **创意与提示词（24 个）**：视觉提示词工程、Seedance 导演工艺与提示词工程、15 秒视觉特效、名导风格资产引擎、人像捏脸导演、图片图层拆分与标注编辑等
  - **电商视觉（12 个）**：AI 造型师高转化模特图、珠宝电商图文视频一站式、穿搭试穿视频、TikTok 带货视频、全链路广告打法等
  - **社媒传播（8 个）**：ASMR 沉浸式潮玩开箱、小红书穿搭配方、数字人搞笑采访、社媒素人 App 宣传等
  - **综合方法（3 个）**：模型路由交互、体验设计五原则、OC 魅力诊断师等

---

## 目录结构

```text
mujing-studio/
├── deepseek-harness/        # DeepSeek Harness 完整宿主与 Web 运行时源码
├── mujing/                  # 幕境核心插件体系
│   ├── canvas/              # 主插件 mujing-canvas（宿主服务 + 12 个 Agent 工具 + Web 双模工作台）
│   ├── skills/              # 73 个独立影视专业技能插件（含 INDEX.json 清单）
│   ├── scripts/             # 本地无密钥联调 Mock 服务（mock-upstream.mjs）
│   ├── dev/                 # 本地联调模型配置补丁（mock.patch.yml）
│   └── README.md            # 插件架构与二次开发指南
├── setup.sh                 # 一键安装依赖、构建底座与主插件、注册全部 73 个技能
├── start-mock.sh            # 一键启动无密钥全链路体验模式
├── start.sh                 # 一键启动正式创作模式
├── LICENSE                  # MIT 开源协议
└── README.md                # 项目说明文档
```

---

## 环境要求

- **Node.js**：推荐 `v24.22.3+`（Node 24+ 均可运行）
- **pnpm**：`v11`（可执行 `corepack enable` 自动启用）
- **FFmpeg / FFprobe**：用于视频尾帧抽取、音画混流成片与剪映草稿导出
  - macOS：`brew install ffmpeg`
  - Ubuntu / Debian：`sudo apt install ffmpeg`

---

## 快速开始

### 方式一：无密钥全链路体验（推荐先试）

无需配置任何真实 API Key，内置本地多模态 Mock 服务（支持多轮导演模拟、真实画幅 PNG 生成、FFmpeg MP4 视频渲染与语音合成），可直接体验完整短剧生产流程：

```bash
git clone https://github.com/lonehsigle/mujing-studio.git
cd mujing-studio
./start-mock.sh
```

首次运行会自动执行 `./setup.sh`（安装依赖、构建运行底座与幕境主插件、初始化独立 Profile `.dsh-mujing/` 并挂载全部 73 个技能插件，约需 1～3 分钟）。启动后在浏览器打开终端打印的 `http://127.0.0.1:3090/?token=...` 链接，选择「幕境导演」与 `Mock Director` 模型即可点击样板卡片开始体验。

### 方式二：连接真实大模型与多模态服务

```bash
cd mujing-studio
export DEEPSEEK_API_KEY="sk-你的密钥"
./start.sh
```

生图、视频、配音模型支持通过界面左下角 `● 生图` / `● 视频` / `● 配音` 面板可视化配置（支持多接口池与权重调度），也支持通过环境变量预设：

| 环境变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek 对话大模型密钥 |
| `MUJING_IMAGE_BASE_URL` / `MUJING_IMAGE_API_KEY` | 图片生成服务地址（含 `/v1`）与密钥 |
| `MUJING_IMAGE_FLAVOR` / `MUJING_IMAGE_MODEL` | `openai`（默认）或 `ark`（火山方舟 Seedream）；默认模型 `gpt-image-1` |
| `MUJING_VIDEO_BASE_URL` / `MUJING_VIDEO_API_KEY` | 视频生成服务地址与密钥（方舟为 `https://ark.cn-beijing.volces.com/api/v3`） |
| `MUJING_VIDEO_FLAVOR` / `MUJING_VIDEO_MODEL` | `ark`（默认，Seedance）或 `openai`；默认模型 `doubao-seedance-1-0-pro-250528` |
| `MUJING_AUDIO_BASE_URL` / `MUJING_AUDIO_API_KEY` | 可选独立配音服务地址与密钥（未设置时默认复用图片服务的 `/audio/speech`） |
| `MUJING_AUDIO_MODEL` / `MUJING_AUDIO_VOICE` | TTS 模型（默认 `gpt-4o-mini-tts`）与默认音色（如 `alloy` / `nova` / `onyx` / `shimmer`） |
| `PORT` | Web 服务端口（默认 `3090`） |
| `NO_OPEN` | 设为 `1` 时启动后不自动打开系统浏览器 |

> 所有本地项目数据、生成的媒体文件、剪映草稿与个人配置均保存在独立目录 `.dsh-mujing/` 下，不会污染系统全局配置。

---

## 二次开发

修改 `mujing/canvas/src/` 下的宿主服务、Agent 工具或 Web 客户端代码后，执行以下命令重新构建主插件并重启服务即可：

```bash
node mujing/canvas/build.mjs --harness ./deepseek-harness
```

更多关于插件槽位、宿主服务架构与工具定义的细节，请参阅 [`mujing/README.md`](./mujing/README.md)。

---

## 开源协议与致谢

- 本项目幕境插件代码与脚本采用 **[MIT License](./LICENSE)** 开源。
- 底层运行底座 **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** 遵循其原始 [MIT License](./deepseek-harness/LICENSE)。
- `mujing/skills/` 目录下部分技能参考了开源社区方法论成果，各自的署名与许可说明均完整保留在对应技能目录的 `THIRD-PARTY-LICENSES.md` 中。
