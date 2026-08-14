import { z } from 'zod';

export const register = z.object({
  email: z.email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
});
export type Register = z.infer<typeof register>;

/** Initial bootstrap — same shape as register, only works when no users exist. */
export const setup = register;
export type Setup = Register;

export const login = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type Login = z.infer<typeof login>;

/** Self-service password change: requires the current password. */
export const passwordChange = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type PasswordChange = z.infer<typeof passwordChange>;

/** Admin-initiated password reset for another user. */
export const passwordReset = z.object({
  newPassword: z.string().min(8).max(128),
});
export type PasswordReset = z.infer<typeof passwordReset>;

/** Tokens issued after a successful login/refresh. */
export const tokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPair>;

export const refresh = z.object({
  refreshToken: z.string().min(1),
});
export type Refresh = z.infer<typeof refresh>;

/** Public user representation (never includes passwordHash). */
export const publicUser = z.object({
  id: z.number().int(),
  email: z.email(),
  name: z.string().nullable(),
  role: z.enum(['admin', 'member']),
});
export type PublicUser = z.infer<typeof publicUser>;

export const session = z.object({
  user: publicUser,
  tokens: tokenPair,
});
export type Session = z.infer<typeof session>;

// ── API tokens (for the CLI / CI) ─────────────────────────────────────────
export const createApiToken = z.object({
  name: z.string().min(1).max(100).optional(),
});
export type CreateApiToken = z.infer<typeof createApiToken>;

export const apiToken = z.object({
  id: z.number().int(),
  name: z.string(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ApiToken = z.infer<typeof apiToken>;

/** Returned once at creation time — the raw token is never retrievable again. */
export const createdApiToken = z.object({
  id: z.number().int(),
  name: z.string(),
  token: z.string(),
  createdAt: z.string().datetime(),
});
export type CreatedApiToken = z.infer<typeof createdApiToken>;
