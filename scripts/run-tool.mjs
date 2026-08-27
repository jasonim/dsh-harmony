import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [tool, ...args] = process.argv.slice(2)
if (tool !== 'tsc' && tool !== 'tsdown') {
  throw new Error(`run-tool: unsupported tool ${JSON.stringify(tool)}`)
}

const binary = join(root, 'node_modules', '.bin', tool)
if (!existsSync(binary)) {
  throw new Error(`run-tool: ${tool} is unavailable; run pnpm install`)
}
const result = spawnSync(binary, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
