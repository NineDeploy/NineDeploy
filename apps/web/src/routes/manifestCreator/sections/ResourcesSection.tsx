import type { Resources } from '@ninedeploy/schemas';
import { Field, Input } from '../../../components/ui.js';

export function ResourcesSection({
  value,
  onChange,
}: {
  value: Resources | undefined;
  onChange: (next: Resources | undefined) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label="CPU shares"
        hint="0 = unlimited (default); 1024 ≈ 1 vCPU on Docker's weighted scheduler"
      >
        <Input
          type="number"
          min={0}
          max={262144}
          value={value?.cpuShares ?? ''}
          placeholder="1024"
          onChange={(e) => {
            const n = e.target.value ? Number.parseInt(e.target.value, 10) : undefined;
            onChange({ ...(value ?? {}), cpuShares: Number.isFinite(n) ? n : undefined });
          }}
        />
      </Field>
      <Field
        label="Memory (MiB)"
        hint="0 = unlimited; 512 MiB is a sensible default for a small Node service"
      >
        <Input
          type="number"
          min={0}
          max={1_048_576}
          value={value?.memMb ?? ''}
          placeholder="512"
          onChange={(e) => {
            const n = e.target.value ? Number.parseInt(e.target.value, 10) : undefined;
            onChange({ ...(value ?? {}), memMb: Number.isFinite(n) ? n : undefined });
          }}
        />
      </Field>
    </div>
  );
}
