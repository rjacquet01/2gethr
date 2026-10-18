import type { CSSProperties, ReactNode } from 'react'

// A wooden frame around a galvanized-metal sheet, drawn with CSS gradients
// only (no image assets). The metal grain is a tiny inline SVG noise filter.
const METAL_NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.52 0 0 0 0 0.55 0 0 0 0.35 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

const frameStyle: CSSProperties = {
  backgroundColor: '#8a5a2b',
  backgroundImage: [
    // fine grain streaks
    'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, rgba(0,0,0,0.06) 2px 3px, transparent 3px 9px)',
    // broader growth rings
    'repeating-linear-gradient(90deg, rgba(60,30,10,0.18) 0 1px, transparent 1px 23px, rgba(255,220,170,0.07) 23px 31px, transparent 31px 47px)',
    'linear-gradient(180deg, #a06a35 0%, #7d4f24 55%, #6b421d 100%)',
  ].join(','),
  boxShadow: 'inset 0 2px 0 rgba(255,235,200,0.25), inset 0 -3px 6px rgba(0,0,0,0.35), 0 10px 24px rgba(0,0,0,0.25)',
}

const metalStyle: CSSProperties = {
  backgroundColor: '#b9bec4',
  backgroundImage: [
    METAL_NOISE,
    // spangle / brushed sheen
    'repeating-linear-gradient(115deg, rgba(255,255,255,0.10) 0 6px, rgba(0,0,0,0.03) 6px 14px, transparent 14px 26px)',
    'radial-gradient(ellipse at 20% 15%, rgba(255,255,255,0.55), transparent 55%)',
    'radial-gradient(ellipse at 85% 90%, rgba(70,80,90,0.25), transparent 60%)',
    'linear-gradient(160deg, #d3d7db 0%, #aeb4ba 45%, #c4c9ce 100%)',
  ].join(','),
  boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(0,0,0,0.15)',
}

export function BoardSurface({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl p-2.5 sm:p-3.5" style={frameStyle}>
      <div className="min-h-[60vh] rounded-md p-3 sm:p-5" style={metalStyle}>
        {children}
      </div>
    </div>
  )
}
