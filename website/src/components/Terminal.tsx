import { useEffect, useRef, useState } from "react";

export type TermLine = { text: string; tone?: "ok" | "warn" | "err" | "dim" | "accent" };

const toneClass: Record<NonNullable<TermLine["tone"]>, string> = {
  ok: "text-phosphor-dim",
  warn: "text-amber-term",
  err: "text-pink-term",
  dim: "text-zinc-500",
  accent: "text-cyan-term",
};

/**
 * Terminal window that "types out" an annotated deploy log line by line.
 * Replays forever — the hero centerpiece.
 */
export function Terminal({
  title = "ninedeploy — deploy #47",
  lines,
  speed = 420,
}: {
  title?: string;
  lines: TermLine[];
  speed?: number;
}) {
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shown >= lines.length) {
      const restart = setTimeout(() => {
        setShown(0);
        setTyped(0);
      }, 6000);
      return () => clearTimeout(restart);
    }
    const current = lines[shown]?.text ?? "";
    if (typed < current.length) {
      const t = setTimeout(() => setTyped((n) => n + 1), 14);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setShown((n) => n + 1);
      setTyped(0);
    }, speed);
    return () => clearTimeout(t);
  }, [shown, typed, lines, speed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the log scrolled while typing
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [shown, typed]);

  return (
    <div className="panel panel-hard scanline relative overflow-hidden">
      <div className="flex items-center gap-2 border-b-2 border-line px-4 py-2.5">
        <span className="w-3 h-3 rounded-full bg-pink-term" />
        <span className="w-3 h-3 rounded-full bg-amber-term" />
        <span className="w-3 h-3 rounded-full bg-phosphor-dim" />
        <span className="ml-3 font-mono text-xs text-zinc-500 truncate">{title}</span>
      </div>
      <div
        ref={bodyRef}
        className="h-80 md:h-96 overflow-hidden px-4 py-3 font-mono text-[12.5px] md:text-sm leading-relaxed"
      >
        {lines.slice(0, shown).map((l) => (
          <div key={`${l.text}-${l.tone ?? "dim"}`} className={toneClass[l.tone ?? "dim"]}>
            {l.text}
          </div>
        ))}
        {shown < lines.length && (
          <div className={toneClass[lines[shown]?.tone ?? "dim"]}>
            {(lines[shown]?.text ?? "").slice(0, typed)}
            <span className="inline-block w-2 h-4 -mb-0.5 bg-phosphor animate-blink" />
          </div>
        )}
      </div>
    </div>
  );
}
