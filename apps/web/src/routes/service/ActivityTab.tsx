import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, Download } from 'lucide-react';
import { api, getToken } from '../../lib/api.js';
import { downloadBlob, formatDateTime } from '../../lib/format.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody, Skeleton } from '../../components/ui.js';

type ActivityRow = { id: number; userId: number; action: string; entity: string; ts: string };

/** Audit trail for one service (filtered server-side via ?entity=). */
export function ActivityTab({ serviceId, name }: { serviceId: number; name: string }) {
  const { toast } = useToast();
  const activity = useQuery({
    queryKey: ['activity', serviceId],
    queryFn: async () => (await api.activity.list(name)) as ActivityRow[],
    refetchInterval: 10000,
  });

  const exportBundle = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.services.exportUrl(serviceId), { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new Error('Export failed');
      downloadBlob(await res.blob(), `${name}-export.json`);
    },
    onSuccess: () => toast('Service exported', 'success'),
    onError: () => toast('Export failed', 'error'),
  });

  return (
    <Card className="mt-5">
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <Activity size={15} className="text-slate-500" /> Activity
          </div>
          <Button size="sm" variant="ghost" onClick={() => exportBundle.mutate()} disabled={exportBundle.isPending}>
            <Download size={13} /> Export bundle
          </Button>
        </div>
        {activity.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !activity.data || activity.data.length === 0 ? (
          <p className="py-2 text-xs text-slate-600">No recorded activity for this service yet.</p>
        ) : (
          <ul className="space-y-1">
            {activity.data.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 text-xs ring-1 ring-inset ring-white/5"
              >
                <span className="font-mono text-slate-300">{r.action}</span>
                <span className="text-slate-500">{formatDateTime(r.ts)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-slate-600">Auto-refreshes every 10s · audit log retained 90 days.</p>
      </CardBody>
    </Card>
  );
}
