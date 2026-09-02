/**
 * `ninedeploy email-templates` — G-30 transactional email
 * template engine.
 *
 * Every system email flows through `renderTemplate(name,
 * vars, ctx)`. The default template is a pure JS object
 * (`subject` + `text`); tenants can override the text
 * per-template-name via the `email_template_overrides`
 * table. A future PR can add an MJML/HTML renderer —
 * for now the text is plain Markdown with `${var}`
 * interpolation, which renders cleanly in the common
 * case and keeps the override path simple.
 *
 * Override precedence (highest first):
 *   1. Tenant override (by name) for the workspace
 *      attached to the email (when ctx.workspaceId is
 *      set).
 *   2. Built-in default.
 *
 * The renderer is intentionally side-effect free; the
 * caller hands the result to `sendSystemEmail` (which
 * already does the SMTP round-trip) or to the inline
 * auth.ts call site.
 */

import { and, eq } from 'drizzle-orm';
import { emailTemplateOverrides, type DB } from '@ninedeploy/db';

export type EmailTemplateName =
  | 'password-reset'
  | 'workspace-invitation'
  | 'domain-transfer'
  | 'backup-drill-failed';

export interface EmailTemplate {
  subject: string;
  text: string;
}

export interface RenderContext {
  /** Workspace whose override should be applied (when set). */
  workspaceId?: number | null;
  /** Locale the email should be rendered in. The
   *  override path is locale-agnostic in this PR; the
   *  variable is here so the future MJML/HTML pass can
   *  pick a translated template without a schema change. */
  locale?: string;
}

export interface RenderResult {
  subject: string;
  text: string;
  /** True when the result came from a tenant override. */
  overridden: boolean;
}

// ── defaults ───────────────────────────────────────────────────────────────

const DEFAULTS: Record<EmailTemplateName, EmailTemplate> = {
  'password-reset': {
    subject: 'Reset your NineDeploy password',
    text: [
      'A password reset was requested for {{email}}.',
      '',
      'Open this link within {{ttlMinutes}} minutes to set a new password:',
      '{{resetUrl}}',
      '',
      "If you did not request this, you can ignore this email.",
    ].join('\n'),
  },
  'workspace-invitation': {
    subject: "You're invited to join {{workspaceName}} on NineDeploy",
    text: [
      '{{inviter}} invited you to join the "{{workspaceName}}" workspace on NineDeploy as {{role}}.',
      '',
      'Click the link below to accept:',
      '{{acceptUrl}}',
      '',
      'This invitation expires in {{ttlDays}} days.',
      '',
      "If you don't have an account yet, you'll be asked to create one before accepting.",
    ].join('\n'),
  },
  'domain-transfer': {
    subject: 'Domain transfer for {{hostname}}',
    text: [
      '{{sourceName}} has offered to transfer the domain {{hostname}} to you.',
      '',
      'Click the link below to accept the transfer (link expires in {{ttlDays}} days):',
      '{{acceptUrl}}',
      '',
      "If you don't recognise the sender, you can ignore this email.",
    ].join('\n'),
  },
  'backup-drill-failed': {
    subject: '[{{severity}}] Backup drill failed for {{databaseName}}',
    text: [
      'A backup drill on database "{{databaseName}}" (backup #{{backupId}}) failed.',
      '',
      'Error: {{error}}',
      '',
      'Open the panel for the full drill log.',
    ].join('\n'),
  },
};

export const ALL_TEMPLATE_NAMES = Object.keys(DEFAULTS) as EmailTemplateName[];

// ── public surface ─────────────────────────────────────────────────────────

/**
 * Render a transactional email. The returned object is
 * plain text; callers feed `subject` + `text` to
 * `sendSystemEmail` (or to a custom transport).
 */
export async function renderTemplate(
  db: DB,
  name: EmailTemplateName,
  vars: Record<string, string | number | null | undefined>,
  ctx: RenderContext = {},
): Promise<RenderResult> {
  const base = DEFAULTS[name];
  if (!base) throw new Error(`Unknown email template: ${name}`);
  if (ctx.workspaceId != null) {
    // The override key is (workspace_id, name): look up the row for THIS
    // template name only. Filtering by workspace alone let one template's
    // override render in place of every other template's (the first matching
    // row won), and a workspace overriding a second template silently
    // replaced the built-in default for all the others.
    const override = await db.query.emailTemplateOverrides.findFirst({
      where: and(
        eq(emailTemplateOverrides.workspaceId, ctx.workspaceId),
        eq(emailTemplateOverrides.name, name),
      ),
    });
    // The override table is keyed by (workspace_id, name);
    // a single row per (workspace, name) pair.
    const matched = override?.subject && override?.text
      ? { subject: override.subject, text: override.text }
      : null;
    if (matched) {
      return {
        subject: expand(matched.subject, vars),
        text: expand(matched.text, vars),
        overridden: true,
      };
    }
  }
  return {
    subject: expand(base.subject, vars),
    text: expand(base.text, vars),
    overridden: false,
  };
}

/**
 * Persist / replace a tenant override. The override
 * exists at the (workspace, name) granularity. A
 * workspace has at most one row per template name; the
 * caller is expected to upsert via PUT.
 */
export async function setOverride(
  db: DB,
  workspaceId: number,
  name: EmailTemplateName,
  subject: string,
  text: string,
): Promise<void> {
  // INSERT-or-UPDATE in one statement: SQLite supports
  // `ON CONFLICT(workspace_id, name) DO UPDATE` cleanly.
  // Drizzle's .onConflictDoUpdate is the typed wrapper.
  await db
    .insert(emailTemplateOverrides)
    .values({ workspaceId, name, subject, text })
    .onConflictDoUpdate({
      target: [emailTemplateOverrides.workspaceId, emailTemplateOverrides.name],
      set: { subject, text, updatedAt: new Date() },
    });
}

/**
 * Drop a tenant override for ONE template name; the next render of that
 * template falls back to the built-in default. Overrides for the
 * workspace's other template names are untouched — the table is keyed by
 * (workspace_id, name), so the delete carries both halves of the key.
 */
export async function clearOverride(db: DB, workspaceId: number, name: EmailTemplateName): Promise<void> {
  await db
    .delete(emailTemplateOverrides)
    .where(
      and(eq(emailTemplateOverrides.workspaceId, workspaceId), eq(emailTemplateOverrides.name, name)),
    );
}

// ── interpolation ─────────────────────────────────────────────────────────

/**
 * `{{var}}` interpolation. Unknown vars render as the
 * empty string (not `undefined`); this matches the way
 * the legacy `buildInviteEmail` swallowed missing fields
 * and keeps a half-broken template from surfacing
 * `{{undefined}}` in an outbound email.
 *
 * Backslash escapes (`\{{`, `\}}`) are honored so a
 * template that needs a literal `{{` in its body can
 * write one. The escape is removed on render.
 */
function expand(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\\?\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, name) => {
    if (m.startsWith('\\')) return m.slice(1);
    const v = vars[name];
    return v == null ? '' : String(v);
  });
}
