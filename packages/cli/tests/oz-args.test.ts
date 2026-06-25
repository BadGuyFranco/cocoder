import { expect, test } from 'vitest'
import { createPriorityInvocation } from '../src/oz-args.js'

test('maps --id/--title/--objective to the create-priority invocation', () => {
  expect(createPriorityInvocation(['--id', 'foo', '--title', 'Foo bar', '--objective', 'Do the thing'])).toEqual({
    id: 'foo',
    title: 'Foo bar',
    objective: 'Do the thing',
  })
})

test('trims values and ignores unrelated flags', () => {
  expect(createPriorityInvocation(['--workspace', 'cocoder', '--id', ' foo ', '--title', ' T ', '--objective', ' O '])).toEqual({
    id: 'foo',
    title: 'T',
    objective: 'O',
  })
})

test('throws naming the missing required flags', () => {
  expect(() => createPriorityInvocation(['--id', 'foo'])).toThrow(/--title, --objective/)
})

test('throws on an empty / whitespace flag value', () => {
  expect(() => createPriorityInvocation(['--id', '   ', '--title', 'T', '--objective', 'O'])).toThrow(/--id/)
})

test('maps --details-file content verbatim onto the create-priority invocation', () => {
  const details = [
    '## Phase A',
    '',
    'Badge: [priority-details: exact]',
    '',
    'Keep this markdown as approved.',
    '',
    '## Non-goals',
    '',
    '- Do not summarize the body.',
  ].join('\n')

  expect(
    createPriorityInvocation(['--id', 'foo', '--title', 'Foo bar', '--objective', 'Do the thing', '--details-file', 'details.md'], {
      readFileText: (path) => {
        expect(path).toBe('details.md')
        return details
      },
    }),
  ).toEqual({
    id: 'foo',
    title: 'Foo bar',
    objective: 'Do the thing',
    details,
  })
})

test('maps --details-stdin content verbatim onto the create-priority invocation', () => {
  const details = '## Phase A\n\nRead from stdin.\n'

  expect(
    createPriorityInvocation(['--id', 'foo', '--title', 'Foo bar', '--objective', 'Do the thing', '--details-stdin'], {
      readStdin: () => details,
    }),
  ).toEqual({
    id: 'foo',
    title: 'Foo bar',
    objective: 'Do the thing',
    details,
  })
})

test('omits details when no details flag is present', () => {
  expect(createPriorityInvocation(['--id', 'foo', '--title', 'Foo bar', '--objective', 'Do the thing'])).not.toHaveProperty('details')
})

test('throws when details sources conflict', () => {
  expect(() =>
    createPriorityInvocation(['--id', 'foo', '--title', 'Foo bar', '--objective', 'Do the thing', '--details-file', 'details.md', '--details-stdin']),
  ).toThrow(/one details source/)
})

test('throws when --details-file is missing a path', () => {
  expect(() => createPriorityInvocation(['--id', 'foo', '--title', 'Foo bar', '--objective', 'Do the thing', '--details-file'])).toThrow(
    /--details-file <path>/,
  )
})

test('throws when resolved details are empty', () => {
  expect(() =>
    createPriorityInvocation(['--id', 'foo', '--title', 'Foo bar', '--objective', 'Do the thing', '--details-stdin'], {
      readStdin: () => '  \n\t  ',
    }),
  ).toThrow(/non-empty details/)
})

test('throws when the details file reader fails', () => {
  expect(() =>
    createPriorityInvocation(['--id', 'foo', '--title', 'Foo bar', '--objective', 'Do the thing', '--details-file', 'missing.md'], {
      readFileText: () => {
        throw new Error('ENOENT')
      },
    }),
  ).toThrow(/cannot read --details-file missing\.md: ENOENT/)
})
