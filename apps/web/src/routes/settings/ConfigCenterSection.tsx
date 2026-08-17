import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Edit2, Eye, EyeOff, KeyRound, Plus, RefreshCw, Search, Shield, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ConfigItem } from '@ninedeploy/sdk';
import { Button, Card, CardBody, Input, Modal, Skeleton } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';

function formatConfigValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function ConfigCenterSection() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();

  const [revealSecrets, setRevealSecrets] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingItem, setEditingItem] = useState<ConfigItem | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New config form state
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newIsSecret, setNewIsSecret] = useState(false);
  const [newCategory, setNewCategory] = useState('general');
  const [newDescription, setNewDescription] = useState('');
  const [newTags, setNewTags] = useState('');

  const configQuery = useQuery({
    queryKey: ['config-entries', revealSecrets],
    queryFn: () => api.config.list({ reveal: revealSecrets }),
    staleTime: 5000,
  });

  const saveMutation = useMutation({
    mutationFn: ({ key, value, isSecret, description, tags }: { key: string; value: unknown; isSecret?: boolean; description?: string; tags?: string[] }) =>
      api.config.set(key, { value, isSecret, description, tags }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-entries'] });
      setEditingItem(null);
      setIsAddModalOpen(false);
      resetNewForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => api.config.delete(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-entries'] });
    },
  });

  function resetNewForm() {
    setNewKey('');
    setNewValue('');
    setNewIsSecret(false);
    setNewCategory('general');
    setNewDescription('');
    setNewTags('');
  }

  const entries = configQuery.data?.entries ?? [];
  const categories = Array.from(new Set(['all', ...entries.map((e) => e.category)])).sort();

  const filtered = entries.filter((item) => {
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchKey = item.key.toLowerCase().includes(q);
      const matchLabel = item.label.toLowerCase().includes(q);
      const matchDesc = item.description?.toLowerCase().includes(q) ?? false;
      const matchTags = item.tags.some((t) => t.toLowerCase().includes(q));
      if (!matchKey && !matchLabel && !matchDesc && !matchTags) return false;
    }
    return true;
  });

  return (
    <>
      <Card className="mb-5">
        <CardBody>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Configuration Center</h2>
              <p className="text-xs text-slate-400">
                Centralized settings vault with isolated namespaces, AES-256-GCM encryption, and live watchers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <>
                  <Button
                    variant={revealSecrets ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={() => setRevealSecrets(!revealSecrets)}
                    title={revealSecrets ? 'Mask secrets' : 'Reveal secrets (Admin)'}
                  >
                    {revealSecrets ? <EyeOff size={14} className="mr-1.5" /> : <Eye size={14} className="mr-1.5" />}
                    {revealSecrets ? 'Hide Secrets' : 'Reveal Secrets'}
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setIsAddModalOpen(true)}>
                    <Plus size={14} className="mr-1.5" />
                    New Setting
                  </Button>
                </>
              )}
              <Button
                variant="secondary"
                size="sm"
                aria-label="Refresh config"
                onClick={() => configQuery.refetch()}
                disabled={configQuery.isFetching}
              >
                <RefreshCw size={14} className={configQuery.isFetching ? 'animate-spin' : ''} />
              </Button>
            </div>
          </div>

          {/* Filters & Search */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    categoryFilter === cat
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                type="text"
                placeholder="Search keys, labels, tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-xs"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Entries List */}
      <Card className="mb-5">
        <CardBody className="p-0">
          {configQuery.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No configuration entries found matching your filters.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {filtered.map((item) => (
                <div key={item.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between hover:bg-white/[0.01]">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-200">{item.key}</span>
                      {item.isSecret ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/20">
                          <KeyRound size={10} /> Secret
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
                          <Shield size={10} /> Public
                        </span>
                      )}
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                        {item.category}
                      </span>
                      {item.pluginId && (
                        <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400 border border-indigo-500/20">
                          plugin:{item.pluginId}
                        </span>
                      )}
                      {!item.isConfigured && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 italic">
                          default
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-slate-400">{item.description}</p>
                    )}
                    {item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map((t) => (
                          <span key={t} className="text-[10px] text-slate-500">#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="max-w-xs truncate font-mono text-xs bg-black/40 rounded px-2.5 py-1.5 border border-white/[0.06] text-slate-300">
                      {formatConfigValue(item.value)}
                    </div>

                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingItem(item);
                            setEditValue(formatConfigValue(item.value));
                          }}
                          className="rounded p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200 transition-colors"
                          title="Edit Value"
                        >
                          <Edit2 size={14} />
                        </button>
                        {item.isConfigured && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Delete config key "${item.key}"?`)) {
                                deleteMutation.mutate(item.key);
                              }
                            }}
                            className="rounded p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Edit Modal */}
      {editingItem && (
        <Modal
          title={`Edit Config: ${editingItem.key}`}
          onClose={() => setEditingItem(null)}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Value ({editingItem.type})</label>
              <Input
                type={editingItem.isSecret && !revealSecrets ? 'password' : 'text'}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="Enter value"
                autoFocus
              />
            </div>
            {editingItem.description && (
              <p className="text-xs text-slate-500">{editingItem.description}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditingItem(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={saveMutation.isPending}
                onClick={() => {
                  let val: unknown = editValue;
                  if (editingItem.type === 'number') val = Number(editValue);
                  if (editingItem.type === 'boolean') val = editValue === 'true' || editValue === '1';
                  if (editingItem.type === 'json') {
                    try {
                      val = JSON.parse(editValue);
                    } catch {
                      alert('Invalid JSON format');
                      return;
                    }
                  }
                  saveMutation.mutate({
                    key: editingItem.key,
                    value: val,
                    isSecret: editingItem.isSecret,
                    description: editingItem.description,
                    tags: editingItem.tags,
                  });
                }}
              >
                <Check size={14} className="mr-1.5" /> Save Changes
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add New Setting Modal */}
      {isAddModalOpen && (
        <Modal
          title="Create Configuration Key"
          onClose={() => setIsAddModalOpen(false)}
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Key Name</label>
              <Input
                type="text"
                placeholder="e.g. system.custom_timeout or plugin:my-plugin:api_key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Value</label>
              <Input
                type={newIsSecret ? 'password' : 'text'}
                placeholder="Setting value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Category</label>
                <Input
                  type="text"
                  placeholder="general, security, network..."
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                />
              </div>
              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsSecret}
                    onChange={(e) => setNewIsSecret(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Encrypt as Secret (AES-256)</span>
                </label>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Description (optional)</label>
              <Input
                type="text"
                placeholder="Brief description of this setting"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Tags (comma-separated)</label>
              <Input
                type="text"
                placeholder="e.g. timeout, critical, cloudflare"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!newKey || saveMutation.isPending}
                onClick={() => {
                  const tags = newTags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean);
                  saveMutation.mutate({
                    key: newKey,
                    value: newValue,
                    isSecret: newIsSecret,
                    description: newDescription || undefined,
                    tags,
                  });
                }}
              >
                <Plus size={14} className="mr-1.5" /> Create Setting
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
