'use client'

import { cn } from '@/lib/utils'

export type BillingChoice = 'monthly' | 'annual'

// Monthly / Annual switch for /pricing and /subscription. The selected option is
// filled with the primary color so nobody reads the wrong one as chosen.
export function BillingToggle({
  value,
  onChange,
  savingsPercent,
  className,
}: {
  value: BillingChoice
  onChange: (value: BillingChoice) => void
  savingsPercent: number
  className?: string
}) {
  const options: [BillingChoice, string][] = [
    ['monthly', 'Monthly'],
    ['annual', 'Annual'],
  ]
  return (
    <div role="group" aria-label="Billing period" className={cn('inline-flex rounded-lg border bg-muted p-1', className)}>
      {options.map(([k, label]) => {
        const active = value === k
        return (
          <button
            key={k}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(k)}
            className={cn(
              'inline-flex items-center rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
            {k === 'annual' && savingsPercent > 0 && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                  active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                )}
              >
                Save {savingsPercent}%
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
