import { type ReactNode, useState } from 'react';
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  HardDrive,
  KeyRound,
  Palette,
  Puzzle,
  Server,
  Settings as SettingsIcon,
  Shield,
  Sliders,
  Terminal,
  User,
} from 'lucide-react';
import { AccountSection } from './AccountSection.js';
import { AppearanceSection } from './AppearanceSection.js';
import { SecuritySection } from './SecuritySection.js';
import { SystemSection } from './SystemSection.js';
import { NotificationsSection } from './NotificationsSection.js';
import { MigrationSection } from './MigrationSection.js';
import { IntegrationsSection } from './IntegrationsSection.js';
import { ConfigCenterSection } from './ConfigCenterSection.js';
import { PluginsSection } from './PluginsSection.js';
import { LogDrainsSection } from './LogDrainsSection.js';
import { StorageSection } from './StorageSection.js';
import { SsoSection } from './SsoSection.js';
import { PageHeader, cn } from '../../components/ui.js';

type SectionId =
  | 'account'
  | 'appearance'
  | 'security'
  | 'sso'
  | 'integrations'
  | 'log-drains'
  | 'storage'
  | 'config'
  | 'plugins'
  | 'system'
  | 'notifications'
  | 'migration';

interface SectionItem {
  id: SectionId;
  label: string;
  desc: string;
  icon: ReactNode;
}

interface SectionCategory {
  category: string;
  items: SectionItem[];
}

const SETTING_GROUPS: SectionCategory[] = [
  {
    category: 'Personal & Access',
    items: [
      { id: 'account', label: 'Account', desc: 'Profile, credentials & passkeys', icon: <User size={16} /> },
      { id: 'appearance', label: 'Appearance', desc: 'Theme colors & density', icon: <Palette size={16} /> },
      { id: 'security', label: 'Security', desc: '2FA, audit logs & sessions', icon: <Shield size={16} /> },
      { id: 'sso', label: 'SSO & OIDC', desc: 'Identity providers & auto-enroll', icon: <KeyRound size={16} /> },
    ],
  },
  {
    category: 'Integrations & Alerts',
    items: [
      { id: 'integrations', label: 'Integrations', desc: 'Vault secrets, DNS & S3', icon: <Boxes size={16} /> },
      { id: 'notifications', label: 'Notifications', desc: 'Webhooks, Slack, Telegram', icon: <Bell size={16} /> },
      { id: 'log-drains', label: 'Log Drains', desc: 'Syslog, Datadog & Vector', icon: <Terminal size={16} /> },
    ],
  },
  {
    category: 'DevOps & Engine',
    items: [
      { id: 'storage', label: 'Storage & Prune', desc: 'Disks, Docker prune & logs', icon: <HardDrive size={16} /> },
      { id: 'config', label: 'Config Center', desc: 'Global key-value configuration', icon: <Sliders size={16} /> },
      { id: 'plugins', label: 'Plugins', desc: 'Community plugins & extensions', icon: <Puzzle size={16} /> },
    ],
  },
  {
    category: 'Platform & Lifecycle',
    items: [
      { id: 'system', label: 'System', desc: 'Resources, version & updates', icon: <Server size={16} /> },
      { id: 'migration', label: 'Migration', desc: 'Full backups import/export', icon: <ArrowLeftRight size={16} /> },
    ],
  },
];

/** Settings page shell: clean vertical sidebar navigation layout. */
export function Settings() {
  const [section, setSection] = useState<SectionId>('account');

  return (
    <div className="space-y-6 nd-fade">
      <PageHeader
        icon={<SettingsIcon size={20} />}
        title="Settings & Platform Config"
        subtitle="Manage personal preferences, enterprise authentication, integrations, storage and DevOps engine."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Vertical Sidebar Navigation */}
        <aside className="lg:col-span-4 xl:col-span-3" aria-label="Settings navigation">
          <div className="sticky top-6 space-y-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 backdrop-blur-sm">
            <div role="tablist" aria-orientation="vertical" className="space-y-5">
              {SETTING_GROUPS.map((group) => (
                <div key={group.category} className="space-y-1">
                  <div className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {group.category}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = section === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="tab"
                          id={`tab-${item.id}`}
                          aria-selected={active}
                          aria-controls={`panel-${item.id}`}
                          onClick={() => setSection(item.id)}
                          className={cn(
                            'group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition text-xs',
                            active
                              ? 'bg-indigo-500/15 text-indigo-300 font-semibold shadow-sm ring-1 ring-inset ring-indigo-500/25'
                              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
                          )}
                        >
                          <span
                            className={cn(
                              'grid h-6 w-6 place-items-center rounded-lg transition-colors shrink-0',
                              active ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 group-hover:text-slate-300',
                            )}
                          >
                            {item.icon}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="lg:col-span-8 xl:col-span-9 min-w-0" id={`panel-${section}`} role="tabpanel" aria-labelledby={`tab-${section}`}>
          <div className="space-y-6">
            {section === 'account' && <AccountSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'security' && <SecuritySection />}
            {section === 'sso' && <SsoSection />}
            {section === 'integrations' && <IntegrationsSection />}
            {section === 'log-drains' && <LogDrainsSection />}
            {section === 'storage' && <StorageSection />}
            {section === 'config' && <ConfigCenterSection />}
            {section === 'plugins' && <PluginsSection />}
            {section === 'system' && <SystemSection />}
            {section === 'notifications' && <NotificationsSection />}
            {section === 'migration' && <MigrationSection />}
          </div>
        </main>
      </div>
    </div>
  );
}
