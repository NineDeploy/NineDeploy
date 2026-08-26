/**
 * Manifest Creator — the project-side form editor for `.ninedeploy`.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ PageHeader: title + Copy / Download / Reset actions            │
 *   │ PresetSelector (full width, one row of starter templates)      │
 *   ├────────────────┬─────────────────────────────────────────────┤
 *   │ Section nav    │ Active section form                          │
 *   │ (sticky)       │                                             │
 *   └────────────────┴─────────────────────────────────────────────┘
 *
 * The page owns the manifest state via `useManifestForm`; each section
 * receives its slice and an update callback. A `Preview YAML` modal
 * surfaces the current YAML plus a client-side secret-lint so the
 * operator can sanity-check before committing.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { formatManifestYaml, type NinedeployManifest } from '@ninedeploy/sdk';
import { Check, Code2, Copy, Download, FileCode, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Modal,
  PageHeader,
  PresetSelector,
  type PresetOption,
  Tooltip,
  cn,
} from '../components/ui.js';
import { downloadBlob, useCopy } from '../lib/format.js';
import { PRESETS } from './manifestCreator/presets.js';
import { lintManifest } from './manifestCreator/secretScan.js';
import { SECTIONS, useManifestForm, type SectionId } from './manifestCreator/state.js';
import { AlertsSection } from './manifestCreator/sections/AlertsSection.js';
import { BuildSection } from './manifestCreator/sections/BuildSection.js';
import { DatabaseSection } from './manifestCreator/sections/DatabaseSection.js';
import { EnvSection } from './manifestCreator/sections/EnvSection.js';
import { HooksSection } from './manifestCreator/sections/HooksSection.js';
import { NetworkSection } from './manifestCreator/sections/NetworkSection.js';
import { NotificationsSection } from './manifestCreator/sections/NotificationsSection.js';
import { PhasesSection } from './manifestCreator/sections/PhasesSection.js';
import { PreviewsSection } from './manifestCreator/sections/PreviewsSection.js';
import { ResourcesSection } from './manifestCreator/sections/ResourcesSection.js';
import { RoutingSection } from './manifestCreator/sections/RoutingSection.js';
import { RunSection } from './manifestCreator/sections/RunSection.js';
import { StaticSection } from './manifestCreator/sections/StaticSection.js';
import { VolumeSection } from './manifestCreator/sections/VolumeSection.js';
import { WatchSection } from './manifestCreator/sections/WatchSection.js';
import { RuntimeSection } from './manifestCreator/sections/RuntimeSection.js';

/**
 * Section registry: maps the section id to the form component. The order
 * matches `SECTIONS` (left-nav order). Keeping this in one place means
 * adding a new section is a one-liner in two adjacent objects.
 */
const SECTION_RENDERERS: Record<
  SectionId,
  (props: { manifest: NinedeployManifest; replace: (next: NinedeployManifest) => void }) => ReactNode
