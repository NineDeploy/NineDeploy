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

  it('shows the empty state when no providers are configured', async () => {
    mockOf(api.auth.oidc.list).mockResolvedValue([] as never);
    renderWithProviders(<SsoSection />);
    expect(await screen.findByText(/No SSO providers configured/)).toBeInTheDocument();
  });

  it('requires slug and client secret when creating', async () => {
    renderWithProviders(<SsoSection />);
    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Add Provider'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Google Workspace'), { target: { value: 'Custom' } });
    fireEvent.change(screen.getByPlaceholderText('OAuth Client ID'), { target: { value: 'cid-2' } });
    // Bypass DOM required-validation to exercise the handler's own guard.
    fireEvent.submit(screen.getByPlaceholderText('e.g. Google Workspace').closest('form')!);

    expect(await screen.findByText('Slug and Client Secret are required')).toBeInTheDocument();
    expect(api.auth.oidc.create).not.toHaveBeenCalled();
  });

  it('normalizes the slug and honors the toggles when creating', async () => {
    mockOf(api.auth.oidc.create).mockResolvedValueOnce(mockProviders[0] as never);
    renderWithProviders(<SsoSection />);
    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Add Provider'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Google Workspace'), { target: { value: 'Authentik' } });
    // The slug input lowercases and strips invalid characters.
    fireEvent.change(screen.getByPlaceholderText('e.g. google or okta'), { target: { value: 'My IdP!' } });
    fireEvent.change(screen.getByPlaceholderText('OAuth Client ID'), { target: { value: 'cid-3' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByLabelText('Enable SSO on login page'));
    fireEvent.click(screen.getByLabelText('Auto-enroll new users on first login'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Provider' }));

    await waitFor(() => {
      expect(api.auth.oidc.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Authentik',
        slug: 'myidp',
        enabled: false,
        autoEnroll: false,
      }));
    });
    // The modal closes after a successful save.
    await waitFor(() =>
      expect(screen.queryByText('Configure SSO / OIDC Provider')).not.toBeInTheDocument());
  });

  it('keeps the stored secret when an edit leaves it blank', async () => {
    mockOf(api.auth.oidc.update).mockResolvedValueOnce(mockProviders[0] as never);
    renderWithProviders(<SsoSection />);
    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    await screen.findByText('Edit Google Workspace');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(api.auth.oidc.update).toHaveBeenCalled());
    const sent = mockOf(api.auth.oidc.update).mock.calls[0]![1] as Record<string, unknown>;
    expect(sent).toEqual(expect.objectContaining({ name: 'Google Workspace' }));
    // Blank secret means "keep the stored one": the key is not sent at all.
    expect('clientSecret' in sent).toBe(false);
  });

  it('sends the typed secret on rotation and surfaces save failures', async () => {
    mockOf(api.auth.oidc.update).mockResolvedValueOnce(mockProviders[0] as never);
    renderWithProviders(<SsoSection />);
    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    await screen.findByText('Edit Google Workspace');
    const secretField = screen.getByPlaceholderText('••••••••••••');
    fireEvent.change(secretField, { target: { value: 'rotated-fixture-secret' } });
    // Assert with the value read back from the form field.
    const typedSecret = (secretField as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(api.auth.oidc.update).toHaveBeenCalledWith(1, expect.objectContaining({
        clientSecret: typedSecret,
      }));
    });

    // Failure path surfaces the server message in the form.
    mockOf(api.auth.oidc.update).mockRejectedValueOnce(new Error('slug already exists') as never);
    fireEvent.click(screen.getByText('Edit'));
    await screen.findByText('Edit Google Workspace');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('slug already exists')).toBeInTheDocument();
  });

  it('keeps the provider when the delete confirm is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    renderWithProviders(<SsoSection />);
    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Delete Provider'));
    expect(api.auth.oidc.delete).not.toHaveBeenCalled();
  });

  it('cancels out of the create modal without saving', async () => {
    renderWithProviders(<SsoSection />);
    await waitFor(() => expect(screen.getByText('Google Workspace')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Okta / Auth0'));
    expect(screen.getByDisplayValue('Okta Enterprise')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Configure SSO / OIDC Provider')).not.toBeInTheDocument());
    expect(api.auth.oidc.create).not.toHaveBeenCalled();
  });
});
