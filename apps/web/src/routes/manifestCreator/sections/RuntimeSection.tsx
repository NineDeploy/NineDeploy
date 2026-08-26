import type { Runtime, RuntimeType } from '@ninedeploy/schemas';
import { Field, Input, Select } from '../../../components/ui.js';

const RUNTIME_TYPES: readonly { value: RuntimeType; label: string }[] = [
  { value: 'auto', label: 'Auto-detect (let Nixpacks decide)' },
  { value: 'node', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'java', label: 'Java' },
  { value: 'rust', label: 'Rust' },
  { value: 'static', label: 'Static (no runtime pin)' },
];

export function RuntimeSection({
  value,
  onChange,
}: {
  value: Runtime | undefined;
  onChange: (next: Runtime | undefined) => void;
}) {
  const type = value?.type ?? 'auto';
  const version = value?.version ?? '';
  return (
    <div className="space-y-4">
      <Field label="Type" hint="What runtime Nixpacks should pin">
        <Select
          value={type}
          onChange={(e) =>
            onChange({
              type: e.target.value as RuntimeType,
              ...(version ? { version } : {}),
            })
          }
        >
          {RUNTIME_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Version" hint="Major, major.minor, or major.minor.patch — e.g. 20 or 3.12">
        <Input
          value={version}
          placeholder="leave empty to let Nixpacks pick"
          onChange={(e) => {
            const v = e.target.value.trim();
            if (!v) {
              const next: Runtime = { type };
              onChange(next);
            } else {
              onChange({ type, version: v });
            }
          }}
        />
      </Field>
    </div>
  );
}
