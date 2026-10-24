import Image from 'next/image'
import { cn } from '@/lib/utils'

// The Togethr logotype is "Togethr" with the logo T (orange dot) as its first
// letter, so it is never paired with the T-mark or the word "Togethr". The mark
// alone is for narrow spots (under ~90px: small mobile headers).
// tone: "color" on light backgrounds, "reversed" on dark/navy ones, "auto"
// follows the app's light/dark theme (the html.dark class).

export type BrandVariant = 'logotype' | 'mark'
export type BrandTone = 'color' | 'reversed'

export const BRAND_ALT = 'Togethr'
export const BRAND_MOTTO = 'Connect people, connect events.'

// Intrinsic artwork sizes (the SVG viewBoxes), used for the aspect ratio.
const ART: Record<BrandVariant, { file: string; width: number; height: number }> = {
  logotype: { file: 'logotype', width: 1886, height: 574 },
  mark: { file: 'mark', width: 827, height: 647 },
}

export function brandLogoSrc(variant: BrandVariant, tone: BrandTone): string {
  return `/brand/${ART[variant].file}-${tone}.svg`
}

/** Rendered width for a given height, keeping the artwork's aspect ratio. */
export function brandLogoWidth(variant: BrandVariant, height: number): number {
  const a = ART[variant]
  return Math.round((height * a.width) / a.height)
}

interface LogoProps {
  variant?: BrandVariant
  tone?: BrandTone | 'auto'
  /** Height in px; width follows the artwork. */
  height?: number
  className?: string
  priority?: boolean
}

export function Logo({ variant = 'logotype', tone = 'auto', height = 28, className, priority }: LogoProps) {
  const width = brandLogoWidth(variant, height)
  const img = (t: BrandTone, extra?: string) => (
    <Image
      src={brandLogoSrc(variant, t)}
      alt={BRAND_ALT}
      width={width}
      height={height}
      priority={priority}
      unoptimized
      className={cn('shrink-0', extra, className)}
      style={{ width, height }}
    />
  )
  if (tone !== 'auto') return img(tone)
  // Both are in the page; CSS shows the one for the current theme (no flash, no layout shift).
  return (
    <>
      {img('color', 'dark:hidden')}
      {img('reversed', 'hidden dark:block')}
    </>
  )
}
