import type { Volume } from '@ninedeploy/schemas';
import { Field, Input } from '../../../components/ui.js';

export function VolumeSection({
  value,
  onChange,
}: {
  value: Volume | undefined;
  onChange: (next: Volume | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      <Field
        label="Mount path"
        hint="Container path where the persistent volume is mounted (e.g. /data)"
      >
        <Input
          value={value?.mount ?? ''}
          placeholder="/data"
          onChange={(e) => onChange({ ...(value ?? {}), mount: e.target.value || undefined })}
        />
      </Field>
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Off-site backups
        </div>
        <p className="mb-3 text-[11px] text-slate-500">
          Cron schedule in standard 5-field format. Backups are written to the
          configured S3 destination; retention deletes older copies.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Cron schedule">
            <Input
              value={value?.backups?.schedule ?? ''}
              placeholder="0 3 * * *"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  const { backups: _drop, ...rest } = value ?? {};
                  void _drop;
                  onChange(Object.keys(rest).length > 0 ? rest : undefined);
                  return;
                }
                onChange({
                  ...(value ?? {}),
                  backups: {
                    schedule: raw,
                    retention: value?.backups?.retention ?? 7,
                  },
                });
              }}
            />
          </Field>
          <Field label="Retention (days)">
            <Input
              type="number"
              min={1}
              max={365}
              value={value?.backups?.retention ?? 7}
              disabled={!value?.backups?.schedule}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (!value?.backups?.schedule || !Number.isFinite(n)) return;
                onChange({
                  ...(value ?? {}),
                  backups: { schedule: value.backups.schedule, retention: n },
                });
              }}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
