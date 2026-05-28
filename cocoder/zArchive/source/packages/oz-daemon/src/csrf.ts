import { randomBytes } from "node:crypto";

export const OZ_CSRF_HEADER = "x-oz-csrf-token";

export function createCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function validateCsrfToken(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  return provided.trim() === expected;
}
