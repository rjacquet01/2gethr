// A small round push pin seen from slightly above, in any color.
export function PushPin({ color, className = '' }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 28" width="22" height="26" aria-hidden="true" className={className}>
      <ellipse cx="13" cy="25" rx="5" ry="2" fill="rgba(0,0,0,0.25)" />
      <path d="M12 14 L13.2 25" stroke="#8f959b" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="10" r="8" fill={color} />
      <circle cx="12" cy="10" r="8" fill="url(#pinShade)" />
      <ellipse cx="9.2" cy="7" rx="2.6" ry="1.8" fill="rgba(255,255,255,0.55)" />
      <defs>
        <radialGradient id="pinShade" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="rgba(255,255,255,0)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.35)" />
        </radialGradient>
      </defs>
    </svg>
  )
}

// A strip of semi-transparent tape, for sticky notes that aren't pinned.
export function Tape({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-4 w-14 rounded-[2px] ${className}`}
      style={{ background: 'rgba(255,255,240,0.6)', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
    />
  )
}
