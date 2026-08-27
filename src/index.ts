import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type ToolRegistry from '@deepseek-ai/dsh-tools'
import { PLUGIN_NAME } from './contracts.ts'
import { createHarmonyToolSpecs, type HarmonyToolSpec } from './tool-specs.ts'

export * from './contracts.ts'
export * from './device-controller.ts'
export * from './hdc.ts'
export * from './tool-specs.ts'
export * from './ui-actions.ts'
export * from './ui-tree.ts'

export const name = PLUGIN_NAME
export const inject = ['tools']

type HostContext = Context & { tools: ToolRegistry }

function asTool(spec: HarmonyToolSpec): ToolDefinition {
  const parameters = Object.fromEntries(Object.entries(spec.parameters.properties).map(([key, value]) => [
    key,
    spec.parameters.required.includes(key) ? { ...value, required: true } : value,
  ]))
  return defineTool({
    name: spec.name,
    description: spec.description,
    parameters: parameters as never,
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: JsonValue) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs: spec.timeoutMs,
    isConcurrencySafe: () => !spec.write,
    execute: args => spec.execute(args as Record<string, unknown>) as Promise<JsonValue>,
  })
}

export function apply(ctx: Context): () => Promise<void> {
  const host = ctx as HostContext
  const runtime = {
    execute: async (toolName: string): Promise<never> => {
      throw new Error(`${toolName}: runtime initialization is pending`)
    },
  }
  const tools = createHarmonyToolSpecs(runtime as never).map(asTool)
  const disposers = tools.map(tool => ctx.effect(
    () => host.tools.register(tool),
    `${PLUGIN_NAME}:${tool.name}`,
  ))
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
