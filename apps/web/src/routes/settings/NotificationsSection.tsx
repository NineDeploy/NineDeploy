import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CirclePause, CirclePlay, Pencil, Send, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody, Input, cn } from '../../components/ui.js';
import { NotificationWizard } from '../../components/NotificationWizard.js';

/** Notifications: delivery channels (Telegram, Discord, Slack, ntfy, email, webhook). */
export function NotificationsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const channels = useQuery({ queryKey: ['notif-channels'], queryFn: () => api.notifications.listChannels() });
  const [showChannel, setShowChannel] = useState(false);
  const removeChannel = useMutation({ mutationFn: (id: number) => api.notifications.removeChannel(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['notif-channels'] }) });
  const testChannel = useMutation({ mutationFn: (id: number) => api.notifications.testChannel(id), onSuccess: () => toast('Test sent!', 'success'), onError: () => toast('Test failed', 'error') });
  // Channel editing: toggle active / rename / adjust the event filter.
  const [editChannel, setEditChannel] = useState<{ id: number; name: string; eventFilter: string } | null>(null);
  const updateChannel = useMutation({
    mutationFn: (input: { id: number; name?: string; eventFilter?: string; active?: boolean }) => {
      const { id, ...patch } = input;
      return api.notifications.updateChannel(id, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notif-channels'] });
      setEditChannel(null);
    },
    onError: () => toast('Could not update the channel', 'error'),
  });

  return (
    <Card className="mb-5">
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Notifications</h2>
          <Button size="sm" variant="secondary" onClick={() => setShowChannel(true)}>+ Add channel</Button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Get notified on deploy, alert, database, domain, backup events via Telegram, Discord, Slack, ntfy, email, or any webhook.
        </p>
        {showChannel && <NotificationWizard onClose={() => setShowChannel(false)} />}
        <div className="space-y-1.5">
          {channels.data?.map((ch) => (
            <div key={ch.id}>
              <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5">
                <div className="flex items-center gap-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium uppercase', ch.type === 'telegram' ? 'bg-sky-500/15 text-sky-300' : ch.type === 'discord' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-amber-500/15 text-amber-300')}>{ch.type}</span>
                  <span className="text-sm text-slate-200">{ch.name}</span>
                  {ch.eventFilter && <span className="font-mono text-[10px] text-slate-500">{ch.eventFilter}</span>}
                  {!ch.active && <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] text-slate-400">paused</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateChannel.mutate({ id: ch.id, active: !ch.active })}
                    className={cn('rounded p-1.5 hover:bg-white/5', ch.active ? 'text-emerald-400' : 'text-slate-500')}
                    title={ch.active ? 'Pause (deactivate)' : 'Activate'}
                  >
                    {ch.active ? <CirclePause size={13} /> : <CirclePlay size={13} />}
                  </button>
                  <button onClick={() => testChannel.mutate(ch.id)} className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-emerald-300" title="Send test"><Send size={13} /></button>
                  <button onClick={() => setEditChannel({ id: ch.id, name: ch.name, eventFilter: ch.eventFilter ?? '' })} className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-indigo-300" title="Edit"><Pencil size={13} /></button>
                  <button onClick={() => removeChannel.mutate(ch.id)} className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-rose-400" title="Remove"><Trash2 size={13} /></button>
                </div>
              </div>
              {editChannel !== null && editChannel.id === ch.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateChannel.mutate({ id: ch.id, name: editChannel.name.trim() || ch.name, eventFilter: editChannel.eventFilter });
                  }}
                  className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-indigo-500/[0.04] px-3 py-2 ring-1 ring-inset ring-indigo-500/20"
                >
                  <Input value={editChannel.name} onChange={(e) => setEditChannel({ ...editChannel, name: e.target.value })} placeholder="name" className="h-7 w-32 text-xs" aria-label="Channel name" />
                  <Input value={editChannel.eventFilter} onChange={(e) => setEditChannel({ ...editChannel, eventFilter: e.target.value })} placeholder="event filter (empty = all)" className="h-7 w-56 font-mono text-xs" aria-label="Event filter" />
                  <Button type="submit" size="sm" variant="ghost" className="ml-auto h-7 px-2 text-[11px]" disabled={updateChannel.isPending}>
                    {updateChannel.isPending ? '…' : 'Save'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setEditChannel(null)}>Cancel</Button>
                </form>
              )}
            </div>
          ))}
          {(!channels.data || channels.data.length === 0) && !showChannel && <p className="py-2 text-xs text-slate-600">No notification channels configured.</p>}
        </div>
      </CardBody>
    </Card>
  );
}
