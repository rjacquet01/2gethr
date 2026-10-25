'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bug, Lightbulb, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { authFetch } from '@/hooks/use-events'
import { useFamilies } from '@/hooks/use-family'
import { detectAndroidApp } from '@/hooks/use-purchase-ui'
import { cn } from '@/lib/utils'

// Quick feedback from anywhere in the app. Files a support ticket (the admin
// Support Tickets queue and email) with the page and device attached, so
// nobody has to describe where they were.
const KINDS = [
  { value: 'bug', label: 'Something broke', icon: Bug, category: 'TECHNICAL' },
  { value: 'idea', label: 'Idea', icon: Lightbulb, category: 'FEATURE_REQUEST' },
  { value: 'other', label: 'Other', icon: MessageCircle, category: 'OTHER' },
] as const

const MAX_LENGTH = 2000

export function feedbackContext(page: string, androidApp: boolean, userAgent: string, screen: string, build?: string): string {
  return [
    `Page: ${page}`,
    `App: ${androidApp ? 'Android app' : 'Browser'}${build ? ` (build ${build.slice(0, 7)})` : ''}`,
    `Screen: ${screen}`,
    `Device: ${userAgent.slice(0, 200)}`,
  ].join('\n')
}

export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname()
  const { families } = useFamilies()
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('bug')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const send = async () => {
    const message = text.trim()
    if (!message) return
    const selected = KINDS.find((k) => k.value === kind)!
    const context = feedbackContext(
      pathname,
      detectAndroidApp(),
      navigator.userAgent,
      `${window.innerWidth}x${window.innerHeight}`,
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
    )
    const firstLine = message.split('\n')[0]
    setSending(true)
    try {
      const res = await authFetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: `Feedback: ${firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine}`,
          description: `${message}\n\n---\n${context}`,
          category: selected.category,
          familyId: families[0]?.id ?? null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error || 'Could not send your feedback. Please try again.')
        return
      }
      toast.success('Thanks! We read every message.', { description: 'Replies show up under Support.' })
      setText('')
      setKind('bug')
      onOpenChange(false)
    } catch {
      toast.error('Could not send your feedback. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Tell us what went wrong or what would make Togethr better. We&apos;ll include the page you&apos;re on.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Kind of feedback">
          {KINDS.map((k) => {
            const Icon = k.icon
            const active = kind === k.value
            return (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(k.value)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs font-medium transition-colors',
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                <Icon className="h-4 w-4" />
                {k.label}
              </button>
            )
          })}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          placeholder={kind === 'bug' ? 'What happened, and what did you expect?' : 'Tell us more...'}
          rows={5}
          aria-label="Your feedback"
          autoFocus
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending || !text.trim()}>
            {sending && <Spinner className="mr-2 h-4 w-4" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
