/**
 * Validates whether a content ID is in lowercase kebab-case format.
 * Lowercase kebab-case IDs only contain lowercase letters, numbers, and hyphens.
 */
export function isValidId(id: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}
