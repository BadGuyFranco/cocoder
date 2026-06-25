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
