/** Brand mark: navy hexagon terminal bubble with the 2×2 teal panes. */
export function Logo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <polygon
        points="24,3 43,14 43,34 24,45 5,34 5,14"
        fill="#1E2A3A"
        stroke="#1E2A3A"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M7 36 q-2 6 5 6"
        fill="none"
        stroke="#1E2A3A"
        strokeWidth="3"
        strokeLinecap="round"
        className="[stroke:#22324e] dark:[stroke:#1E2A3A]"
      />
      <rect x="12" y="13" width="24" height="18" rx="3" fill="#ffffff" />
      <rect x="15.5" y="16.5" width="7.5" height="4.5" rx="1" fill="#4ECDC4" />
      <rect x="25" y="16.5" width="7.5" height="4.5" rx="1" fill="#17948A" />
      <rect x="15.5" y="23" width="7.5" height="4.5" rx="1" fill="#17948A" />
      <rect x="25" y="23" width="7.5" height="4.5" rx="1" fill="#4ECDC4" />
    </svg>
  );
}
