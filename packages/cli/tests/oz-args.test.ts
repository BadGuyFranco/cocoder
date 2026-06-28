import { expect, test } from 'vitest'
import { archivePriorityInvocation, createPriorityInvocation, createTicketInvocation, editPriorityInvocation } from '../src/oz-args.js'

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

test('maps create-ticket flags with inline description and binding reason', () => {
  expect(createTicketInvocation(['--title', ' Agent Ticket ', '--type', ' bug ', '--priority', ' tickets-review ', '--reason', ' Founder chose it. ', '--description', ' Fix it. '])).toEqual({
    title: 'Agent Ticket',
    type: 'bug',
    priority: 'tickets-review',
    bindingReason: 'Founder chose it.',
    description: 'Fix it.',
  })
})

test('maps create-ticket description from details source', () => {
  const description = '## Context\n\nKeep this markdown.'

  expect(
    createTicketInvocation(['--title', 'Agent Ticket', '--type', 'bug', '--details-file', 'ticket.md'], {
      readFileText: (path) => {
        expect(path).toBe('ticket.md')
        return description
      },
    }),
  ).toEqual({
    title: 'Agent Ticket',
    type: 'bug',
    description,
  })
})

test('passes through an optional create-ticket id', () => {
  expect(createTicketInvocation(['--title', 'Agent Ticket', '--type', 'bug', '--priority', 'tickets-review', '--reason', 'Founder chose it.', '--description', 'Fix it.', '--id', ' 0042 '])).toEqual({
    title: 'Agent Ticket',
    type: 'bug',
    priority: 'tickets-review',
    bindingReason: 'Founder chose it.',
    description: 'Fix it.',
    ticketId: '0042',
  })
})

test('throws naming missing create-ticket required flags', () => {
  expect(() => createTicketInvocation(['--title', 'Agent Ticket'])).toThrow(/--type/)
})

test('throws when create-ticket priority binding has no reason', () => {
  expect(() => createTicketInvocation(['--title', 'Agent Ticket', '--type', 'bug', '--priority', 'tickets-review'])).toThrow(/requires a binding reason/)
})

test('throws when create-ticket description sources conflict', () => {
  expect(() =>
    createTicketInvocation(['--title', 'Agent Ticket', '--type', 'bug', '--description', 'Fix it.', '--details-stdin'], {
      readStdin: () => 'stdin',
    }),
  ).toThrow(/one description source/)
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

test('maps edit-priority --details-file replace-body content verbatim', () => {
  const details = ['## Phase A', '', 'Badge: [priority-details: edit]', '', 'Keep this body.', '', '## Non-goals', '', '- No summary.'].join('\n')

  expect(
    editPriorityInvocation(['foo', '--mode', 'replace-body', '--details-file', 'x.md'], {
      readFileText: (path) => {
        expect(path).toBe('x.md')
        return details
      },
    }),
  ).toEqual({
    id: 'foo',
    mode: 'replace-body',
    details,
  })
})

test('maps edit-priority --details-stdin append-section content verbatim', () => {
  const details = '## Phase B\n\nAppend this section.\n'

  expect(
    editPriorityInvocation(['foo', '--mode', 'append-section', '--details-stdin'], {
      readStdin: () => details,
    }),
  ).toEqual({
    id: 'foo',
    mode: 'append-section',
    details,
  })
})

test('maps edit-priority objective-only changes', () => {
  expect(editPriorityInvocation(['foo', '--objective', 'New approved objective'])).toEqual({
    id: 'foo',
    objective: 'New approved objective',
  })
})

test('maps edit-priority objective plus body details', () => {
  const details = '## Phase A\n\nReplace this body.'

  expect(
    editPriorityInvocation(['foo', '--objective', 'New approved objective', '--mode', 'replace-body', '--details-file', 'x.md'], {
      readFileText: () => details,
    }),
  ).toEqual({
    id: 'foo',
    objective: 'New approved objective',
    mode: 'replace-body',
    details,
  })
})

test('throws when edit-priority id is missing', () => {
  expect(() => editPriorityInvocation(['--objective', 'New approved objective'])).toThrow(/<id>/)
})

test('throws when edit-priority details omit mode', () => {
  expect(() =>
    editPriorityInvocation(['foo', '--details-stdin'], {
      readStdin: () => '## Phase A',
    }),
  ).toThrow(/details need --mode/)
})

test('throws when edit-priority mode omits details', () => {
  expect(() => editPriorityInvocation(['foo', '--mode', 'replace-body'])).toThrow(/--mode needs details/)
})

test('throws when edit-priority mode is invalid', () => {
  expect(() =>
    editPriorityInvocation(['foo', '--mode', 'rewrite', '--details-stdin'], {
      readStdin: () => '## Phase A',
    }),
  ).toThrow(/replace-body or append-section/)
})

test('throws when edit-priority details sources conflict', () => {
  expect(() =>
    editPriorityInvocation(['foo', '--mode', 'replace-body', '--details-file', 'x.md', '--details-stdin'], {
      readFileText: () => '## Phase A',
      readStdin: () => '## Phase B',
    }),
  ).toThrow(/one details source/)
})

test('throws when edit-priority details are empty', () => {
  expect(() =>
    editPriorityInvocation(['foo', '--mode', 'append-section', '--details-stdin'], {
      readStdin: () => '  \n\t  ',
    }),
  ).toThrow(/non-empty details/)
})

test('throws when edit-priority has no edit', () => {
  expect(() => editPriorityInvocation(['foo'])).toThrow(/--objective or details/)
})

test('throws when edit-priority objective is empty', () => {
  expect(() => editPriorityInvocation(['foo', '--objective', '   '])).toThrow(/non-empty --objective/)
})

test('maps archive-priority with default disposition fields', () => {
  expect(archivePriorityInvocation(['demo'])).toEqual({
    workspaceId: 'cocoder',
    invocation: {
      id: 'demo',
      verdict: 'archive confirmed',
      reason: 'Founder confirmed archive from CLI.',
    },
  })
})

test('maps archive-priority workspace and explicit disposition fields', () => {
  expect(
    archivePriorityInvocation([
      'demo',
      '--workspace',
      'other',
      '--verdict',
      'archive ready',
      '--findings',
      'No open handled tickets.',
      '--reason',
      'Founder confirmed after stale check.',
    ]),
  ).toEqual({
    workspaceId: 'other',
    invocation: {
      id: 'demo',
      verdict: 'archive ready',
      findings: 'No open handled tickets.',
      reason: 'Founder confirmed after stale check.',
    },
  })
})

test('throws when archive-priority id is missing or a flag', () => {
  expect(() => archivePriorityInvocation([])).toThrow(/<priorityId>/)
  expect(() => archivePriorityInvocation(['--help'])).toThrow(/<priorityId>/)
})

test('throws when archive-priority flag values are missing', () => {
  expect(() => archivePriorityInvocation(['demo', '--workspace'])).toThrow(/--workspace <workspaceId>/)
  expect(() => archivePriorityInvocation(['demo', '--verdict'])).toThrow(/non-empty --verdict/)
  expect(() => archivePriorityInvocation(['demo', '--findings', '--reason', 'x'])).toThrow(/non-empty --findings/)
})
