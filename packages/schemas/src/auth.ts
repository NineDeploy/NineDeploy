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
  /** Required when the account has 2FA enabled. */
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
export type Login = z.infer<typeof login>;

/** Verifying a two-factor action (enable / disable companion). */
export const twoFactorCode = z.object({ code: z.string().regex(/^\d{6}$/) });
export type TwoFactorCode = z.infer<typeof twoFactorCode>;

/** Regenerating the 2FA secret: password required when 2FA is already enabled. */
export const twoFactorSetup = z.object({ password: z.string().min(1) });
export type TwoFactorSetup = z.infer<typeof twoFactorSetup>;

export const twoFactorDisable = z.object({
  password: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
export type TwoFactorDisable = z.infer<typeof twoFactorDisable>;

/** Self-service password change: requires the current password. */
export const passwordChange = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export type PasswordChange = z.infer<typeof passwordChange>;

/** Admin-initiated password reset for another user. */
/**
 * Admin-created user — same shape as register, no global role.
 * A new user has no workspace memberships until an existing owner/admin
 * invites them; the first user on a fresh install is auto-promoted to owner
 * of a personal workspace by the auth module.
 */
export const userCreate = z.object({
  email: z.email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
});
export type UserCreate = z.infer<typeof userCreate>;

export const passwordReset = z.object({
  newPassword: z.string().min(8).max(128),
});
export type PasswordReset = z.infer<typeof passwordReset>;

/** Forgot-password request. Always answers 200 (no user enumeration). */
export const forgotPassword = z.object({
  email: z.email(),
});
export type ForgotPassword = z.infer<typeof forgotPassword>;

/** Complete a reset with the token from the email / admin-issued link. */
export const passwordResetWithToken = z.object({
  token: z.string().min(20).max(128),
  newPassword: z.string().min(8).max(128),
});
export type PasswordResetWithToken = z.infer<typeof passwordResetWithToken>;

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

/**
 * Public user representation (never includes passwordHash).
 * The legacy global `role` field was removed; authorization is per-workspace
 * now. The effective "is operator" check is computed by joining
 * `workspace_members` and asking whether the user holds owner/admin in any
 * workspace.
 */
export const publicUser = z.object({
  id: z.number().int(),
  email: z.email(),
  name: z.string().nullable(),
  /** True iff the user holds owner/admin in at least one workspace. */
  isOperator: z.boolean(),
  /** Number of workspaces the user belongs to. Computed by the server. */
  workspaceCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
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

// ── passkeys (WebAuthn) ────────────────────────────────────────────────────
/** Registration verification: label for the new credential + the browser's response payload. */
export const passkeyRegisterVerify = z.object({
  name: z.string().min(1).max(100),
  response: z.record(z.string(), z.unknown()),
});
export type PasskeyRegisterVerify = z.infer<typeof passkeyRegisterVerify>;

/** Login verification: just the browser's authentication response (discoverable credentials). */
export const passkeyLoginVerify = z.object({
  response: z.record(z.string(), z.unknown()),
});
export type PasskeyLoginVerify = z.infer<typeof passkeyLoginVerify>;

export const passkeyCredential = z.object({
  id: z.number().int(),
  name: z.string(),
  createdAt: z.string().datetime(),
});
export type PasskeyCredential = z.infer<typeof passkeyCredential>;

// ── sessions (refresh-token backing store) ─────────────────────────────────
export const activeSession = z.object({
  id: z.number().int(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  current: z.boolean(),
});
export type ActiveSession = z.infer<typeof activeSession>;