> = {
  runtime: ({ manifest, replace }) => (
    <RuntimeSection
      value={manifest.runtime}
      onChange={(runtime) => replace({ ...manifest, ...(runtime ? { runtime } : {}) })}
    />
  ),
  build: ({ manifest, replace }) => (
    <BuildSection
      value={manifest.build}
      onChange={(build) => replace({ ...manifest, ...(build ? { build } : {}) })}
    />
  ),
  run: ({ manifest, replace }) => (
    <RunSection
      value={manifest.run}
      onChange={(run) => replace({ ...manifest, ...(run ? { run } : {}) })}
    />
  ),
  static: ({ manifest, replace }) => (
    <StaticSection
      value={manifest.static}
      onChange={(staticConfig) =>
        replace({ ...manifest, ...(staticConfig ? { static: staticConfig } : {}) })
      }
    />
  ),
  env: ({ manifest, replace }) => (
    <EnvSection
      value={manifest.env}
      onChange={(env) => replace({ ...manifest, ...(env ? { env } : {}) })}
    />
  ),
  phases: ({ manifest, replace }) => (
    <PhasesSection
      value={manifest.phases}
      onChange={(phases) => replace({ ...manifest, ...(phases ? { phases } : {}) })}
    />
  ),
  resources: ({ manifest, replace }) => (
    <ResourcesSection
      value={manifest.resources}
      onChange={(resources) =>
        replace({ ...manifest, ...(resources ? { resources } : {}) })
      }
    />
  ),
  hooks: ({ manifest, replace }) => (
    <HooksSection
      value={manifest.hooks}
      onChange={(hooks) => replace({ ...manifest, ...(hooks ? { hooks } : {}) })}
    />
  ),
  watch: ({ manifest, replace }) => (
    <WatchSection
      value={manifest.watch}
      onChange={(watch) => replace({ ...manifest, ...(watch ? { watch } : {}) })}
    />
  ),
  routing: ({ manifest, replace }) => (
    <RoutingSection
      value={manifest.routes}
      onChange={(routes) => replace({ ...manifest, ...(routes ? { routes } : {}) })}
    />
  ),
  previews: ({ manifest, replace }) => (
    <PreviewsSection
      value={manifest.previews}
      onChange={(previews) => replace({ ...manifest, ...(previews ? { previews } : {}) })}
    />
  ),
  volume: ({ manifest, replace }) => (
    <VolumeSection
      value={manifest.volume}
      onChange={(volume) => replace({ ...manifest, ...(volume ? { volume } : {}) })}
    />
  ),
  database: ({ manifest, replace }) => (
    <DatabaseSection
      value={manifest.database}
      onChange={(database) => replace({ ...manifest, ...(database ? { database } : {}) })}
    />
  ),
  network: ({ manifest, replace }) => (
    <NetworkSection
      value={manifest.network}
      onChange={(network) => replace({ ...manifest, ...(network ? { network } : {}) })}
    />
  ),
  notifications: ({ manifest, replace }) => (
    <NotificationsSection
      value={manifest.notifications}
      onChange={(notifications) =>
        replace({ ...manifest, ...(notifications ? { notifications } : {}) })
      }
    />
  ),
  alerts: ({ manifest, replace }) => (
    <AlertsSection
      value={manifest.alerts}
      onChange={(alerts) => replace({ ...manifest, ...(alerts ? { alerts } : {}) })}
    />
  ),
};

