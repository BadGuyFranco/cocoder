export const GOVERNED_READ_DENY = [
  'local/**',
  '.env*',
  '**/.env*',
  'secrets/**',
  '**/secrets/**',
  '*credentials*',
  '**/*credentials*',
  '.git/**',
  'node_modules/**',
] as const satisfies readonly string[]
