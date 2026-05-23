export function parseBooleanFlag(value, defaultValue = false) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return defaultValue;
}

export function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function getLane(root, lanePath) {
  return String(lanePath).split('.').reduce((current, part) => current?.[part], root);
}

export function compactTimestamp(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
