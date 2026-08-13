import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, Trash2, Users as UsersIcon } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Card, EmptyState, Skeleton, cn } from '../components/ui.js';

export function Users() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const list = useQuery({ queryKey: ['users'], queryFn: () => api.users.list() });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: 'admin' | 'member' }) => api.users.setRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.users.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-2">
        <UsersIcon size={20} className="text-indigo-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-slate-400">Manage team members and roles.</p>
        </div>
      </div>

      {list.isLoading ? (
        <Card className="p-5"><Skeleton className="h-10 w-full" /></Card>
      ) : !list.data || list.data.length === 0 ? (
        <Card><EmptyState icon={<UsersIcon size={26} />} title="No users" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
                          {(u.email)[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-slate-200">
                            {u.email} {isMe && <span className="text-xs text-slate-500">(you)</span>}
                          </div>
                          {u.name && <div className="text-xs text-slate-500">{u.name}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => setRole.mutate({ id: u.id, role: u.role === 'admin' ? 'member' : 'admin' })}
                        disabled={isMe}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition',
                          u.role === 'admin' ? 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/20' : 'bg-slate-500/15 text-slate-300 ring-slate-500/20',
                          isMe ? 'cursor-default opacity-60' : 'hover:brightness-125',
                        )}
                        title={isMe ? 'Cannot change your own role' : `Toggle to ${u.role === 'admin' ? 'member' : 'admin'}`}
                      >
                        <Shield size={11} /> {u.role}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!isMe && (
                        <button
                          onClick={() => confirm(`Delete user ${u.email}?`) && remove.mutate(u.id)}
                          className="text-slate-600 transition hover:text-rose-400"
                          title="Delete user"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-xs text-slate-600">
        New users can register at <code className="text-slate-400">/v1/auth/register</code>. The first user is always admin. Toggle role badges to promote/demote. The last admin cannot be removed.
      </p>
    </div>
  );
}
