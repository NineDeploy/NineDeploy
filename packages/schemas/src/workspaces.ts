import { z } from 'zod';
import { slug } from './common.js';

export const workspaceRoleEnum = z.enum(['owner', 'admin', 'member', 'viewer']);
export type WorkspaceRole = z.infer<typeof workspaceRoleEnum>;

export const workspaceCreate = z.object({
  name: z.string().trim().min(2).max(63),
  slug: slug.optional(),
  description: z.string().trim().max(500).optional(),
});
export type WorkspaceCreate = z.infer<typeof workspaceCreate>;
export type WorkspaceCreateInput = WorkspaceCreate;

export const workspaceUpdate = z
  .object({
    name: z.string().trim().min(2).max(63).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type WorkspaceUpdate = z.infer<typeof workspaceUpdate>;
export type WorkspaceUpdateInput = WorkspaceUpdate;

export const workspaceMemberAdd = z.object({
  email: z.string().email(),
  role: workspaceRoleEnum.default('member'),
});
export type WorkspaceMemberAdd = z.infer<typeof workspaceMemberAdd>;
export type WorkspaceMemberAddInput = WorkspaceMemberAdd;

export const workspaceMemberRoleUpdate = z.object({
  role: workspaceRoleEnum,
});
export type WorkspaceMemberRoleUpdate = z.infer<typeof workspaceMemberRoleUpdate>;
export type WorkspaceMemberRoleUpdateInput = WorkspaceMemberRoleUpdate;

export interface WorkspaceMemberEntry {
  id: number;
  workspaceId: number;
  userId: number;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceEntry {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  ownerId: number;
  myRole: WorkspaceRole;
  memberCount: number;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}
export type Workspace = WorkspaceEntry;

export interface WorkspaceDetail extends WorkspaceEntry {
  members: WorkspaceMemberEntry[];
}

// ─── OIDC & OAuth2 SSO Schemas ───────────────────────────────────────────────
export const oidcProviderCreate = z.object({
  name: z.string().trim().min(2).max(63),
  slug: slug,
  issuerUrl: z.string().url().nullable().optional(),
  clientId: z.string().trim().min(1).max(255),
  clientSecret: z.string().trim().min(1).max(500),
  scopes: z.string().trim().default('openid profile email'),
  enabled: z.boolean().default(true),
  autoEnroll: z.boolean().default(true),
  defaultRole: z.enum(['admin', 'member']).default('member'),
});
export type OidcProviderCreate = z.infer<typeof oidcProviderCreate>;
export type OidcProviderCreateInput = OidcProviderCreate;

export const oidcProviderUpdate = z
  .object({
    name: z.string().trim().min(2).max(63).optional(),
    issuerUrl: z.string().url().nullable().optional(),
    clientId: z.string().trim().min(1).max(255).optional(),
    clientSecret: z.string().trim().min(1).max(500).optional(),
    scopes: z.string().trim().optional(),
    enabled: z.boolean().optional(),
    autoEnroll: z.boolean().optional(),
    defaultRole: z.enum(['admin', 'member']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type OidcProviderUpdate = z.infer<typeof oidcProviderUpdate>;
export type OidcProviderUpdateInput = OidcProviderUpdate;

export interface OidcProviderEntry {
  id: number;
  name: string;
  slug: string;
  issuerUrl: string | null;
  clientId: string;
  scopes: string;
  enabled: boolean;
  autoEnroll: boolean;
  defaultRole: 'admin' | 'member';
  createdAt: string;
  updatedAt: string;
}

export interface OidcPublicProvider {
  id: number;
  name: string;
  slug: string;
  authUrl: string;
}
