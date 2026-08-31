/**
 * G-30 transactional email template engine — lib coverage.
 *
 * `emailTemplates.ts` is the engine behind the
 * `email-templates {list, get, set, reset, preview}` HTTP
 * routes. The behavior worth pinning down:
 *  - `renderTemplate` returns the built-in default when no
 *    override exists, or the tenant override (flagged with
 *    `overridden: true`) when one does. An override row that
 *    lacks `subject` or `text` is treated as absent — the
 *    default is rendered instead.
 *  - An unknown template name throws (defensive — the
 *    Zod-validated routes can never hit this branch, but the
 *    lib is also called from auth.ts / invitations code that
 *    passes a string literal).
 *  - `{{var}}` interpolation substitutes known vars, drops
 *    unknown ones to the empty string, and honors `\{{`
 *    escapes so a template that needs a literal `{{` can
 *    write one.
 *  - `setOverride` upserts the (workspace, name) row;
 *    `clearOverride` deletes every override for the
 *    workspace (per the existing helper contract).
 *  - `ALL_TEMPLATE_NAMES` lists the four built-ins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_TEMPLATE_NAMES,
  type EmailTemplateName,
  clearOverride,
  renderTemplate,
  setOverride,
} from '../../src/lib/emailTemplates.js';
import { createFakeDb } from '../helpers.js';

const state = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  deletes: [] as Array<Record<string, unknown>>,
  /** workspaceId → { subject, text } */
  overrides: new Map<number, { subject: string; text: string }>(),
}));

beforeEach(() => {
  state.inserts.length = 0;
  state.deletes.length = 0;
  state.overrides.clear();
});

function makeDb() {
  return createFakeDb({
    findFirst: {
      // `findFirst(emailTemplateOverrides)` filters by `workspaceId` via
      // `eq(emailTemplateOverrides.workspaceId, id)`. The fake reads the
      // bound `value` from `queryChunks`.
      emailTemplateOverrides: (args: unknown) => {
        const chunks = (args as { where?: { queryChunks?: unknown[] } } | undefined)?.where?.queryChunks;
        if (!Array.isArray(chunks)) return undefined;
        let wid: number | null = null;
        for (const c of chunks) {
          const v = (c as { value?: unknown } | null)?.value;
          if (typeof v === 'number') {
            wid = v;
            break;
          }
        }
        if (wid == null) return undefined;
        const row = state.overrides.get(wid);
        return row ? { subject: row.subject, text: row.text } : undefined;
      },
    },
    insert: {
      // Cover both the camelCase JS identifier and the SQL snake_case
      // form — the drizzle table-name resolution can pick either
      // depending on the symbol used.
      emailTemplateOverrides: (v: Record<string, unknown>) => {
        state.inserts.push(v);
        return [v];
      },
      email_template_overrides: (v: Record<string, unknown>) => {
        state.inserts.push(v);
        return [v];
      },
    },
    delete: {
      emailTemplateOverrides: (set: Record<string, unknown>) => {
        state.deletes.push(set);
        return [set];
      },
      email_template_overrides: (set: Record<string, unknown>) => {
        state.deletes.push(set);
        return [set];
      },
    },
  });
}

describe('ALL_TEMPLATE_NAMES', () => {
  it('lists the four built-in template names', () => {
    expect(ALL_TEMPLATE_NAMES).toEqual([
      'password-reset',
      'workspace-invitation',
      'domain-transfer',
      'backup-drill-failed',
    ]);
  });
});

describe('renderTemplate', () => {
  it('returns the built-in default when no override is set', async () => {
    const db = makeDb();
    const result = await renderTemplate(
      db,
      'password-reset',
      { email: 'a@b.com', ttlMinutes: 15, resetUrl: 'https://x/y' },
    );
    expect(result.overridden).toBe(false);
    expect(result.subject).toBe('Reset your NineDeploy password');
    expect(result.text).toContain('A password reset was requested for a@b.com.');
    expect(result.text).toContain('Open this link within 15 minutes');
    expect(result.text).toContain('https://x/y');
  });

  it('returns the tenant override when one exists', async () => {
    state.overrides.set(42, {
      subject: 'Custom subject for {{email}}',
      text: 'Hi {{email}}, your reset link is {{resetUrl}}',
    });
    const db = makeDb();
    const result = await renderTemplate(
      db,
      'password-reset',
      { email: 'a@b.com', ttlMinutes: 15, resetUrl: 'https://x/y' },
      { workspaceId: 42 },
    );
    expect(result.overridden).toBe(true);
    expect(result.subject).toBe('Custom subject for a@b.com');
    expect(result.text).toBe('Hi a@b.com, your reset link is https://x/y');
  });

  it('falls back to the default when the override row has no text', async () => {
    state.overrides.set(42, { subject: 'only-subj', text: '' });
    const db = makeDb();
    const result = await renderTemplate(
      db,
      'password-reset',
      { email: 'a@b.com', ttlMinutes: 15, resetUrl: 'https://x/y' },
      { workspaceId: 42 },
    );
    expect(result.overridden).toBe(false);
    expect(result.subject).toBe('Reset your NineDeploy password');
  });

  it('skips the override lookup entirely when ctx.workspaceId is null', async () => {
    state.overrides.set(42, { subject: 'X', text: 'Y' });
    const db = makeDb();
    const result = await renderTemplate(
      db,
      'password-reset',
      { email: 'a@b.com', ttlMinutes: 15, resetUrl: 'https://x/y' },
      { workspaceId: null },
    );
    expect(result.overridden).toBe(false);
    expect(result.subject).toBe('Reset your NineDeploy password');
  });

  it('skips the override lookup when ctx is omitted', async () => {
    const db = makeDb();
    const result = await renderTemplate(db, 'workspace-invitation', {
      inviter: 'Eve',
      workspaceName: 'MyWS',
      role: 'admin',
      acceptUrl: 'https://x/y',
      ttlDays: 7,
    });
    expect(result.overridden).toBe(false);
    expect(result.subject).toBe("You're invited to join MyWS on NineDeploy");
    expect(result.text).toContain('Eve invited you to join the "MyWS" workspace');
    expect(result.text).toContain('This invitation expires in 7 days.');
  });

  it('throws for an unknown template name', async () => {
    const db = makeDb();
    await expect(
      renderTemplate(db, 'unknown' as unknown as Parameters<typeof renderTemplate>[1], {}),
    ).rejects.toThrow(/Unknown email template/);
  });

  it('renders the domain-transfer template', async () => {
    const db = makeDb();
    const result = await renderTemplate(db, 'domain-transfer', {
      sourceName: 'Alice',
      hostname: 'example.com',
      ttlDays: 5,
      acceptUrl: 'https://x/y',
    });
    expect(result.subject).toBe('Domain transfer for example.com');
    expect(result.text).toContain('Alice has offered to transfer the domain example.com to you.');
    expect(result.text).toContain('link expires in 5 days');
  });

  it('renders the backup-drill-failed template with severity', async () => {
    const db = makeDb();
    const result = await renderTemplate(db, 'backup-drill-failed', {
      severity: 'critical',
      databaseName: 'orders',
      backupId: 99,
      error: 'pg_restore failed',
    });
    expect(result.subject).toBe('[critical] Backup drill failed for orders');
    expect(result.text).toContain('A backup drill on database "orders" (backup #99) failed.');
    expect(result.text).toContain('Error: pg_restore failed');
  });
});

