import { Boxes, Database, LogOut, Server } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth.js';
import { BrandMark, Button, cn } from './ui.js';

const NAV = [
  { to: '/', label: 'Services', icon: Server, exact: true },
  { to: '/databases', label: 'Databases', icon: Database, exact: false },
];

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.015] backdrop-blur-sm md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <BrandMark size={30} />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">NineDeploy</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Control Plane</div>
          </div>
        </div>

        <nav className="mt-2 flex-1 px-3">
          <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-widest text-slate-600">Workspace</p>
          {NAV.map((item) => {
            const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'group mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition',
                  active ? 'bg-white/[0.07] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
                )}
              >
                <Icon size={16} className={active ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
              {(user?.email ?? '?')[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-medium text-slate-200">{user?.email}</div>
              <div className="text-[10px] capitalize text-slate-500">{user?.role}</div>
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={logout} title="Sign out">
              <LogOut size={15} />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <BrandMark size={26} />
            <span className="font-semibold tracking-tight">NineDeploy</span>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={logout} title="Sign out">
            <LogOut size={15} />
          </Button>
        </header>
        <main className="nd-fade mx-auto w-full max-w-6xl flex-1 px-5 py-8 md:px-8">
          <Outlet />
        </main>
        <footer className="flex items-center justify-center gap-1.5 px-5 py-4 text-center text-[11px] text-slate-600">
          <Boxes size={12} /> NineDeploy · self-hosted deployments
        </footer>
      </div>
    </div>
  );
}
