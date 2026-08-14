import { z } from 'zod';

/** URL-safe slug used for projects, services, routes. */
export const slug = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits and hyphens');

/**
 * POSIX environment-variable name, as accepted by `docker run --env-file` and
 * shells: letters, digits and underscores, starting with a letter or
 * underscore. Surrounding whitespace is trimmed so sloppy input is normalized;
 * anything else (e.g. `MY VAR`) is rejected — such a key would otherwise break
 * the deploy at `docker run --env-file` time.
 */
export const envVarName = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'must be a valid environment variable name (letters, digits, underscore; cannot start with a digit)',
  );

export const id = z.number().int().positive();

/** Cursor-style pagination params. */
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.coerce.number().int().positive().optional(),
});
export type Pagination = z.infer<typeof pagination>;

/** Standard error envelope returned by the API. */
export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

/** A page of results. */
export function page<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.number().int().positive().nullable(),
    total: z.number().int().nonnegative().optional(),
  });
}
