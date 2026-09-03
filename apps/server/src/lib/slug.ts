/**
 * Derive a URL-safe slug from an arbitrary name. Falls back to "service".
 *
 * The result must satisfy the canonical `slug` contract in
 * `@ninedeploy/schemas` (`/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/`, max 63):
 * callers store it verbatim as a service/database slug and reuse it as the
 * `nd-svc-<slug>` / `nd-db-<slug>` container name and bridge DNS label, and
 * none of those paths re-validate it. Truncation therefore happens BEFORE the
 * trailing separator is dropped — cutting at 63 first can strand a `-`, and a
 * DNS label may not end with one.
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  // The canonical contract is 2..63 characters. A one-character name ("a"), or
  // one that COLLAPSES to a single character ("a!"), is legal input to
  // createService / createDatabase / createProject, and those routes persist
  // this derivation without re-validating it — so the server would store a slug
  // that its own updateService / createProject schema then rejects. Padding
  // belongs here and not as a larger `name.min()` because the collapse happens
  // inside this function: no bound on the input length can prevent it. Repeat
  // the character rather than inventing a suffix or throwing — the user's own
  // letter is preserved, the result stays a legal DNS label, and the function
  // remains idempotent (slugify('aa') === 'aa'), so a re-slug never drifts.
  if (slug.length === 1) return `${slug}${slug}`;
  return slug || 'service';
}
