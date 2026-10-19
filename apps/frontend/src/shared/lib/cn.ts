/** Joins truthy class names. Kept tiny on purpose (no class merging). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
