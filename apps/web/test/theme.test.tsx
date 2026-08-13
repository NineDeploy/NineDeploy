import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './web-utils.js';
import { ACCENTS, ThemeProvider, useTheme } from '../src/lib/theme.js';

const THEME_KEY = 'ninedeploy.theme';
const ACCENT_KEY = 'ninedeploy.accent';

function Probe() {
  const { theme, accent, setTheme, setAccent, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="accent">{accent}</span>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={() => setTheme('light')}>set-light</button>
      <button onClick={() => setTheme('dark')}>set-dark</button>
      <button onClick={() => setAccent('rose')}>set-rose</button>
    </div>
  );
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
    vi.restoreAllMocks();
  });

  it('defaults to dark theme and indigo accent and applies them to <html>', () => {
    renderTheme();
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('accent')).toHaveTextContent('indigo');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-accent')).toBe('indigo');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(localStorage.getItem(ACCENT_KEY)).toBe('indigo');
  });

  it('reads persisted theme and accent from localStorage', () => {
    localStorage.setItem(THEME_KEY, 'light');
    localStorage.setItem(ACCENT_KEY, 'amber');
    renderTheme();
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('accent')).toHaveTextContent('amber');
  });

  it('falls back to dark/indigo when localStorage reads throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderTheme();
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('accent')).toHaveTextContent('indigo');
  });

  it('toggles between dark and light', async () => {
    const user = userEvent.setup();
    renderTheme();
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('sets the theme explicitly', async () => {
    const user = userEvent.setup();
    renderTheme();
    await user.click(screen.getByText('set-light'));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    await user.click(screen.getByText('set-dark'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('sets the accent explicitly', async () => {
    const user = userEvent.setup();
    renderTheme();
    await user.click(screen.getByText('set-rose'));
    expect(screen.getByTestId('accent')).toHaveTextContent('rose');
    expect(document.documentElement.getAttribute('data-accent')).toBe('rose');
    expect(localStorage.getItem(ACCENT_KEY)).toBe('rose');
  });

  it('ignores localStorage write failures', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const user = userEvent.setup();
    renderTheme();
    await user.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('exposes the accent palette', () => {
    expect(ACCENTS).toHaveLength(6);
    expect(ACCENTS[0]).toEqual({ id: 'indigo', label: 'Indigo', color: '#6366f1' });
  });
});

describe('useTheme', () => {
  it('throws when used outside a ThemeProvider', () => {
    const original = console.error;
    console.error = vi.fn();
    try {
      expect(() => act(() => render(<Probe />))).toThrow(
        'useTheme must be used within ThemeProvider',
      );
    } finally {
      console.error = original;
    }
  });
});
