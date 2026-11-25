/** 幕境技能插件：向 dsh 技能注册表提供一个技能；技能正文在 ./skill/SKILL.md，资源目录为 ./skill/。 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const manifest = JSON.parse(readFileSync(new URL('./skill.json', import.meta.url), 'utf8'))
const BODY = new URL('./skill/SKILL.md', import.meta.url)
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(new URL('./skill/', import.meta.url)) }
const INVOCATION = { modelInvocable: true, userInvocable: true }
/** 与 dsh 内置打包技能相同的优先级（BUNDLED_SKILL_RANK）。 */
const RANK = 600

/** Cordis 插件名。 */
export const name = manifest.package
/** 依赖技能注册表服务。 */
export const inject = ['skills']

/**
 * 注册本包的技能 provider；插件卸载时由 registerProvider 返回的 disposer 自动注销。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 */
export function apply(ctx) {
  const summary = {
    name: manifest.name,
    description: manifest.description,
    ...(manifest.whenToUse ? { whenToUse: manifest.whenToUse } : {}),
    invocation: INVOCATION,
    provider: manifest.package,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    path: fileURLToPath(BODY),
  }
  ctx.skills.registerProvider(() => ({
    name: manifest.package,
    list: () => Promise.resolve([{ ...summary, rank: RANK, locator: BODY.href, metadata: manifest.metadata }]),
    async get() {
      const text = await readFile(BODY, 'utf8')
      const content = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      return { ...summary, metadata: manifest.metadata, content }
    },
  }))
}
