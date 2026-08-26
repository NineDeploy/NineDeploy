import type { Database } from '@ninedeploy/schemas';
import { Field, Input } from '../../../components/ui.js';

export function DatabaseSection({
  value,
  onChange,
}: {
  value: Database | undefined;
  onChange: (next: Database | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      <Field
        label="Managed DB slug"
        hint="The slug of a managed database in this instance (run `ninedeploy databases list` to find one)"
      >
        <Input
          value={value?.ref ?? ''}
          placeholder="app-db"
          onChange={(e) => {
            const v = e.target.value.trim();
            if (!v) {
              onChange(undefined);
              return;
            }
            onChange({ ref: v, env: value?.env ?? 'DATABASE_URL' });
          }}
        />
      </Field>
      <Field
        label="Connection-string env key"
        hint="The key the app reads for the connection (default: DATABASE_URL)"
      >
        <Input
          value={value?.env ?? ''}
          placeholder="DATABASE_URL"
          disabled={!value?.ref}
          onChange={(e) => onChange({ ref: value?.ref ?? '', env: e.target.value || 'DATABASE_URL' })}
        />
      </Field>
    </div>
  );
}
