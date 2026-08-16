import { useState } from 'react';
import { Info } from 'lucide-react';
import { Tabs } from '../../components/ui.js';
import { AccountSection } from './AccountSection.js';
import { AppearanceSection } from './AppearanceSection.js';
import { SecuritySection } from './SecuritySection.js';
import { SystemSection } from './SystemSection.js';
import { NotificationsSection } from './NotificationsSection.js';
import { MigrationSection } from './MigrationSection.js';
import { IntegrationsSection } from './IntegrationsSection.js';

type SectionId = 'account' | 'appearance' | 'security' | 'integrations' | 'system' | 'notifications' | 'migration';

/** Settings page shell: tabbed sections, each self-contained. */
export function Settings() {
  const [section, setSection] = useState<SectionId>('account');

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-2">
        <Info size={20} className="text-indigo-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-slate-400">System information &amp; resource overview.</p>
        </div>
      </div>

      <Tabs
        className="mb-5"
        active={section}
        onChange={(s) => setSection(s as SectionId)}
        tabs={[
          { id: 'account', label: 'Account' },
          { id: 'appearance', label: 'Appearance' },
          { id: 'security', label: 'Security' },
          { id: 'integrations', label: 'Integrations' },
          { id: 'system', label: 'System' },
          { id: 'notifications', label: 'Notifications' },
          { id: 'migration', label: 'Migration' },
        ]}
      />

      {section === 'account' && <AccountSection />}
      {section === 'appearance' && <AppearanceSection />}
      {section === 'security' && <SecuritySection />}
      {section === 'integrations' && <IntegrationsSection />}
      {section === 'system' && <SystemSection />}
      {section === 'notifications' && <NotificationsSection />}
      {section === 'migration' && <MigrationSection />}
    </div>
  );
}
