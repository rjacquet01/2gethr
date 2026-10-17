import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// Kids are CHILD family_members rows. Those with their own login have a
// user_id ("Has account"); those without are managed by a parent and can't
// get push alerts, share live location or answer emergency alerts.
// Shown to parents and guardians only; callers decide who sees it.
export const NO_ACCOUNT_HINT = 'Managed by you. This child has no login.'
const HAS_ACCOUNT_HINT = 'This child signs in with their own login.'

export function AccountStatusBadge({
  hasAccount,
  showHint = false,
  className,
}: {
  hasAccount: boolean
  /** Also print the one-line explanation next to a "No account" badge. */
  showHint?: boolean
  className?: string
}) {
  const hint = hasAccount ? HAS_ACCOUNT_HINT : NO_ACCOUNT_HINT
  const badge = (
    <Badge
      variant="outline"
      title={hint}
      aria-label={hasAccount ? `Has account. ${hint}` : `No account. ${hint}`}
      className={cn(
        'shrink-0 px-1.5 py-0 text-[10px] font-normal',
        hasAccount ? 'text-muted-foreground' : 'border-dashed text-muted-foreground',
        className
      )}
    >
      {hasAccount ? 'Has account' : 'No account'}
    </Badge>
  )
  if (!showHint || hasAccount) return badge
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      {badge}
      <span className="text-[11px] text-muted-foreground">{NO_ACCOUNT_HINT}</span>
    </span>
  )
}
