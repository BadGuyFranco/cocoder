/** Truncates text to max chars with a trailing ellipsis when needed. */
export function truncate(text: string, max: number): string {
  if (max < 1) {
    throw new RangeError('truncate: max must be >= 1')
  }

  if (text.length <= max) {
    return text
  }

  return `${text.slice(0, max - 1)}…`
}
