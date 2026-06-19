// Mirrors packages/daemon/src/security.ts OZ_CSRF_HEADER. Duplicated (not imported) because the
// topology rule forbids @cocoder/ui from importing @cocoder/daemon — this is a wire-protocol constant,
// not shared logic. If the daemon ever changes the header name, this must change with it.
export const OZ_CSRF_HEADER = 'x-oz-csrf-token'
