import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Hub } from '../src/routes/Hub.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

vi.mock('../src/components/DeployWizard.js', () => ({
  DeployWizard: ({ template, onClose }: { template: { name: string }; onClose: () => void }) => (
    <div data-testid="deploy-wizard">
      wizard-{template?.name}
      <button onClick={onClose}>close wizard</button>
    </div>
  ),
}));

const templates = [
  {
    id: 'n8n',
    name: 'n8n',
    emoji: '⚡',
    category: 'Automation',
    tagline: 'Workflow automation',
    featured: true,
  },
  {
    id: 'ghost',
    name: 'Ghost',
    emoji: '👻',
    category: 'Blogging',
    tagline: 'Publishing platform',
    featured: false,
  },
];

const templateDetail = {
  id: 'n8n',
  name: 'n8n',
  emoji: '⚡',
  category: 'Automation',
  tagline: 'Workflow automation',
  description: 'A workflow tool',
  image: 'docker.io/n8nio/n8n',
  port: 5678,
  volumeMount: '/home/node/.n8n',
  website: 'https://n8n.io',
  env: [
    { key: 'N8N_HOST', value: 'localhost' },
    { key: 'N8N_KEY', value: '', secret: true },
  ],
};

describe('Hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeleton while loading', () => {
    mockOf(api.templates.list).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Hub />);
    expect(document.querySelectorAll('.animate-pulse').length).toBe(4);
  });

  it('renders templates with categories and filters by search + category', async () => {
    const user = userEvent.setup();
    mockOf(api.templates.list).mockResolvedValue(templates as never);
    renderWithProviders(<Hub />);
    await screen.findByText('n8n');
    // featured badge only for featured template
    expect(screen.getByText('featured')).toBeInTheDocument();
    // category chips: All + both categories
    expect(screen.getByRole('button', { name: 'Automation' })).toBeInTheDocument();
    // filter by category
    await user.click(screen.getByRole('button', { name: 'Blogging' }));
    expect(screen.queryByText('Workflow automation')).not.toBeInTheDocument();
    expect(screen.getByText('Publishing platform')).toBeInTheDocument();
    // filter by search
    await user.type(screen.getByPlaceholderText('Search templates…'), 'n8n');
    expect(screen.queryByText('Publishing platform')).not.toBeInTheDocument();
  });

  it('shows a custom-registry badge when a source is configured', async () => {
    mockOf(api.settings.get).mockResolvedValue({ allowRegistration: true, acmeEmail: null, templatesSource: 'https://registry.example.com/r.json', dnsProvider: null, hasDnsToken: false, wildcardApex: null } as never);
    mockOf(api.templates.list).mockResolvedValue(templates as never);
    renderWithProviders(<Hub />);
    expect(await screen.findByText('custom registry')).toBeInTheDocument();
  });

  it('shows the template detail modal and deploys', async () => {
    const user = userEvent.setup();
    mockOf(api.templates.list).mockResolvedValue(templates as never);
    mockOf(api.templates.get).mockResolvedValue(templateDetail as never);
    renderWithProviders(<Hub />);
    // click the n8n template card
    fireEvent.click(await screen.findByRole('button', { name: /n8n/ }));
    await screen.findByText('A workflow tool');
    // image.split('/').pop() -> 'n8n'
    expect(screen.getAllByText('n8n').length).toBeGreaterThan(0);
    expect(screen.getByText(':5678')).toBeInTheDocument();
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('N8N_HOST')).toBeInTheDocument();
    expect(screen.getByText('localhost')).toBeInTheDocument();
    expect(screen.getByText('••• secret')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'n8n.io' })).toHaveAttribute('href', 'https://n8n.io');
    // deploy opens the wizard with the template
    await user.click(screen.getByRole('button', { name: /Configure & deploy/ }));
    expect(screen.getByTestId('deploy-wizard')).toHaveTextContent('wizard-n8n');
    await user.click(screen.getByRole('button', { name: 'close wizard' }));
    expect(screen.queryByTestId('deploy-wizard')).not.toBeInTheDocument();
  });

  it('shows the ephemeral spec when a template has no volume mount', async () => {
    mockOf(api.templates.list).mockResolvedValue(templates as never);
    mockOf(api.templates.get).mockResolvedValue({ ...templateDetail, volumeMount: null } as never);
    renderWithProviders(<Hub />);
    fireEvent.click(await screen.findByRole('button', { name: /n8n/ }));
    await screen.findByText('A workflow tool');
    expect(screen.getByText('Ephemeral')).toBeInTheDocument();
  });

  it('closes the template detail modal via the close button', async () => {
    mockOf(api.templates.list).mockResolvedValue(templates as never);
    mockOf(api.templates.get).mockResolvedValue(templateDetail as never);
    renderWithProviders(<Hub />);
    fireEvent.click(await screen.findByRole('button', { name: /n8n/ }));
    await screen.findByText('A workflow tool');
    const closeButton = screen.getAllByRole('button').find((b) => b.querySelector('.lucide-x'))!;
    fireEvent.click(closeButton);
    expect(screen.queryByText('A workflow tool')).not.toBeInTheDocument();
  });

  it('shows loading state inside the detail modal', async () => {
    mockOf(api.templates.list).mockResolvedValue(templates as never);
    mockOf(api.templates.get).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<Hub />);
    fireEvent.click(await screen.findByRole('button', { name: /n8n/ }));
    await waitFor(() => expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0));
  });
});
