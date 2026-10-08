'use client'

import {
  Home, Building, Building2, GraduationCap, ShoppingBag, ShoppingCart, Heart, MapPin,
  Church, Dumbbell, Utensils, Coffee, TreePine, BookOpen, Bus, Train, Plane, Car, Bike,
  Music, Gamepad2, Baby, Dog, Cat, Cake, Star, Sun, Moon, Pizza, Store, Trophy, Palette,
  Camera, Film, Waves, Mountain, Tent, Anchor, Gift, PartyPopper, Rocket, Smile,
  Stethoscope, Briefcase, Flower2, Fish, Backpack, Hospital, Library, Landmark, Check,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Icons people can give their saved places. The first six keys are the
// original ones, kept so existing places keep their icon.
export const PLACE_ICONS: Record<string, LucideIcon> = {
  default: MapPin,
  home: Home,
  work: Building,
  school: GraduationCap,
  shopping: ShoppingBag,
  medical: Heart,
  office: Briefcase,
  apartment: Building2,
  store: Store,
  cart: ShoppingCart,
  food: Utensils,
  pizza: Pizza,
  coffee: Coffee,
  cake: Cake,
  party: PartyPopper,
  gift: Gift,
  gym: Dumbbell,
  trophy: Trophy,
  bike: Bike,
  park: TreePine,
  flower: Flower2,
  mountain: Mountain,
  camp: Tent,
  beach: Waves,
  boat: Anchor,
  fish: Fish,
  book: BookOpen,
  library: Library,
  backpack: Backpack,
  music: Music,
  games: Gamepad2,
  movie: Film,
  art: Palette,
  camera: Camera,
  church: Church,
  landmark: Landmark,
  hospital: Hospital,
  doctor: Stethoscope,
  baby: Baby,
  dog: Dog,
  cat: Cat,
  car: Car,
  bus: Bus,
  train: Train,
  plane: Plane,
  star: Star,
  sun: Sun,
  moon: Moon,
  smile: Smile,
  rocket: Rocket,
}

export function getPlaceIcon(key?: string | null): LucideIcon {
  return (key && PLACE_ICONS[key]) || MapPin
}

// Named swatches (hex) used anywhere people pick a color.
export const COLOR_PALETTE: { name: string; value: string }[] = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Sky', value: '#0EA5E9' },
  { name: 'Cyan', value: '#06B6D4' },
  { name: 'Teal', value: '#14B8A6' },
  { name: 'Green', value: '#10B981' },
  { name: 'Lime', value: '#84CC16' },
  { name: 'Yellow', value: '#EAB308' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Rose', value: '#F43F5E' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Fuchsia', value: '#D946EF' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Navy', value: '#1E3A8A' },
  { name: 'Brown', value: '#92400E' },
  { name: 'Slate', value: '#64748B' },
  { name: 'Charcoal', value: '#334155' },
  { name: 'Mint', value: '#6EE7B7' },
  { name: 'Peach', value: '#FDBA74' },
  { name: 'Lavender', value: '#C4B5FD' },
  { name: 'Bubblegum', value: '#F9A8D4' },
  { name: 'Sunshine', value: '#FDE047' },
]

interface ColorPickerProps {
  value?: string | null
  onChange: (value: string) => void
  /** When provided, shows a "Default" swatch that calls this. */
  onClear?: () => void
  clearLabel?: string
}

export function ColorPicker({ value, onChange, onClear, clearLabel = 'Default' }: ColorPickerProps) {
  const current = (value || '').toUpperCase()
  const isPaletteColor = COLOR_PALETTE.some((c) => c.value.toUpperCase() === current)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            title={clearLabel}
            className={cn(
              'h-8 rounded-full border-2 px-3 text-xs font-medium',
              !value ? 'border-foreground' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {clearLabel}
          </button>
        )}
        {COLOR_PALETTE.map((c) => {
          const selected = current === c.value.toUpperCase()
          return (
            <button
              key={c.value}
              type="button"
              title={c.name}
              aria-label={c.name}
              onClick={() => onChange(c.value)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform hover:scale-110',
                selected ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: c.value }}
            >
              {selected && <Check className="h-4 w-4 text-white drop-shadow" />}
            </button>
          )
        })}
        <label
          title="Pick any color"
          className={cn(
            'relative flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 text-xs font-medium',
            value && !isPaletteColor ? 'border-foreground' : 'border-border hover:bg-muted',
          )}
        >
          <span
            className="h-4 w-4 rounded-full border border-border"
            style={{
              background: value && !isPaletteColor
                ? value
                : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
            }}
          />
          Custom
          <input
            type="color"
            value={value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#3B82F6'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Pick a custom color"
          />
        </label>
      </div>
    </div>
  )
}

interface IconPickerProps {
  value?: string | null
  onChange: (key: string) => void
  color?: string
}

export function IconPicker({ value, onChange, color }: IconPickerProps) {
  const selectedKey = value || 'default'
  return (
    <div className="grid max-h-48 grid-cols-7 gap-1.5 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-9">
      {Object.entries(PLACE_ICONS).map(([key, Icon]) => {
        const selected = selectedKey === key
        return (
          <button
            key={key}
            type="button"
            title={key}
            aria-label={key}
            onClick={() => onChange(key)}
            className={cn(
              'flex aspect-square items-center justify-center rounded-lg border transition-colors',
              selected ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted',
            )}
          >
            <Icon className="h-5 w-5" style={selected && color ? { color } : undefined} />
          </button>
        )
      })}
    </div>
  )
}
