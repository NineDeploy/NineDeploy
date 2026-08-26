/**
 * Form-state helpers for the Manifest Creator page.
 *
 * The page owns a single `NinedeployManifest` state object. Each section
 * component receives a slice and an update callback; this file is the
 * shared plumbing for the section list, slice updates, and a small
 * localStorage-backed hook so the operator's work survives page reloads.
 */
import { useCallback, useEffect, useState } from 'react';
import type { NinedeployManifest } from '@ninedeploy/schemas';

const STORAGE_KEY = 'ninedeploy.manifest.draft';

const EMPTY_MANIFEST: NinedeployManifest = { version: '1' };

/** Read the persisted draft, falling back to a clean empty manifest. */
function loadDraft(): NinedeployManifest {
  if (typeof window === 'undefined') return EMPTY_MANIFEST;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_MANIFEST;
    const parsed = JSON.parse(raw) as NinedeployManifest;
    // Light shape check — full validation is the SDK's job at apply time.
    if (parsed && typeof parsed === 'object' && parsed.version === '1') {
      return parsed;
    }
    return EMPTY_MANIFEST;
  } catch {
    return EMPTY_MANIFEST;
  }
}

/** Persist a draft to localStorage. Quietly swallows quota / private-mode errors. */
function saveDraft(manifest: NinedeployManifest): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
  } catch {
    /* private mode or quota — non-fatal */
  }
}

/**
 * React hook returning the current manifest, a `replace` callback for
 * whole-state swaps (preset apply, reset), and a `reset` that returns
 * the page to the empty starter. The draft is auto-saved to localStorage
 * on every change. Slice-level updates are not exposed — the page
 * builds the next state in a closure and hands it to `replace`, which
 * keeps the data-flow simple.
 */
export function useManifestForm() {
  const [manifest, setManifest] = useState<NinedeployManifest>(loadDraft);

  useEffect(() => {
    saveDraft(manifest);
  }, [manifest]);

  const replace = useCallback((next: NinedeployManifest) => {
    setManifest(next);
  }, []);

  const reset = useCallback(() => {
    setManifest(EMPTY_MANIFEST);
  }, []);

  return { manifest, replace, reset } as const;
}

/**
 * Section descriptor for the page's left navigation. The order here is
 * the order rendered in the form, so it doubles as a content outline.
 */
export interface ManifestSection {
  id: string;
  label: string;
  /** Short summary shown in the nav — keeps it scannable. */
  blurb: string;
  /** True when the section has any user-provided values; drives the • dot in the nav. */
  isFilled: (m: NinedeployManifest) => boolean;
}

export const SECTIONS: readonly ManifestSection[] = [
  {
    id: 'runtime',
    label: 'Runtime',
    blurb: 'Language + version (Node 20, Python 3.12, …)',
    isFilled: (m) => m.runtime != null,
  },
  {
    id: 'build',
    label: 'Build',
    blurb: 'Install, build, start commands and baseDir',
    isFilled: (m) => m.build != null && Object.keys(m.build).length > 0,
  },
  {
    id: 'run',
    label: 'Run',
    blurb: 'Container port, healthcheck, restart policy',
    isFilled: (m) => m.run != null,
  },
  {
    id: 'static',
    label: 'Static',
    blurb: 'SPA fallback for static frontends',
    isFilled: (m) => m.static != null,
  },
  {
    id: 'env',
    label: 'Environment',
    blurb: 'Required env keys + managed-DB aliases',
    isFilled: (m) =>
      m.env != null && (m.env.required.length > 0 || Object.keys(m.env.aliases ?? {}).length > 0),
  },
  {
    id: 'phases',
    label: 'Phases',
    blurb: 'Extra nixpkgs + build-step cmds',
    isFilled: (m) =>
      m.phases != null &&
      ((m.phases.setup?.pkgs.length ?? 0) > 0 || (m.phases.build?.cmds.length ?? 0) > 0),
  },
  {
    id: 'resources',
    label: 'Resources',
    blurb: 'CPU shares + memory cap',
    isFilled: (m) => m.resources != null,
  },
  {
    id: 'hooks',
    label: 'Hooks',
    blurb: 'preBuild / postBuild / preStop scripts',
    isFilled: (m) =>
      m.hooks != null && (m.hooks.preBuild != null || m.hooks.postBuild != null || m.hooks.preStop != null),
  },
  {
    id: 'watch',
    label: 'Watch',
    blurb: 'Monorepo watch-paths for auto-deploy',
    isFilled: (m) => m.watch != null && m.watch.paths.length > 0,
  },
  {
    id: 'routing',
    label: 'Routing',
    blurb: 'Domain + path + SSL + headers',
    isFilled: (m) => m.routes != null && m.routes.length > 0,
  },
  {
    id: 'previews',
    label: 'PR previews',
    blurb: 'Hostname template for preview envs',
    isFilled: (m) => m.previews != null && m.previews.enabled,
  },
  {
    id: 'volume',
    label: 'Volume',
    blurb: 'Mount path + backup schedule',
    isFilled: (m) => m.volume != null,
  },
  {
    id: 'database',
    label: 'Database',
    blurb: 'Attach a managed DB by slug',
    isFilled: (m) => m.database != null,
  },
  {
    id: 'network',
    label: 'Network',
    blurb: 'publishPort + internal network aliases',
    isFilled: (m) => m.network != null,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    blurb: 'Channel routing for deploy/fail/alert',
    isFilled: (m) =>
      m.notifications != null &&
      (m.notifications.onDeploy.length > 0 ||
        m.notifications.onFailure.length > 0 ||
        m.notifications.onAlert.length > 0),
  },
  {
    id: 'alerts',
    label: 'Alerts',
    blurb: 'Deploy-fail / restart-loop / high-mem rules',
    isFilled: (m) => m.alerts != null && m.alerts.length > 0,
  },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
