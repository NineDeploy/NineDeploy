import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { ProjectEntry } from '@ninedeploy/sdk';

/**
 * Global project scope (the Dokploy #2805 problem, solved differently):
 * one switcher in the top bar filters every project-aware page. Selection
 * persists in localStorage; `null` means "All projects".
 */

const STORAGE_KEY = 'ninedeploy.projectId';

interface ProjectScope {
  /** All projects (empty list while loading). */
  projects: ProjectEntry[];
  /** Selected project id, or null for "All projects". */
  selectedId: number | null;
  /** The selected project row (null when "All" or still loading). */
  selected: ProjectEntry | null;
  select: (id: number | null) => void;
}

const ProjectContext = createContext<ProjectScope | null>(null);

function readStoredId(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function ProjectScopeProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<number | null>(readStoredId);
  // The api client is imported dynamically: test helpers mock `lib/api.js`
  // with a factory that itself imports this module, and a static import
  // here would form a module-resolution cycle that deadlocks vitest.
  // `?? []` keeps the provider resilient when the call resolves to nothing
  // (mocks, empty 2xx bodies).
  const { data } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await (await import('./api.js')).api.projects.list()) ?? [],
  });

  const projects = data ?? [];
  // Drop a stored selection that no longer exists (deleted project).
  useEffect(() => {
    if (selectedId != null && data != null && !data.some((p) => p.id === selectedId)) {
      setSelectedId(null);
    }
  }, [data, selectedId]);

  const select = useCallback((id: number | null) => {
    setSelectedId(id);
    try {
      if (id == null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      /* ignore (privacy mode) */
    }
  }, []);

  const selected = selectedId != null ? projects.find((p) => p.id === selectedId) ?? null : null;

  return (
    <ProjectContext.Provider value={{ projects, selectedId, selected, select }}>{children}</ProjectContext.Provider>
  );
}

/** Fallback scope when rendered outside the provider (storybooks, bare tests): "All projects". */
const FALLBACK: ProjectScope = {
  projects: [],
  selectedId: null,
  selected: null,
  select: () => {},
};

export function useProjectScope(): ProjectScope {
  return useContext(ProjectContext) ?? FALLBACK;
}
