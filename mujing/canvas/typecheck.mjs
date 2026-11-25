/**
 * 对 mujing-canvas 执行完整 TypeScript 静态类型检查（tsc --noEmit）。
 * 自动从宿主 deepseek-harness 的 pnpm store 解析 typescript、@types/node、@types/react 与 @deepseek-ai/* 类型定义。
 * 用法：node typecheck.mjs [--harness ../../deepseek-harness]
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const hi = argv.indexOf('--harness')
const harness = resolve(root, hi >= 0 && argv[hi + 1] ? argv[hi + 1] : '../../deepseek-harness')
const pnpmStore = join(harness, 'node_modules/.pnpm')

function findStorePkg(prefix, pkgSubpath) {
  if (!existsSync(pnpmStore)) return undefined
  const dirs = readdirSync(pnpmStore)
    .filter(d => d.startsWith(prefix))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const dir of dirs) {
    const candidate = join(pnpmStore, dir, 'node_modules', pkgSubpath)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const tscBin = existsSync(join(root, 'node_modules/typescript/bin/tsc'))
  ? join(root, 'node_modules/typescript/bin/tsc')
  : findStorePkg('typescript@', 'typescript/bin/tsc')

if (!tscBin) {
  console.error(`找不到 TypeScript 编译器：请在 ${harness} 执行 pnpm install`)
  process.exit(1)
}

const typesNode = findStorePkg('@types+node@24', '@types/node') ?? findStorePkg('@types+node@', '@types/node')
const typesReact = findStorePkg('@types+react@18', '@types/react') ?? findStorePkg('@types+react@', '@types/react')
const dshScope = join(pnpmStore, 'node_modules/@deepseek-ai')

const base = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
const paths = {}

if (typesReact) {
  paths['react'] = [join(typesReact, 'index.d.ts')]
  paths['react/jsx-runtime'] = [join(typesReact, 'jsx-runtime.d.ts')]
  paths['react/jsx-dev-runtime'] = [join(typesReact, 'jsx-dev-runtime.d.ts')]
}

for (const name of ['cordis', 'schemastery', 'dsh-agent', 'dsh-llm', 'dsh-tools']) {
  const pkgDir = join(dshScope, name)
  if (!existsSync(pkgDir)) continue
  const pkgJsonPath = join(pkgDir, 'package.json')
  let entry = join(pkgDir, 'src/index.ts')
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
      const rel = pkg.types || pkg.typings || pkg.exports?.['.']?.types || pkg.exports?.['.']?.default || pkg.main
      if (typeof rel === 'string' && existsSync(join(pkgDir, rel))) {
        entry = join(pkgDir, rel)
      }
    } catch { /* fallback to src/index.ts */ }
  }
  paths[`@deepseek-ai/${name}`] = [entry]
}

const typeRoots = []
if (typesNode) typeRoots.push(dirname(typesNode))
if (typesReact) typeRoots.push(dirname(typesReact))

const tmpConfigPath = join(root, '.tsconfig.typecheck.tmp.json')
const tmpConfig = {
  ...base,
  compilerOptions: {
    ...base.compilerOptions,
    ...(typeRoots.length > 0 ? { typeRoots: [...new Set(typeRoots)], types: ['node'] } : {}),
    paths,
  },
}

writeFileSync(tmpConfigPath, JSON.stringify(tmpConfig, null, 2))

try {
  execFileSync(process.execPath, [tscBin, '-p', tmpConfigPath, '--noEmit'], {
    cwd: root,
    stdio: 'inherit',
  })
  console.log('mujing-canvas TypeScript 类型检查通过')
} finally {
  try { rmSync(tmpConfigPath, { force: true }) } catch { /* ignore */ }
}
