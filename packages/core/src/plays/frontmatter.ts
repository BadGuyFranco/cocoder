import {
  PLAY_COMMIT_MODES,
  PLAY_EXECUTION_MODELS,
  PLAY_TRIGGER_CLASSES,
  type Play,
  type PlayCommitMode,
  type PlayDelta,
  type PlayExecutionModel,
  type PlayTriggerClass,
} from './types.js'

type FrontmatterValue = string | string[] | undefined
type FrontmatterData = Record<string, string | string[]>

interface ParseOptions {
  readonly file: string
  readonly owner: 'play' | 'play delta'
  readonly createError?: (message: string) => Error
}

type PlayContractMetadata = Pick<
  Play,
  | 'executionModel'
  | 'triggerClass'
  | 'purpose'
  | 'allowedCallers'
  | 'inputSchema'
  | 'outputValidator'
  | 'deterministicStep'
  | 'commitMode'
  | 'requiredCheckpoints'
>

export function parsePlayContractFrontmatter(data: FrontmatterData, options: ParseOptions): PlayContractMetadata {
  return {
    ...withOptional('executionModel', optionalExecutionModel(data.executionModel, options)),
    ...withOptional('triggerClass', optionalTriggerClass(data.triggerClass, options)),
    ...withOptional('purpose', optionalString(data.purpose, 'purpose', options)),
    ...withOptional('allowedCallers', optionalStringList(data.allowedCallers)),
    ...withOptional('inputSchema', optionalRef(data.inputSchema, 'inputSchema', options)),
    ...withOptional('outputValidator', optionalRef(data.outputValidator, 'outputValidator', options)),
    ...withOptional('deterministicStep', optionalRef(data.deterministicStep, 'deterministicStep', options)),
    ...withOptional('commitMode', optionalCommitMode(data.commitMode, options)),
    ...withOptional('requiredCheckpoints', optionalStringList(data.requiredCheckpoints)),
  }
}

function optionalExecutionModel(value: FrontmatterValue, options: ParseOptions): PlayExecutionModel | undefined {
  if (value === undefined) return undefined
  return oneOf(value, 'executionModel', PLAY_EXECUTION_MODELS, options)
}

function optionalTriggerClass(value: FrontmatterValue, options: ParseOptions): PlayTriggerClass | undefined {
  if (value === undefined) return undefined
  return oneOf(value, 'triggerClass', PLAY_TRIGGER_CLASSES, options)
}

function optionalCommitMode(value: FrontmatterValue, options: ParseOptions): PlayCommitMode | undefined {
  if (value === undefined) return undefined
  return oneOf(value, 'commitMode', PLAY_COMMIT_MODES, options)
}

function optionalString(value: FrontmatterValue, field: string, options: ParseOptions): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '') {
    throw frontmatterError(field, 'must be a non-empty string', options)
  }
  return value
}

function optionalStringList(value: FrontmatterValue): readonly string[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

function optionalRef(
  value: FrontmatterValue,
  field: string,
  options: ParseOptions,
): { readonly ref: string } | undefined {
  const ref = optionalString(value, field, options)
  return ref === undefined ? undefined : { ref }
}

function oneOf<const Values extends readonly string[]>(
  value: FrontmatterValue,
  field: string,
  values: Values,
  options: ParseOptions,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw frontmatterError(field, `must be ${formatValues(values)}`, options)
  }
  return value
}

function frontmatterError(field: string, message: string, options: ParseOptions): Error {
  const fullMessage = `${options.owner} ${options.file}: frontmatter "${field}" ${message}`
  return options.createError ? options.createError(fullMessage) : new Error(fullMessage)
}

function formatValues(values: readonly string[]): string {
  if (values.length === 2) return `"${values[0]}" or "${values[1]}"`
  const quoted = values.map((value) => `"${value}"`)
  return `${quoted.slice(0, -1).join(', ')}, or ${quoted[quoted.length - 1]}`
}

export function withOptional<K extends keyof PlayDelta>(
  key: K,
  value: PlayDelta[K] | undefined,
): Pick<PlayDelta, K> | Record<string, never> {
  return value === undefined ? {} : { [key]: value } as Pick<PlayDelta, K>
}