describe('renderTemplate — interpolation', () => {
  it('substitutes known vars and drops unknown ones to empty string', async () => {
    const db = makeDb();
    const result = await renderTemplate(db, 'domain-transfer', {
      sourceName: 'Alice',
      hostname: 'example.com',
      acceptUrl: 'https://x/y',
      // ttlDays intentionally omitted
    });
    // The default template contains `{{ttlDays}}`; the renderer drops
    // unknown vars to the empty string (per the design comment).
    expect(result.text).toContain('link expires in  days');
  });

  it('honors \\{{ escape so a literal {{ can be written', async () => {
    // Build the input via String.raw to avoid the TS source-escape
    // round-trip; the template is literally `literal \{{ x }}`.
    const esc = String.raw`\{{`;
    state.overrides.set(42, {
      subject: `literal ${esc} x }}`,
      text: `${esc} not interpolated }}: {{hostname}}`,
    });
    const db = makeDb();
    const result = await renderTemplate(
      db,
      'domain-transfer',
      { hostname: 'example.com' },
      { workspaceId: 42 },
    );
    // The escape is removed and the literal `{{ x }}` survives;
    // `{{hostname}}` is interpolated normally. The intermediate
    // `interpolated }}` is outside any `{{ }}` block and is left alone.
    expect(result.subject).toBe('literal {{ x }}');
    expect(result.text).toContain('{{ not interpolated }}');
    expect(result.text).toContain(': example.com');
  });

  it('tolerates numeric and null vars in the substitution', async () => {
    state.overrides.set(42, {
      subject: '{{n}} — {{maybe}}',
      text: 'n={{n}} maybe={{maybe}}',
    });
    const db = makeDb();
    const result = await renderTemplate(
      db,
      'domain-transfer',
      { n: 42, maybe: null },
      { workspaceId: 42 },
    );
    expect(result.subject).toBe('42 — ');
    expect(result.text).toBe('n=42 maybe=');
  });

  it('accepts whitespace inside the {{ }} delimiters', async () => {
    state.overrides.set(42, {
      subject: '{{   email   }}',
      text: 'x',
    });
    const db = makeDb();
    const result = await renderTemplate(
      db,
      'password-reset',
      { email: 'a@b.com' },
      { workspaceId: 42 },
    );
    expect(result.subject).toBe('a@b.com');
  });
});

describe('setOverride / clearOverride', () => {
  it('setOverride inserts (workspaceId, name, subject, text) via the upsert path', async () => {
    const db = makeDb();
    await setOverride(db, 42, 'password-reset', 'S', 'T');
    expect(state.inserts).toEqual([
      { workspaceId: 42, name: 'password-reset', subject: 'S', text: 'T' },
    ]);
  });

  it('clearOverride issues a delete for the workspace', async () => {
    const db = makeDb();
    await clearOverride(db, 42, 'password-reset');
    // The helper deletes every override for the workspace; we assert
    // the call was made against the right table. The fake db does not
    // pass any payload to the delete resolver, so the entry is undefined.
    expect(state.deletes).toHaveLength(1);
  });

  it('setOverride then renderTemplate picks up the override', async () => {
    const db = makeDb();
    await setOverride(db, 42, 'password-reset', 'NEW subj', 'NEW text body');
    // Mirror what the upsert would have done in the real DB.
    state.overrides.set(42, { subject: 'NEW subj', text: 'NEW text body' });
    const result = await renderTemplate(
      db,
      'password-reset',
      { email: 'a@b.com', ttlMinutes: 15, resetUrl: 'https://x/y' },
      { workspaceId: 42 },
    );
    expect(result.overridden).toBe(true);
    expect(result.subject).toBe('NEW subj');
    expect(result.text).toBe('NEW text body');
  });

  it('accepts every name in ALL_TEMPLATE_NAMES', async () => {
    const db = makeDb();
    for (const name of ALL_TEMPLATE_NAMES) {
      await setOverride(db, 42, name as EmailTemplateName, 'S', 'T');
    }
    expect(state.inserts).toHaveLength(ALL_TEMPLATE_NAMES.length);
  });
});
