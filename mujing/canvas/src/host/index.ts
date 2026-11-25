/**
 * mujing-canvas host 入口（host plane）：提供 `ctx.mujing` 服务；Web 场景下额外挂载 /mujing HTTP 接口。
 * Agent 工具在 `mujing-canvas/tools`，由「幕境导演」agent preset 挂载。
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, MujingService } from './service.ts'
import * as web from './web.ts'

export const name = 'mujing'
export { Config }

export function apply(ctx: Context, config: Config): void {
  ctx.plugin(MujingService, config)
  // webServer 只在 web 组合里存在；sdk/headless 组合下该子插件保持挂起，不影响工具使用。
  ctx.plugin(web)
}

export { MujingService } from './service.ts'
export type * from './types.ts'
