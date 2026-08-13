import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, deferred, renderWithProviders } from './web-utils.js';

const apiMock = vi.hoisted(() => ({
  api: {
    env: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/api.js', () => apiMock);

import { EnvCard } from '../src/components/EnvCard.js';

const VARS = [
  { id: 1, key: 'PORT', value: '3000', isSecret: false },
  { id: 2, key: 'API_KEY', value: 'hunter2', isSecret: true },
];

function renderCard() {
  return renderWithProviders(<EnvCard serviceId={7} />, {
    queryClient: createQueryClient(),
  });
}

/** Locate the Add submit button inside the new-env form (it has no accessible text). */
function getAddButton() {
  return document.querySelector('form button[type="submit"]') as HTMLButtonElement;
}

/** Locate the <form> element wrapping the new-variable inputs. */
function getAddForm() {
  return document.querySelector('form') as HTMLFormElement;
}

describe('EnvCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.api.env.list.mockResolvedValue(VARS);
    apiMock.api.env.create.mockResolvedValue({ id: 3, key: 'K', value: 'v', isSecret: false });
    apiMock.api.env.update.mockResolvedValue({ id: 1, key: 'PORT', value: '8080', isSecret: false });
    apiMock.api.env.remove.mockResolvedValue(undefined);
  });

  it('shows a skeleton while loading', () => {
    apiMock.api.env.list.mockReturnValue(new Promise(() => {}));
    const { container } = renderCard();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows an empty state when there are no variables', async () => {
    apiMock.api.env.list.mockResolvedValue([]);
    renderCard();
    await waitFor(() => expect(screen.getByText('No environment variables.')).toBeInTheDocument());
  });

  it('renders the variable rows with secret markers', async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText('PORT')).toBeInTheDocument());
    expect(screen.getByText('API_KEY')).toBeInTheDocument();
    expect(screen.getByText('secret')).toBeInTheDocument();
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    expect(passwordInputs.length).toBeGreaterThan(0);
  });

  it('adds a new variable on submit', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText('PORT')).toBeInTheDocument());
    const keyInput = screen.getByPlaceholderText('KEY') as HTMLInputElement;
    const valueInput = screen.getByPlaceholderText('value') as HTMLInputElement;
    await act(async () => {
      await user.type(keyInput, 'FOO');
      await user.type(valueInput, 'bar');
    });
    await waitFor(() => {
      expect(keyInput.value).toBe('FOO');
      expect(valueInput.value).toBe('bar');
      expect(getAddButton()).not.toBeDisabled();
    });
    await act(async () => {
      fireEvent.submit(getAddForm());
    });
    await waitFor(() =>
      expect(apiMock.api.env.create).toHaveBeenCalledWith(7, { key: 'FOO', value: 'bar', isSecret: false }),
    );
    expect(screen.getByPlaceholderText('KEY')).toHaveValue('');
    expect(screen.getByPlaceholderText('value')).toHaveValue('');
  });

  it('adds a secret variable when the checkbox is checked', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText('PORT')).toBeInTheDocument());
    const keyInput = screen.getByPlaceholderText('KEY') as HTMLInputElement;
    const valueInput = screen.getByPlaceholderText('value') as HTMLInputElement;
    await act(async () => {
      await user.type(keyInput, 'SEC');
      await user.type(valueInput, 'x');
      await user.click(screen.getByRole('checkbox'));
    });
    expect(screen.getByPlaceholderText('secret value')).toBeInTheDocument();
    await waitFor(() => {
      expect(keyInput.value).toBe('SEC');
      expect(getAddButton()).not.toBeDisabled();
    });
    await act(async () => {
      fireEvent.submit(getAddForm());
    });
    await waitFor(() =>
      expect(apiMock.api.env.create).toHaveBeenCalledWith(7, { key: 'SEC', value: 'x', isSecret: true }),
    );
  });

  it('does not submit when the key is empty', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText('PORT')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('value'), 'v');
    expect(getAddButton()).toBeDisabled();
    fireEvent.submit(getAddForm());
    expect(apiMock.api.env.create).not.toHaveBeenCalled();
  });

  it('disables the add button while a create is pending', async () => {
    const d = deferred();
    apiMock.api.env.create.mockReturnValue(d.promise);
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText('PORT')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('KEY'), 'FOO');
    await waitFor(() => expect(getAddButton()).toBeEnabled());
    fireEvent.submit(getAddForm());
    expect(getAddButton()).toBeDisabled();
    d.resolve({ id: 9, key: 'FOO', value: 'b', isSecret: false });
  });

  it('saves an edited draft with the save button', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText('PORT')).toBeInTheDocument());
    const input = screen.getByDisplayValue('3000');
    const row = input.closest('div.flex.items-center') as HTMLElement;
    await user.type(input, 'X');
    await user.click(within(row).getByTitle('Save'));
    await waitFor(() =>
      expect(apiMock.api.env.update).toHaveBeenCalledWith(7, 1, { key: 'PORT', value: expect.stringContaining('3000') }),
    );
  });

  it('keeps the save button disabled when the draft is unchanged or cleared', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText('PORT')).toBeInTheDocument());
    const input = screen.getByDisplayValue('3000');
    const row = input.closest('div.flex.items-center') as HTMLElement;
    expect(within(row).getByTitle('Save')).toBeDisabled();
    await user.clear(input);
    // Clearing sets the draft to '', which the component treats as "not dirty",
    // so the controlled input snaps back to the stored value and Save stays disabled.
    expect(within(row).getByTitle('Save')).toBeDisabled();
    expect(input).toHaveValue('3000');
  });

  it('deletes a variable with the delete button', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText('PORT')).toBeInTheDocument());
    const input = screen.getByDisplayValue('3000');
    const row = input.closest('div.flex.items-center') as HTMLElement;
    await user.click(within(row).getByTitle('Delete'));
    await waitFor(() => expect(apiMock.api.env.remove).toHaveBeenCalledWith(7, 1));
  });
});