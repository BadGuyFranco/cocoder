/** Constrains a number to an inclusive min/max range. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError('clamp: min must be <= max')
  }

  if (value < min) {
    return min
  }

  if (value > max) {
    return max
  }

  return value
}
