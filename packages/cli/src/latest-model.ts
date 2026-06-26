import type { Adapter } from '@cocoder/core'

export async function latestModelFor(adapter: Adapter): Promise<string> {
  const list = await adapter.listModels()
  const model = list.models[0]?.trim()
  if (!model) throw new Error(`adapter "${adapter.id}" did not report a latest model`)
  return model
}
