import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/cordis') return { url: 'mujing-tools-stub://cordis', shortCircuit: true }
    if (specifier === '@deepseek-ai/schemastery') return { url: 'mujing-tools-stub://schemastery', shortCircuit: true }
    if (specifier === '@deepseek-ai/dsh-llm') return { url: 'mujing-tools-stub://dsh-llm', shortCircuit: true }
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'mujing-tools-stub://dsh-tools', shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'mujing-tools-stub://cordis') {
      return { format: 'module', shortCircuit: true, source: `export class Service { constructor(ctx) { this.ctx = ctx; } }` }
    }
    if (url === 'mujing-tools-stub://schemastery') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `const chain = () => { const fn = () => chain(); return new Proxy(fn, { get: (_t, p) => p === 'then' ? undefined : () => chain() }); }; export default chain();`,
      }
    }
    if (url === 'mujing-tools-stub://dsh-llm') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export class HarnessError extends Error {
            constructor(msg, code) { super(msg); this.code = code; }
          }
          export function createUserMessage(msg) { return { role: 'user', ...msg }; }
        `,
      }
    }
    if (url === 'mujing-tools-stub://dsh-tools') {
      return { format: 'module', shortCircuit: true, source: `export function defineTool(def) { return def; }` }
    }
    return nextLoad(url, context)
  },
})

const { apply: applyTools } = await import('../src/tools.ts')
const { MujingService } = await import('../src/host/service.ts')
const { ProjectStore } = await import('../src/host/store.ts')
const { MediaService } = await import('../src/host/media.ts')

test('tools.ts registers all 12 director tools and injects deduplicated studio context on agent/pre-step', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mujing-tools-test-'))
  try {
    const svc = Object.create(MujingService.prototype) as InstanceType<typeof MujingService>
    Object.assign(svc, {
      dataDir: dir,
      store: new ProjectStore(dir),
      running: new Map(),
      media: new MediaService(
        dir,
        { apiKeyEnv: 'NONE', model: 'img', size: '1024x1024', flavor: 'openai' },
        { apiKeyEnv: 'NONE', model: 'vid', flavor: 'openai', duration: 4, ratio: '9:16', pollIntervalMs: 10, timeoutMs: 5000 },
        { apiKeyEnv: 'NONE', model: 'tts', voice: 'alloy', format: 'mp3' },
      ),
    })

    const registered = new Map<string, { execute: (args: Record<string, unknown>, ctx?: unknown) => Promise<unknown> }>()
    type PreStepHandler = (
      ev: { agent: { session: object }; step: number; signal: AbortSignal },
      next: () => Promise<{ kind: string; messages: unknown[] }>,
    ) => Promise<{ kind: string; messages: unknown[] }>
    const hooks: { preStep?: PreStepHandler } = {}

    const fakeCtx = {
      mujing: svc,
      tools: {
        register(tool: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }) {
          registered.set(tool.name, tool)
        },
      },
      on(event: string, handler: PreStepHandler) {
        if (event === 'agent/pre-step') hooks.preStep = handler
      },
    }

    applyTools(fakeCtx as never)
    assert.equal(registered.size, 12)
    assert.ok(registered.has('canvas_create_project'))
    assert.ok(registered.has('drama_save_plan'))
    assert.ok(registered.has('timeline_compose'))
    assert.ok(registered.has('timeline_export_jianying'))

    // Execute create + list tools
    const created = await registered.get('canvas_create_project')!.execute({ title: '工具测试短剧' }) as { project_id: string; title: string }
    assert.equal(created.title, '工具测试短剧')
    const listed = await registered.get('canvas_list_projects')!.execute({}) as { active_project_id: string; projects: unknown[] }
    assert.equal(listed.active_project_id, created.project_id)
    assert.equal(listed.projects.length, 1)

    // Verify agent/pre-step snapshot injection & deduplication
    assert.ok(hooks.preStep)
    const session = {}
    const ac = new AbortController()
    const d1 = await hooks.preStep({ agent: { session }, step: 1, signal: ac.signal }, async () => ({ kind: 'allow', messages: [] }))
    assert.equal(d1.messages.length, 1)
    const firstMsg = d1.messages[0] as { content: Array<{ text: string }> }
    assert.match(firstMsg.content[0].text, /<mujing_studio_context>/)
    assert.match(firstMsg.content[0].text, /工具测试短剧/)

    // Identical state on same session should be deduplicated
    const d2 = await hooks.preStep({ agent: { session }, step: 1, signal: ac.signal }, async () => ({ kind: 'allow', messages: [] }))
    assert.equal(d2.messages.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
