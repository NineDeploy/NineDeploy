import { NavLink, Outlet, Link } from "react-router";
import { BookOpen, Info, TriangleAlert, ArrowRight } from "lucide-react";
import { docs, docGroups, type Doc, type Block } from "../docs";
import { CodeBlock } from "../components/CodeBlock";

export { docs as docPages };

export function DocsLayout() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 lg:grid lg:grid-cols-[240px_1fr] gap-10">
      <aside className="hidden lg:block">
        <div className="sticky top-24 thin-scroll max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-zinc-500 mb-3">
            <BookOpen size={13} /> docs
          </div>
          {docGroups.map((g) => (
            <div key={g} className="mb-5">
              <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600 mb-1.5">
                {g}
              </div>
              <nav className="flex flex-col border-l-2 border-black/10 dark:border-line">
                {docs
                  .filter((d) => d.group === g)
                  .map((d) => (
                    <NavLink
                      key={d.slug}
                      to={`/docs/${d.slug}`}
                      className={({ isActive }) =>
                        `pl-3 py-1.5 text-sm font-mono -ml-[2px] border-l-2 transition-colors ${
                          isActive
                            ? "border-ink dark:border-phosphor font-bold"
                            : "border-transparent text-[#4a5c73] dark:text-zinc-400 hover:text-ink dark:hover:text-phosphor"
                        }`
                      }
                    >
                      {d.title}
                    </NavLink>
                  ))}
              </nav>
            </div>
          ))}
        </div>
      </aside>

      {/* mobile doc picker */}
      <div className="lg:hidden mb-8 flex gap-2 overflow-x-auto pb-2 thin-scroll">
        {docs.map((d) => (
          <NavLink
            key={d.slug}
            to={`/docs/${d.slug}`}
            className={({ isActive }) =>
              `whitespace-nowrap font-mono text-xs border-2 px-3 py-1.5 ${
                isActive
                  ? "border-ink bg-ink text-white dark:border-phosphor dark:bg-phosphor dark:text-void"
                  : "border-edge dark:border-line"
              }`
            }
          >
            {d.title}
          </NavLink>
        ))}
      </div>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export function DocPage({ doc }: { doc: Doc }) {
  const idx = docs.findIndex((d) => d.slug === doc.slug);
  const prev = docs[idx - 1];
  const next = docs[idx + 1];

  return (
    <article className="max-w-3xl">
      <div className="tag mb-3">{doc.group}</div>
      <h1 className="text-3xl md:text-5xl font-bold tracking-tight">{doc.title}</h1>
      <p className="mt-3 text-zinc-500 dark:text-zinc-400 font-mono text-sm">{doc.description}</p>
      <div className="mt-8 space-y-4">
        {doc.blocks.map((b) => (
          <BlockView key={blockKey(b)} block={b} />
        ))}
      </div>

      <nav className="mt-14 grid grid-cols-2 gap-4 border-t-2 border-edge dark:border-line pt-6">
        {prev ? (
          <Link to={`/docs/${prev.slug}`} className="font-mono text-sm group">
            <span className="text-zinc-500 text-xs uppercase tracking-widest">← prev</span>
            <div className="link-underline font-bold">{prev.title}</div>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={`/docs/${next.slug}`} className="font-mono text-sm text-right group">
            <span className="text-zinc-500 text-xs uppercase tracking-widest">next →</span>
            <div className="link-underline font-bold flex items-center justify-end gap-1">
              {next.title} <ArrowRight size={13} />
            </div>
          </Link>
        )}
      </nav>
    </article>
  );
}

function blockKey(b: Block): string {
  return `${b.kind}:${"text" in b && b.text ? b.text : "code"}`;
}

function BlockView({ block: b }: { block: Block }) {
  switch (b.kind) {
    case "h2":
      return (
        <h2 className="pt-6 text-2xl font-bold tracking-tight flex items-center gap-3">
          <span className="w-2 h-2 bg-phosphor-dim" />
          {b.text}
        </h2>
      );
    case "h3":
      return <h3 className="pt-2 text-lg font-bold">{b.text}</h3>;
    case "p":
      return <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{b.text}</p>;
    case "list":
      return (
        <ul className="space-y-2">
          {b.items.map((it) => (
            <li key={it} className="flex gap-3 text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {it}
            </li>
          ))}
        </ul>
      );
    case "code":
      return <CodeBlock file={b.file}>{b.body}</CodeBlock>;
    case "callout":
      return (
        <div
          className={`panel px-5 py-4 my-6 flex gap-3 ${
            b.tone === "warn" ? "border-amber-term" : ""
          }`}
        >
          {b.tone === "warn" ? (
            <TriangleAlert size={18} className="text-amber-term shrink-0 mt-0.5" />
          ) : (
            <Info size={18} className="text-cyan-term shrink-0 mt-0.5" />
          )}
          <div>
            <div className="font-bold text-sm">{b.title}</div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">{b.text}</p>
          </div>
        </div>
      );
  }
}
