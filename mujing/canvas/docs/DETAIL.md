# Mujing Studio (`mujing-canvas`)

End-to-end AI film, comic-drama, and short-drama production studio built natively on DeepSeek Harness (`dsh`). Provides both a **Split-Screen Collaborative Studio** (docked in the right sidebar alongside the Director chat) and a **Fullscreen Immersive Studio**, plus the **Mujing Director** (`幕境导演`) agent preset.

| Component | Description |
|---|---|
| **Dual-Mode Studio** | Dockable right-sidebar studio (`mujing.studio.tab`), fullscreen main panel (`mujing.canvas`), blank-session starter prompt dock, and rich inline chat tool cards |
| **Storyboard Pipeline** | Novel-to-episode breakdown, Character / Scene / Prop turnaround sheet locking & TTS voice binding, per-shot keyframes & dialogue voiceovers, and FFmpeg tail-frame-to-first-frame continuous video generation |
| **Infinite Canvas & Timeline** | Text, image, video, and audio nodes with reference edges, drag-and-drop local media upload, undo/redo, `.mujing.json` import/export, FFmpeg audio+video MP4 + SRT synthesis, and JianyingPro draft export |
| **12 Director Tools** | `canvas_list_projects`, `canvas_create_project`, `canvas_get_state`, `canvas_apply_ops`, `generate_media`, `drama_save_plan`, `drama_generate_casts`, `drama_generate_shot_media`, `drama_run_episode`, `timeline_compose`, `timeline_export_jianying`, `media_status` + automatic `<mujing_studio_context>` injection |

Configure via `MUJING_IMAGE_*`, `MUJING_VIDEO_*`, and optional `MUJING_AUDIO_*` environment variables (`BASE_URL`, `API_KEY`, `FLAVOR`, `MODEL`, `VOICE`). Data persists in `$DSH_HOME/mujing/`.
