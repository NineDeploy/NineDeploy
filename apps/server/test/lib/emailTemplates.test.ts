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
 *  - Overrides are keyed by (workspace_id, name): a workspace may
 *    override several templates at once (the unique index
 *    `email_template_overrides_workspace_name_idx` allows one row
 *    per name), and each render must use the row belonging to the
 *    REQUESTED template name — never a sibling template's row.
 *  - An unknown template name throws (defensive — the
 *    Zod-validated routes can never hit this branch, but the
 *    lib is also called from auth.ts / invitations code that
 *    passes a string literal).
 *  - `{{var}}` interpolation substitutes known vars, drops
 *    unknown ones to the empty string, and honors `\{{`
 *    escapes so a template that needs a literal `{{` can
 *    write one.
 *  - `setOverride` upserts the (workspace, name) row;
 *    `clearOverride` deletes only that (workspace, name) row —
 *    sibling template overrides survive.
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
import { createFakeDb, tableName } from '../helpers.js';

const state = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  deletes: [] as Array<Record<string, unknown>>,
  /** One row per (workspaceId, name) — mirrors the table's unique key. */
  overrides: [] as Array<{ workspaceId: number; name: string; subject: string; text: string }>,
}));

beforeEach(() => {
  state.inserts.length = 0;
  state.deletes.length = 0;
  state.overrides.length = 0;
});

/** Convenience: seed one override row. */
function seedOverride(workspaceId: number, name: EmailTemplateName, subject: string, text: string): void {
  state.overrides.push({ workspaceId, name, subject, text });
}

/**
 * Extract column → bound-value pairs from a drizzle where predicate built
 * from `eq(col, value)` and `and(...)` combinations.
 *
 * Drizzle represents `eq(col, v)` as SQL with queryChunks
 * `[Column, StringChunk(' = '), Param]`, and `and(a, b)` as SQL whose
 * chunks recurse into the operand SQLs. A depth-first walk keeps each
 * Column adjacent to its Param, so pairs can be associated positionally.
 * This makes the fake EXECUTE the predicate the production code
 * constructs — including the `name` half of the (workspace_id, name) key —
 * instead of guessing it.
 */
function whereEquals(where: unknown): Record<string, unknown> {
  const pairs: Record<string, unknown> = {};
  let pendingColumn: string | null = null;
  const walk = (node: unknown): void => {
    if (node == null || typeof node !== 'object') return;
    const n = node as { queryChunks?: unknown[]; name?: unknown; value?: unknown; encoder?: unknown };
    if (Array.isArray(n.queryChunks)) {
      for (const chunk of n.queryChunks) walk(chunk);
      return;
    }
    // drizzle Column: carries `.name`, never `.value`.
    if (typeof n.name === 'string' && !('value' in n)) {
      pendingColumn = n.name;
      return;
    }
    // drizzle Param: `.value` + `.encoder`. (StringChunk also has `.value`
    // — it is the ' = ' operator fragment and must NOT be taken as the
    // bound value — but it has no `encoder`.)
    if ('value' in n && 'encoder' in n && typeof pendingColumn === 'string') {
      pairs[pendingColumn] = n.value;
      pendingColumn = null;
    }
  };
  walk(where);
  return pairs;
}

