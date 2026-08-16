import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, FilePlus2, FileText, FolderPlus, Folder, HardDrive, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.js';
import { Button, Skeleton, cn } from './ui.js';
import { formatBytes } from '../lib/format.js';

/**
 * File manager for a single Docker volume: directory listing with breadcrumb
 * navigation, a text editor for files (base64 over the wire) and
 * mkdir/save/delete actions. Everything runs through the volume-files API,
 * which executes in a throwaway container — no host path exposure.
 */
export function VolumeBrowser({ volume, onClose }: { volume: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [cwd, setCwd] = useState('');
  const [editing, setEditing] = useState<{ path: string; text: string; dirty: boolean } | null>(null);

  const dir = useQuery({
    queryKey: ['volume-files', volume, cwd],
    queryFn: () => api.volumes.listFiles(volume, cwd),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['volume-files', volume] });
  };

  const del = useMutation({
    mutationFn: (path: string) => api.volumes.deleteFile(volume, path),
    onSuccess: (_r, path) => {
      // Deletes only run from the listing view, which replaces any open
      // editor — clearing unconditionally is safe and branch-free.
      setEditing(null);
      refresh();
      toast(`Deleted ${path.split('/').pop()}`, 'success');
    },
    onError: () => toast('Delete failed', 'error'),
  });

  const mkdir = useMutation({
    mutationFn: (path: string) => api.volumes.mkdir(volume, { path }),
    onSuccess: () => {
      refresh();
      toast('Folder created', 'success');
    },
    onError: () => toast('Could not create the folder', 'error'),
  });

  const open = useMutation({
    mutationFn: (path: string) => api.volumes.readFile(volume, path),
    onSuccess: (res, path) => {
      const text = res.encoding === 'base64' ? atob(res.content) : res.content;
      setEditing({ path, text, dirty: false });
    },
    onError: () => toast('Could not read the file (binary or >1 MB?)', 'error'),
  });

  const save = useMutation({
    // The Save button only renders while an editor is open, so `editing` is
    // guaranteed here. utf8 → base64 without growing argv.
    mutationFn: () =>
      api.volumes.writeFile(volume, {
        path: editing!.path,
        contentBase64: btoa(unescape(encodeURIComponent(editing!.text))),
      }),
    onSuccess: () => {
      // Save only fires from the editor, so the closed-over editor is open.
      setEditing({ ...editing!, dirty: false });
      refresh();
      toast('Saved', 'success');
    },
    onError: () => toast('Save failed', 'error'),
  });

  const crumbs = cwd ? cwd.split('/') : [];
  // The body below runs only when the query succeeded (loading/error handled
  // above), so data is present.
  const entriesEmpty = (dir.data?.entries ?? []).length === 0;

  // Escape closes the browser, like a native dialog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  const backdropProps = {
    onClick: onClose,
    onKeyDown,
    role: 'presentation' as const,
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" {...backdropProps}>
      <div
        role="dialog"
        aria-label={`Files in ${volume}`}
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <HardDrive size={15} className="text-amber-400" />
          <span className="truncate font-mono text-xs text-slate-300">{volume}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {editing ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setEditing(null)}><ArrowLeft size={13} /> Back</Button>
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !editing.dirty}>
                  <Save size={13} /> {save.isPending ? 'Saving…' : editing.dirty ? 'Save' : 'Saved'}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => {
                  const name = prompt('New folder name');
                  if (name) mkdir.mutate(cwd ? `${cwd}/${name}` : name);
                }}><FolderPlus size={13} /> Folder</Button>
                <Button size="sm" variant="secondary" onClick={() => {
                  const name = prompt('New file name');
                  if (!name) return;
                  setEditing({ path: cwd ? `${cwd}/${name}` : name, text: '', dirty: true });
                }}><FilePlus2 size={13} /> File</Button>
                <Button size="sm" variant="secondary" onClick={refresh} disabled={dir.isFetching}>
                  <RefreshCw size={13} className={dir.isFetching ? 'animate-spin' : undefined} />
                </Button>
              </>
            )}
            <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-slate-200" aria-label="Close volume browser">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* breadcrumb */}
        {!editing && (
          <div className="flex items-center gap-1 border-b border-white/[0.06] px-4 py-2 font-mono text-xs">
            <button type="button" onClick={() => setCwd('')} className="text-slate-400 hover:text-slate-200">/</button>
            {crumbs.map((c, i) => (
              <span key={crumbs.slice(0, i + 1).join('/')} className="flex items-center gap-1">
                <ChevronRight size={11} className="text-slate-600" />
                <button type="button" onClick={() => setCwd(crumbs.slice(0, i + 1).join('/'))} className={cn(i === crumbs.length - 1 ? 'text-slate-200' : 'text-slate-400 hover:text-slate-200')}>
                  {c}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* body */}
        {editing ? (
          <textarea
            value={editing.text}
            spellCheck={false}
            onChange={(e) => setEditing({ ...editing, text: e.target.value, dirty: true })}
            className="flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none"
            aria-label="File editor"
          />
        ) : dir.isLoading ? (
          <div className="flex-1 space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : dir.isError ? (
          <div className="grid flex-1 place-items-center text-sm text-slate-500">Couldn't open the volume.</div>
        ) : entriesEmpty ? (
          <div className="grid flex-1 place-items-center text-sm text-slate-500">Empty directory</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2">
            {dir.data!.entries.map((e) => {
              const full = cwd ? `${cwd}/${e.name}` : e.name;
              return (
                <div key={e.name} className="group flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-white/[0.03]">
                  {e.type === 'dir' ? (
                    <button type="button" onClick={() => setCwd(full)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <Folder size={15} className="shrink-0 text-amber-400/80" />
                      <span className="truncate text-sm text-slate-200">{e.name}</span>
                      <ChevronRight size={12} className="shrink-0 text-slate-600" />
                    </button>
                  ) : (
                    <button type="button" onClick={() => open.mutate(full)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" disabled={open.isPending}>
                      <FileText size={15} className="shrink-0 text-slate-500" />
                      <span className="truncate text-sm text-slate-300 group-hover:text-slate-100">{e.name}</span>
                    </button>
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-slate-600">{e.type === 'file' ? formatBytes(e.sizeBytes) : '—'}</span>
                  <button type="button"
                    onClick={() => { if (confirm(`Delete ${e.name}?${e.type === 'dir' ? ' (folder and everything in it)' : ''}`)) del.mutate(full); }}
                    className="shrink-0 text-slate-700 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
                    aria-label={`Delete ${e.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
