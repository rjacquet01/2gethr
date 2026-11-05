'use client'

import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * In-app time picker that replaces <input type="time">.
 *
 * The native picker is drawn by the phone OS and on some Android devices its
 * OK/Set button is pushed off screen. This one uses three dropdowns
 * (hour, minute, AM/PM) that commit as soon as an option is chosen, so there
 * is nothing to confirm.
 *
 * value / onChange use 24-hour "HH:mm" strings (same as <input type="time">),
 * and "" means no time chosen.
 */

interface TimeSelectProps {
  id?: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
  /** Minute step shown in the list (current minute is always kept). Default 5. */
  minuteStep?: number
  className?: string
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)

function parse(value: string): { hour12: number; minute: number; pm: boolean } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value || '')
  if (!m) return null
  const h = Number(m[1])
  const minute = Number(m[2])
  if (Number.isNaN(h) || Number.isNaN(minute) || h > 23 || minute > 59) return null
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute, pm: h >= 12 }
}

function build(hour12: number, minute: number, pm: boolean): string {
  const h24 = (hour12 % 12) + (pm ? 12 : 0)
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function TimeSelect({
  id,
  value,
  onChange,
  required,
  disabled,
  minuteStep = 5,
  className,
}: TimeSelectProps) {
  const parsed = parse(value)

  const minutes = React.useMemo(() => {
    const list: number[] = []
    for (let m = 0; m < 60; m += minuteStep) list.push(m)
    if (parsed && !list.includes(parsed.minute)) {
      list.push(parsed.minute)
      list.sort((a, b) => a - b)
    }
    return list
  }, [minuteStep, parsed])

  // Picking any part of an empty time fills in sensible defaults for the rest.
  const base = parsed ?? { hour12: 9, minute: 0, pm: false }

  return (
    <div
      id={id}
      role="group"
      aria-required={required || undefined}
      className={cn('flex items-center gap-2', className)}
    >
      <Select
        disabled={disabled}
        value={parsed ? String(parsed.hour12) : ''}
        onValueChange={(v) => onChange(build(Number(v), base.minute, base.pm))}
      >
        <SelectTrigger className="flex-1" aria-label="Hour">
          <SelectValue placeholder="Hr" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {HOURS.map((h) => (
            <SelectItem key={h} value={String(h)}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground">:</span>

      <Select
        disabled={disabled}
        value={parsed ? String(parsed.minute) : ''}
        onValueChange={(v) => onChange(build(base.hour12, Number(v), base.pm))}
      >
        <SelectTrigger className="flex-1" aria-label="Minute">
          <SelectValue placeholder="Min" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {minutes.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {String(m).padStart(2, '0')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        disabled={disabled}
        value={parsed ? (parsed.pm ? 'PM' : 'AM') : ''}
        onValueChange={(v) => onChange(build(base.hour12, base.minute, v === 'PM'))}
      >
        <SelectTrigger className="flex-1" aria-label="AM or PM">
          <SelectValue placeholder="AM/PM" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
