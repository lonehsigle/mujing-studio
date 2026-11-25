# 幕境工作台（Mujing Studio）

基于 DeepSeek Harness 的 AI 影视与短剧全链路创作工作台。安装后支持**「左导演对话 · 右分屏工作台」**与**「全屏沉浸工作台」**双模无缝切换，并在 Agent 预设中提供「幕境导演」。

## 包含的能力

| 组成 | 说明 |
|---|---|
| **双模协同工作台** | 会话右侧可停靠「幕境影视工作台」分屏 + 左侧主栏「幕境工作台」全屏视图；空白会话提供一键开拍样板坞，对话消息内嵌工具富媒体预览卡片 |
| **短剧分镜故事板** | 小说拆集分镜、角色/场景/道具三视图设定卡锁定与专属音色绑定、单镜关键帧（Keyframe）与对白 TTS 配音生成、行内分镜编辑、FFmpeg 抽尾帧接首帧连续生成视频 |
| **无限画布与时间线** | 文本 / 图片 / 视频 / 配音四类节点与连线、本地文件拖拽上传、撤销/重做、JSON 导入导出；多轨音画混流合成 MP4 + SRT 字幕、一键导出剪映专业版（JianyingPro）草稿 |
| **幕境导演（Agent 预设）** | 自动感知 `<mujing_studio_context>` 实时快照，挂载 12 个影视工具与全部已安装的幕境专业技能插件 |
| **12 个 Agent 工具** | `canvas_list_projects`、`canvas_create_project`、`canvas_get_state`、`canvas_apply_ops`、`generate_media`、`drama_save_plan`、`drama_generate_casts`、`drama_generate_shot_media`、`drama_run_episode`、`timeline_compose`、`timeline_export_jianying`、`media_status` |

## 环境变量配置

| 环境变量 | 作用 |
|---|---|
| `MUJING_IMAGE_BASE_URL` / `MUJING_IMAGE_API_KEY` | 图片服务地址（含 `/v1`）与密钥 |
| `MUJING_IMAGE_FLAVOR` / `MUJING_IMAGE_MODEL` | `openai`（默认）或 `ark`（火山方舟 Seedream）；默认模型 `gpt-image-1` |
| `MUJING_VIDEO_BASE_URL` / `MUJING_VIDEO_API_KEY` | 视频服务地址与密钥，方舟为 `https://ark.cn-beijing.volces.com/api/v3` |
| `MUJING_VIDEO_FLAVOR` / `MUJING_VIDEO_MODEL` | `ark`（默认，Seedance）或 `openai`；默认模型 `doubao-seedance-1-0-pro-250528` |
| `MUJING_AUDIO_BASE_URL` / `MUJING_AUDIO_API_KEY` | 可选配音服务地址与密钥（未设置时默认复用图片服务的 `/audio/speech`） |
| `MUJING_AUDIO_MODEL` / `MUJING_AUDIO_VOICE` | TTS 模型（默认 `gpt-4o-mini-tts`）与默认音色（`alloy` / `nova` / `onyx` / `shimmer` 等） |

项目与媒体产物保存在 `$DSH_HOME/mujing/`（`projects/` 项目 JSON，`assets/` 本地媒体文件，`jianying-drafts/` 剪映草稿目录）。
