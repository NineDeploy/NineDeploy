import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { SsoSection } from '../src/routes/settings/SsoSection.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  // Must be './apiMock.js', not './helpers.js' — see the note in apiMock.ts.
  const { createFakeApiModule } = await import('./apiMock.js');
  return createFakeApiModule();
});

describe('SsoSection', () => {
  const mockProviders = [
    {
      id: 1,
      name: 'Google Workspace',
      slug: 'google',
      issuerUrl: 'https://accounts.google.com',
      clientId: 'google-client-id',
      scopes: 'openid profile email',
      enabled: true,
      autoEnroll: true,
      defaultRole: 'member' as const,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockOf(api.auth.oidc.list).mockResolvedValue(mockProviders as never);
  });

  it('renders SSO providers list', async () => {
    renderWithProviders(<SsoSection />);

    await waitFor(() => {
      expect(screen.getByText('Single Sign-On (SSO & OIDC)')).toBeInTheDocument();
      expect(screen.getByText('Google Workspace')).toBeInTheDocument();
      expect(screen.getByText(/slug: google/)).toBeInTheDocument();
    });
  });

  it('adds an SSO provider via quick preset', async () => {
    mockOf(api.auth.oidc.create).mockResolvedValueOnce({
      id: 2,
      name: 'GitHub',
      slug: 'github',
      issuerUrl: null,
      clientId: 'gh-cid',
      scopes: 'read:user user:email',
      enabled: true,
      autoEnroll: true,
      defaultRole: 'member',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    } as never);

    renderWithProviders(<SsoSection />);

    await waitFor(() => {
      expect(screen.getByText('Google Workspace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('GitHub OAuth'));
    expect(screen.getByText('Configure SSO / OIDC Provider')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('OAuth Client ID'), {
      target: { value: 'gh-cid' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
      target: { value: 'gh-csec' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Provider' }));

    await waitFor(() => {
      expect(api.auth.oidc.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'GitHub',
          slug: 'github',
          clientId: 'gh-cid',
          clientSecret: 'gh-csec',
        }),
      );
    });
  });

  it('edits an SSO provider', async () => {
    mockOf(api.auth.oidc.update).mockResolvedValueOnce({
      ...mockProviders[0],
      name: 'Google Enterprise',
    } as never);

    renderWithProviders(<SsoSection />);

    await waitFor(() => {
      expect(screen.getByText('Google Workspace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByText('Edit Google Workspace')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Google Workspace'), {
      target: { value: 'Google Enterprise' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(api.auth.oidc.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          name: 'Google Enterprise',
        }),
      );
    });
  });

  it('deletes an SSO provider', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockOf(api.auth.oidc.delete).mockResolvedValueOnce({ ok: true } as never);

    renderWithProviders(<SsoSection />);

    await waitFor(() => {
      expect(screen.getByText('Google Workspace')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Delete Provider'));

    await waitFor(() => {
      expect(api.auth.oidc.delete).toHaveBeenCalledWith(1);
    });
  });
});
