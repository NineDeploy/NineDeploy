import { Link } from "react-router";
import { Home } from "lucide-react";

export function NotFound() {
  return (
    <section className="grid-bg min-h-[70vh] grid place-items-center px-4">
      <div className="text-center">
        <div className="font-mono text-7xl md:text-9xl font-bold text-phosphor-dim">404</div>
        <p className="mt-4 font-mono text-sm text-zinc-500">
          $ cd /this/page <span className="text-pink-term">&&</span> ls
          <br />
          ls: no such file or directory
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-2 font-mono font-bold border-2 border-ink bg-ink text-white dark:border-phosphor dark:bg-phosphor dark:text-void px-6 py-3 hover:-translate-y-0.5 transition-transform"
        >
          <Home size={15} /> cd ~/
        </Link>
      </div>
    </section>
  );
}
