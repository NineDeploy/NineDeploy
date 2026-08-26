import type { Previews } from '@ninedeploy/schemas';
import { Field, Input, Switch } from '../../../components/ui.js';

export function PreviewsSection({
  value,
  onChange,
}: {
  value: Previews | undefined;
  onChange: (next: Previews | undefined) => void;
}) {
  const enabled = value?.enabled ?? false;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
        <div>
          <div className="text-sm font-medium text-slate-100">Enable preview environments</div>
          <div className="text-xs text-slate-500">
            Each PR gets a unique hostname derived from the pattern below.
          </div>
        </div>
        <Switch
          checked={enabled}
          onChange={(next) => {
            if (!next) {
              onChange(undefined);
              return;
            }
            onChange({
              enabled: true,
              ...(value?.pattern ? { pattern: value.pattern } : { pattern: 'pr-{n}.previews.example.com' }),
              maxActive: value?.maxActive ?? 5,
              autoDestroyOnClose: value?.autoDestroyOnClose ?? true,
            });
          }}
        />
      </div>
      <Field label="Hostname pattern" hint="Must contain {n} — replaced by the PR number">
        <Input
          value={value?.pattern ?? ''}
          placeholder="pr-{n}.previews.example.com"
          disabled={!enabled}
          onChange={(e) =>
            onChange({
              enabled: true,
              pattern: e.target.value || 'pr-{n}.previews.example.com',
              maxActive: value?.maxActive ?? 5,
              autoDestroyOnClose: value?.autoDestroyOnClose ?? true,
            })
          }
        />
      </Field>
      <Field label="Max active previews" hint="Older ones are torn down to stay under the cap">
        <Input
          type="number"
          min={1}
          max={50}
          value={value?.maxActive ?? 5}
          disabled={!enabled}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange({
              enabled: true,
              pattern: value?.pattern ?? 'pr-{n}.previews.example.com',
              maxActive: Number.isFinite(n) ? n : 5,
              autoDestroyOnClose: value?.autoDestroyOnClose ?? true,
            });
          }}
        />
      </Field>
    </div>
  );
}
