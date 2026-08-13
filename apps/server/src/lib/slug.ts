/** Derive a URL-safe slug from an arbitrary name. Falls back to "service". */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63) || 'service'
  );
}
