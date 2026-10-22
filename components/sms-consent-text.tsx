import Link from 'next/link'
import { SMS_CONSENT_TEXT } from '@/lib/sms-consent-text'
import { cn } from '@/lib/utils'

const TAIL = ' See our Terms and Privacy Policy.'

/** The SMS opt-in wording, word for word, with Terms and Privacy linked. */
export function SmsConsentText({ id, className }: { id?: string; className?: string }) {
  const lead = SMS_CONSENT_TEXT.endsWith(TAIL) ? SMS_CONSENT_TEXT.slice(0, -TAIL.length) : SMS_CONSENT_TEXT
  return (
    <p id={id} className={cn('text-xs leading-snug text-muted-foreground', className)}>
      {lead} See our{' '}
      <Link href="/terms#sms" className="underline hover:text-foreground">
        Terms
      </Link>{' '}
      and{' '}
      <Link href="/privacy#sms" className="underline hover:text-foreground">
        Privacy Policy
      </Link>
      .
    </p>
  )
}