function makeDb() {
  const db = createFakeDb({
    findFirst: {
      // `findFirst(emailTemplateOverrides)` runs the predicate the helper
      // built. The fake evaluates it against the fixture rows the way SQL
      // would: workspace must match, and — when the predicate constrains it —
      // the template name too. First matching row wins (rowid order).
      emailTemplateOverrides: (args: unknown) => {
        const where = (args as { where?: unknown } | undefined)?.where;
        if (where === undefined) return undefined;
        const eq = whereEquals(where);
        const wid = eq['workspace_id'];
        if (typeof wid !== 'number') return undefined;
        const name = eq['name'];
        const row = state.overrides.find(
          (r) => r.workspaceId === wid && (name === undefined || r.name === name),
        );
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

  // Make DELETE behavioral: apply the predicate against the fixture rows so
  // clearOverride's where clause is exercised (the stock fake ignores it and
  // its delete resolver receives no predicate at all).
  const dbish = db as unknown as {
    delete: (table: unknown) => { where: (p: unknown) => unknown };
  };
  const originalDelete = dbish.delete.bind(db);
  dbish.delete = (table: unknown) => {
    const builder = originalDelete(table);
    if (tableName(table) !== 'email_template_overrides') return builder;
    return {
      where: (p: unknown) => {
        const eq = whereEquals(p);
        const wid = eq['workspace_id'];
        const name = eq['name'];
        state.overrides = state.overrides.filter(
          (r) => !(r.workspaceId === wid && (name === undefined || r.name === name)),
        );
        return builder.where(p);
      },
    };
  };
  return db;
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
    seedOverride(42, 'password-reset', 'Custom subject for {{email}}', 'Hi {{email}}, your reset link is {{resetUrl}}');
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
    seedOverride(42, 'password-reset', 'only-subj', '');
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
    seedOverride(42, 'password-reset', 'X', 'Y');
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

describe('renderTemplate — (workspace_id, name) override key', () => {
  it('renders each template with ITS OWN override row when a workspace overrides several', async () => {
    // Invitation seeded FIRST (it would win any name-blind lookup),
    // password-reset second — the exact shape that used to contaminate.
    seedOverride(42, 'workspace-invitation', 'INVITE-SUBJ {{workspaceName}}', 'INVITE-TEXT {{acceptUrl}}');
    seedOverride(42, 'password-reset', 'RESET-SUBJ {{email}}', 'RESET-TEXT {{resetUrl}}');
    const db = makeDb();

    const reset = await renderTemplate(
      db,
      'password-reset',
      { email: 'a@b.com', ttlMinutes: 15, resetUrl: 'https://reset.example' },
      { workspaceId: 42 },
    );
    expect(reset.overridden).toBe(true);
    expect(reset.subject).toBe('RESET-SUBJ a@b.com');
    expect(reset.text).toBe('RESET-TEXT https://reset.example');

    const invite = await renderTemplate(
      db,
      'workspace-invitation',
      { inviter: 'Eve', workspaceName: 'Acme', role: 'admin', acceptUrl: 'https://invite.example', ttlDays: 7 },
      { workspaceId: 42 },
    );
    expect(invite.overridden).toBe(true);
    expect(invite.subject).toBe('INVITE-SUBJ Acme');
    expect(invite.text).toBe('INVITE-TEXT https://invite.example');
  });

  it('falls back to the default when the REQUESTED name has no override but other names do', async () => {
    seedOverride(43, 'workspace-invitation', 'INVITE-SUBJ', 'INVITE-TEXT');
    const db = makeDb();
    const result = await renderTemplate(
      db,
      'password-reset',
      { email: 'a@b.com', ttlMinutes: 15, resetUrl: 'https://x/y' },
      { workspaceId: 43 },
    );
    expect(result.overridden).toBe(false);
    expect(result.subject).toBe('Reset your NineDeploy password');
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
    seedOverride(42, 'domain-transfer', `literal ${esc} x }}`, `${esc} not interpolated }}: {{hostname}}`);
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
    seedOverride(42, 'domain-transfer', '{{n}} — {{maybe}}', 'n={{n}} maybe={{maybe}}');
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
    seedOverride(42, 'password-reset', '{{   email   }}', 'x');
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

  it('clearOverride deletes only the named (workspace, name) row', async () => {
    seedOverride(42, 'workspace-invitation', 'INVITE', 'TEXT');
    seedOverride(42, 'password-reset', 'RESET', 'TEXT');
    const db = makeDb();
    await clearOverride(db, 42, 'password-reset');
    // Exactly one delete was issued…
    expect(state.deletes).toHaveLength(1);
    // …and it removed ONLY the named row; the sibling override survives.
    expect(state.overrides.map((r) => ({ workspaceId: r.workspaceId, name: r.name }))).toEqual([
      { workspaceId: 42, name: 'workspace-invitation' },
    ]);
  });

  it('clearOverride is a no-op for a name the workspace never overrode', async () => {
    seedOverride(42, 'workspace-invitation', 'INVITE', 'TEXT');
    const db = makeDb();
    await clearOverride(db, 42, 'backup-drill-failed');
    expect(state.overrides).toHaveLength(1);
    expect(state.overrides[0]!.name).toBe('workspace-invitation');
  });

  it('setOverride then renderTemplate picks up the override', async () => {
    const db = makeDb();
    await setOverride(db, 42, 'password-reset', 'NEW subj', 'NEW text body');
    // Mirror what the upsert would have done in the real DB.
    seedOverride(42, 'password-reset', 'NEW subj', 'NEW text body');
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
