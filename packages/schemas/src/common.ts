import { z } from 'zod';

/** URL-safe slug used for projects, services, routes. */
export const slug = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits and hyphens');

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