export function ManifestCreator() {
  const { manifest, replace, reset } = useManifestForm();
  const [activeId, setActiveId] = useState<SectionId>('runtime');

  // When opened from a service detail tab via `?from=service:<id>` the
  // prefill flow loads the service's current build/run settings into the
  // form so the operator only has to fill in the fields the manifest
  // adds on top of the existing service config.
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const fromParam = params.get('from');
  const fromServiceId = fromParam?.startsWith('service:')
    ? Number.parseInt(fromParam.slice('service:'.length), 10)
    : null;
  const fromServiceIdSafe = Number.isFinite(fromServiceId) ? fromServiceId : null;
  const fromService = useQuery({
    queryKey: ['service-for-manifest', fromServiceIdSafe],
    queryFn: () => api.services.get(fromServiceIdSafe!),
    enabled: fromServiceIdSafe != null,
  });
  useEffect(() => {
    // Only prefill once (when the form is the empty starter and the
    // service query has resolved). Re-running this on every service
    // refetch would clobber user edits.
    if (!fromService.data) return;
    if (manifest.version !== '1' || Object.keys(manifest).length > 1) return;
    const svc = fromService.data;
    const seeded: NinedeployManifest = {
      version: '1',
      run: {
        port: svc.port ?? undefined,
        healthcheck: svc.healthPath ?? undefined,
      },
    };
    replace(seeded);
  }, [fromService.data, manifest, replace]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { copy, copied } = useCopy(1500);

  const yaml = useMemo(() => formatManifestYaml(manifest), [manifest]);
  const lint = useMemo(() => lintManifest(manifest), [manifest]);
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]!;
  const renderSection = SECTION_RENDERERS[activeId];
  if (!renderSection) throw new Error(`No renderer for section ${active.id}`);

  const downloadFile = () => {
    downloadBlob(yaml, '.ninedeploy', 'text/yaml');
  };

  return (
    <div>
      <PageHeader
        icon={<FileCode size={18} />}
        title="Manifest Creator"
        subtitle="Project-side editor for .ninedeploy. The file is committed to the repo and read by the docker builder at deploy time."
        actions={
          <>
            <Tooltip content="Copy the current YAML to the clipboard">
              <Button variant="secondary" size="md" onClick={() => copy(yaml)}>
                {copied ? (
                  <>
                    <Check size={14} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copy YAML
                  </>
                )}
              </Button>
            </Tooltip>
            <Button variant="secondary" size="md" onClick={downloadFile}>
              <Download size={14} /> Download
            </Button>
            <Button variant="secondary" size="md" onClick={() => setPreviewOpen(true)}>
              <Code2 size={14} /> Preview
            </Button>
            <Tooltip content="Reset to an empty manifest (cannot be undone)">
              <Button variant="ghost" size="md" onClick={reset}>
                <RefreshCw size={14} /> Reset
              </Button>
            </Tooltip>
          </>
        }
      />

      <Card className="mb-5">
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-indigo-300" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Start from a preset
            </span>
          </div>
          <PresetSelector
            options={PRESETS as readonly PresetOption<NinedeployManifest>[]}
            onSelect={(preset) => replace(preset)}
          />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[14rem_1fr]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <nav className="space-y-0.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1.5">
            {SECTIONS.map((section) => {
              const isActive = section.id === activeId;
              const filled = section.isFilled(manifest);
              return (
                <button
                  key={section.id}
                  type="button"
                  data-section={section.id}
                  aria-label={`${section.label} section`}
                  onClick={() => setActiveId(section.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition',
                    isActive
                      ? 'bg-indigo-500/15 text-indigo-100 ring-1 ring-indigo-500/30'
                      : 'text-slate-300 hover:bg-white/[0.05] hover:text-slate-100',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                      filled ? 'bg-emerald-400' : 'bg-slate-600',
                    )}
                    aria-hidden
                  />
                  <span className="flex-1">
                    <span className="block font-medium">{section.label}</span>
                    <span className="block text-[11px] text-slate-500">{section.blurb}</span>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="mt-3 text-[11px] text-slate-500">
            <Badge tone={lint.length > 0 ? 'rose' : 'emerald'} className="mb-1.5">
              {lint.length > 0 ? `${lint.length} secret risk` : 'no secret risks'}
            </Badge>
            {lint.length > 0 && (
              <ul className="space-y-0.5">
                {lint.map((h, i) => (
                  <li key={i}>
                    <code className="font-mono text-[10px] text-rose-300">{h.path}</code>: {h.description}{' '}
                    <span className="text-slate-500">({h.redacted})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <Card>
          <CardBody>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-100">{active.label}</h2>
              <p className="text-xs text-slate-500">{active.blurb}</p>
            </div>
            {renderSection({ manifest, replace })}
          </CardBody>
        </Card>
      </div>

      <Modal
        title=".ninedeploy preview"
        onClose={() => setPreviewOpen(false)}
        wide
        open={previewOpen}
      >
        <div className="space-y-4">
          {lint.length > 0 ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-300">
                {lint.length} potential secret risk
                {lint.length === 1 ? '' : 's'}
              </div>
              <ul className="space-y-0.5">
                {lint.map((h, i) => (
                  <li key={i} className="text-xs text-rose-200">
                    <code className="font-mono text-[11px]">{h.path}</code>: {h.description}{' '}
                    <span className="text-rose-400">({h.redacted})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200">
              No obvious secrets — the file is safe to commit.
            </div>
          )}
          <pre className="max-h-[60vh] overflow-auto rounded-lg border border-white/10 bg-black/50 p-3 text-xs leading-relaxed text-slate-200">
            {yaml}
          </pre>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => copy(yaml)}>
              {copied ? <Check size={12} /> : <Copy size={12} />} Copy
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadFile}>
              <Download size={12} /> Download
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(false)}>
              <X size={12} /> Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
