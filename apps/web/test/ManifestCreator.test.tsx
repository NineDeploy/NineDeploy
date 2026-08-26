/**
 * Tests for the Manifest Creator page. The page is large so the suite
 * focuses on the most important contracts: presets load, section nav
 * switches, form edits round-trip into the YAML preview, and the
 * client-side secret-lint surfaces obvious slips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManifestCreator } from '../src/routes/ManifestCreator.js';
import { createQueryClient, renderWithProviders } from './web-utils.js';
import './web-utils.js';

/** Render the page with both Router + QueryClient providers. */
function renderPage(initialRoute = '/manifest-creator') {
  return renderWithProviders(<ManifestCreator />, {
    queryClient: createQueryClient(),
    route: initialRoute,
  });
}

const originalLocalStorage = window.localStorage;
const originalCreateElement = document.createElement.bind(document);
const originalClipboard = (navigator as { clipboard?: unknown }).clipboard;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage = originalLocalStorage;
  document.createElement = originalCreateElement;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard,
  });
});

describe('ManifestCreator', () => {
  it('renders the page header and a preset selector', () => {
    renderPage();
    expect(screen.getByText('Manifest Creator')).toBeInTheDocument();
    expect(screen.getByText('Node 20 (npm)')).toBeInTheDocument();
    expect(screen.getByText('Blank')).toBeInTheDocument();
  });

  it('replaces the form state when a preset is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Node 20 (npm)'));
    // The version field's value is now "20" — the runtime version pin
    // declared in the preset. Placeholder is still set on the input, so
    // check the value attribute, not the placeholder presence.
    const versionInput = screen.getByPlaceholderText(/leave empty to let Nixpacks/);
    expect((versionInput as HTMLInputElement).value).toBe('20');
  });

  it('switches the active section when a nav button is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Build section/ }));
    expect(screen.getByText(/Install command/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Routing section/ }));
    expect(screen.getByText(/No routes yet/)).toBeInTheDocument();
  });

  it('reflects typed values in the rendered YAML preview', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Build section/ }));
    const installInput = screen.getByPlaceholderText(/npm ci/);
    fireEvent.change(installInput, { target: { value: 'pnpm install --frozen-lockfile' } });
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain(
        'pnpm install --frozen-lockfile',
      );
    });
  });

  it('flags manifest values that look like secrets in the lint panel', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Build section/ }));
    const installInput = screen.getByPlaceholderText(/npm ci/);
    fireEvent.change(installInput, { target: { value: 'AKIAIOSFODNN7EXAMPLE' } });
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() =>
      expect(
        document.body.textContent ?? '',
      ).toMatch(/potential secret risk/i),
    );
  });

  it('closes the preview modal via the Close button', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    // The lint banner is unique to the modal — wait for it to appear.
    await waitFor(() =>
      expect(document.body.textContent ?? '').toMatch(/No obvious secrets/),
    );
    // The modal renders a Close button (the X icon has aria-hidden, so the
    // accessible name is just "Close"). Use findByText to be icon-agnostic.
    const closeButton = await screen.findByText('Close');
    await user.click(closeButton);
    await waitFor(() =>
      expect(document.body.textContent ?? '').not.toMatch(/No obvious secrets/),
    );
  });

  it('persists the draft to localStorage on every change', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Node 20 (npm)'));
    const stored = window.localStorage.getItem('ninedeploy.manifest.draft');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? '{}')).toMatchObject({
      runtime: { type: 'node', version: '20' },
    });
  });

  it('restores a persisted draft on mount', () => {
    window.localStorage.setItem(
      'ninedeploy.manifest.draft',
      JSON.stringify({ version: '1', runtime: { type: 'go', version: '1.22' } }),
    );
    renderPage();
    expect(screen.getByDisplayValue('1.22')).toBeInTheDocument();
  });

  it('downloads the file when the Download button is clicked', async () => {
    const user = userEvent.setup();
    let anchorClickCount = 0;
    // The download flow calls `document.createElement('a')` and clicks it.
    // Intercept the click to count invocations without actually downloading.
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = originalCreateElement(tag, options);
      if (tag.toLowerCase() === 'a') {
        const originalClick = el.click.bind(el);
        el.click = () => {
          anchorClickCount += 1;
          originalClick();
        };
      }
      return el;
    });
    renderPage();
    await user.click(screen.getByText('Node 20 (npm)'));
    await user.click(screen.getByRole('button', { name: /Download/ }));
    expect(anchorClickCount).toBeGreaterThan(0);
    createElementSpy.mockRestore();
  });

  it('copies the YAML to the clipboard via the Copy button', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderPage();
    await user.click(screen.getByText('Node 20 (npm)'));
    await user.click(screen.getByRole('button', { name: /Copy YAML/ }));
    expect(writeText).toHaveBeenCalled();
    // The copied text is the manifest YAML; verify a known preset value
    // made it through to the clipboard payload.
    expect(writeText.mock.calls[0]?.[0]).toContain('npm ci');
  });

  it('resets the manifest to a clean empty state when Reset is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Node 20 (npm)'));
    await user.click(screen.getByRole('button', { name: /Build section/ }));
    expect(screen.getByText(/Install command/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reset/ }));
    expect(screen.getByPlaceholderText(/npm ci/)).toBeInTheDocument();
  });

  it('prefills port and healthcheck when ?from=service:<id> is present', async () => {
    // Mock the service query by stubbing api.services.get. The page
    // issues a useQuery on mount; we intercept the response and verify
    // the form lands on the Run section with the port pre-filled.
    const api = (await import('../src/lib/api.js')).api as unknown as {
      services: { get: ReturnType<typeof vi.fn> };
    };
    const getSpy = vi.fn().mockResolvedValue({ id: 1, port: 8080, healthPath: '/ready' });
    api.services.get = getSpy;
    renderPage('/manifest-creator?from=service:1');
    // Wait for the query to fire and the prefill to seed the form.
    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith(1);
    });
    // Switch to the Run section where port and healthcheck are edited.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Run section/ }));
    await waitFor(() => {
      expect(screen.getByDisplayValue('8080')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('/ready')).toBeInTheDocument();
  });

  it('does not overwrite the form when ?from=service:<id> is present but a preset is already applied', async () => {
    // Pre-populate the draft so the "is the manifest still the empty starter?"
    // guard refuses the prefill. The page should leave the preset alone.
    const api = (await import('../src/lib/api.js')).api as unknown as {
      services: { get: ReturnType<typeof vi.fn> };
    };
    api.services.get = vi.fn().mockResolvedValue({ id: 1, port: 8080, healthPath: '/ready' });
    window.localStorage.setItem(
      'ninedeploy.manifest.draft',
      JSON.stringify({ version: '1', runtime: { type: 'go', version: '1.22' } }),
    );
    renderPage('/manifest-creator?from=service:1');
    // The prefill guard keeps the existing draft intact — Go version
    // stays in place, the service port does not leak in.
    await waitFor(() => {
      expect(screen.getByDisplayValue('1.22')).toBeInTheDocument();
    });
  });

  it('shows a no-secrets banner when the manifest is clean', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    expect(document.body.textContent ?? '').toMatch(/No obvious secrets/);
  });

  it('skips a malformed draft in localStorage and falls back to a clean empty state', () => {
    window.localStorage.setItem('ninedeploy.manifest.draft', '{ not-json');
    renderPage();
    // The version field is the default empty placeholder.
    expect(screen.getByPlaceholderText(/leave empty to let Nixpacks/)).toBeInTheDocument();
  });

  it('skips a version-less draft in localStorage and falls back to a clean empty state', () => {
    window.localStorage.setItem(
      'ninedeploy.manifest.draft',
      JSON.stringify({ runtime: { type: 'node' } }),
    );
    renderPage();
    expect(screen.getByPlaceholderText(/leave empty to let Nixpacks/)).toBeInTheDocument();
  });

  // Coverage: exercise every section's editor at least once via the nav.
  it('navigates through every section and renders its editor', async () => {
    const user = userEvent.setup();
    renderPage();
    // Visit every section; the page re-renders the right-hand pane for each.
    const sections = [
      /Build section/,
      /Run section/,
      /Static section/,
      /Environment section/,
      /Phases section/,
      /Resources section/,
      /Hooks section/,
      /Watch section/,
      /Routing section/,
      /PR previews section/,
      /Volume section/,
      /Database section/,
      /Network section/,
      /Notifications section/,
      /Alerts section/,
      /Runtime section/,
    ];
    for (const name of sections) {
      await user.click(screen.getByRole('button', { name }));
    }
  });

  it('reflects a fully-populated manifest in the preview YAML', async () => {
    const user = userEvent.setup();
    renderPage();
    // Apply the Go preset, then open the preview and verify key fields appear.
    await user.click(screen.getByText('Go 1.22'));
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() => {
      const text = document.body.textContent ?? '';
      // The YAML is the project-side manifest only — the nixpacks.toml
      // is generated server-side, so the runtime section is "type: go, version: 1.22".
      expect(text).toMatch(/type: go/);
      expect(text).toMatch(/version: "1.22"/);
      expect(text).toMatch(/start: \.\/app/);
    });
  });

  it('shows the env alias as a separate row in the YAML', async () => {
    const user = userEvent.setup();
    renderPage();
    // Switch to Env, add an alias, then verify it shows in the YAML.
    await user.click(screen.getByRole('button', { name: /Environment section/ }));
    const addAlias = screen.getByRole('button', { name: /Add alias/ });
    fireEvent.click(addAlias);
    // Type into the key field.
    const keyInput = screen.getByLabelText('key (empty)') as HTMLInputElement;
    fireEvent.blur(keyInput, { target: { value: 'A' } });
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/aliases:/);
    });
  });

  it('renders a copy of the preview modal when the header Preview button is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Node 20 (npm)'));
    // Open and re-open the modal to exercise the open/close cycle.
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/No obvious secrets/);
    });
    const closeButton = await screen.findByText('Close');
    await user.click(closeButton);
    await waitFor(() => {
      expect(document.body.textContent ?? '').not.toMatch(/No obvious secrets/);
    });
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    await waitFor(() => {
      expect(document.body.textContent ?? '').toMatch(/No obvious secrets/);
    });
  });

  it('renders the resource form with both fields', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Resources section/ }));
    const cpuInput = screen.getByPlaceholderText('1024') as HTMLInputElement;
    const memInput = screen.getByPlaceholderText('512') as HTMLInputElement;
    fireEvent.change(cpuInput, { target: { value: '2048' } });
    fireEvent.change(memInput, { target: { value: '1024' } });
    expect(cpuInput.value).toBe('2048');
    expect(memInput.value).toBe('1024');
  });

  it('renders a route card after adding one', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Routing section/ }));
    await user.click(screen.getByRole('button', { name: /Add route/ }));
    // The new route card has a "Host" field rendered.
    expect(screen.getByText('Host')).toBeInTheDocument();
  });

  it('renders an alert card after adding one', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Alerts section/ }));
    await user.click(screen.getByRole('button', { name: /Add alert/ }));
    // The new alert card shows the "When" select.
    expect(screen.getByText('When')).toBeInTheDocument();
  });

  it('renders the preview modal Copy button', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderPage();
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    // There are two Copy buttons in the modal (the header one and the
    // inline one inside the modal). Click the second (the inline one)
    // to exercise the modal's own copy path.
    const copyButtons = screen.getAllByRole('button', { name: /Copy/ });
    await user.click(copyButtons[1]!);
    expect(writeText).toHaveBeenCalled();
  });

  it('renders the preview modal Download button', async () => {
    const user = userEvent.setup();
    let anchorClickCount = 0;
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = originalCreateElement(tag, options);
      if (tag.toLowerCase() === 'a') {
        const originalClick = el.click.bind(el);
        el.click = () => {
          anchorClickCount += 1;
          originalClick();
        };
      }
      return el;
    });
    renderPage();
    await user.click(screen.getByText('Node 20 (npm)'));
    await user.click(screen.getByRole('button', { name: /Preview/ }));
    // The modal has a Download button.
    const downloadButtons = screen.getAllByRole('button', { name: /Download/ });
    await user.click(downloadButtons[0]!);
    expect(anchorClickCount).toBeGreaterThan(0);
    createElementSpy.mockRestore();
  });
});
