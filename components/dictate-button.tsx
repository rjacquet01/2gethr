'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { useMyRole } from '@/hooks/use-my-role'
import { joinHeard } from '@/lib/dictation'
import { cn } from '@/lib/utils'

// Voice input with the browser's own speech recognition (Web Speech API):
// no key, no server of ours. Hidden where the browser lacks it, and on
// children's accounts (their voice would go to the browser's speech service).

type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onaudiostart: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}
const noSubscribe = () => () => {}

// Left alone, the browser stops at the first short pause ("call grandma …
// in half an hour" lost its time). It keeps listening; we stop it after a
// pause this long, or when nothing is said at all. A noisy room can't keep
// it open past LONGEST_MS; tapping again adds more.
const PAUSE_MS = 2000
const FIRST_WORD_MS = 8000
const LONGEST_MS = 20000

export function DictateButton({
  onText,
  label = 'Dictate',
  className,
}: {
  /** Called once, with everything heard, when listening stops. */
  onText: (text: string) => void
  label?: string
  className?: string
}) {
  const supported = useSyncExternalStore(noSubscribe, () => !!recognitionCtor(), () => false)
  const { role, isLoading, isChild } = useMyRole()
  // starting: waiting for the mic to open; listening: speak now.
  const [phase, setPhase] = useState<'idle' | 'starting' | 'listening'>('idle')
  const [live, setLive] = useState('')
  const rec = useRef<Recognition | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopped = useRef(false)
  const gone = useRef(false)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  })
  useEffect(() => {
    gone.current = false
    return () => {
      gone.current = true
      stopped.current = true
      if (timer.current) clearTimeout(timer.current)
      rec.current?.abort()
    }
  }, [])

  // Hidden until the role is known, so a child never sees it flash up.
  if (!supported || isLoading || !role || isChild) return null

  const start = () => {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    const r = new Ctor()
    r.lang = navigator.language || 'en-US'
    r.interimResults = true
    r.continuous = true
    const finals: string[] = []
    let interim = ''
    let told = false
    const begun = Date.now()
    const stopIn = (ms: number) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => r.stop(), ms)
    }
    r.onaudiostart = () => {
      // The mic is open: now it's safe to speak.
      setPhase('listening')
      navigator.vibrate?.(20)
      stopIn(FIRST_WORD_MS)
    }
    r.onresult = (e) => {
      interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finals[i] = e.results[i][0].transcript
        else interim += e.results[i][0].transcript
      }
      setLive(joinHeard([...finals.filter(Boolean), interim]))
      stopIn(Date.now() - begun > LONGEST_MS ? 0 : PAUSE_MS)
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        told = true
        toast.error('Allow microphone access in your browser to use voice input')
      } else if (e.error === 'network') {
        told = true
        toast.error('Voice input needs an internet connection')
      }
    }
    // Android Chrome often ends a silent session with no "no-speech" error,
    // so a session that ends with no words says so itself.
    r.onend = () => {
      if (timer.current) clearTimeout(timer.current)
      rec.current = null
      if (gone.current) return
      const text = joinHeard([...finals.filter(Boolean), interim])
      if (text) onTextRef.current(text)
      else if (!told && !stopped.current) toast('Didn’t catch that. Tap the mic and try again.')
      setPhase('idle')
      setLive('')
    }
    rec.current = r
    stopped.current = false
    try {
      r.start()
      setPhase('starting')
    } catch {
      setPhase('idle')
    }
  }

  const active = phase !== 'idle'
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!active) return start()
          stopped.current = true
          rec.current?.stop()
        }}
        aria-label={active ? 'Stop dictating' : label}
        aria-pressed={active}
        title={active ? 'Listening… tap to stop' : label}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          phase === 'starting' && 'animate-pulse bg-muted text-foreground',
          phase === 'listening' && 'animate-pulse bg-red-500/15 text-red-600 hover:bg-red-500/20 hover:text-red-600',
          className
        )}
      >
        {active ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
        <span className="sr-only" aria-live="polite">{phase === 'listening' ? 'Listening' : ''}</span>
      </button>
      {active && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-full z-30 mt-1 truncate rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm"
        >
          {phase === 'starting' ? (
            'Starting the mic…'
          ) : live ? (
            <span className="italic">“{live}”</span>
          ) : (
            <span className="font-medium text-red-600">Listening — speak now</span>
          )}
        </span>
      )}
    </>
  )
}

/** A field with the mic inside its right edge (top right for a multi-line box). */
export function DictateField({
  onText,
  multiline = false,
  label,
  className,
  children,
}: {
  onText: (text: string) => void
  multiline?: boolean
  label?: string
  /** For the wrapper, e.g. flex-1 when the field sits in a row. */
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('relative', className)}>
      {children}
      <DictateButton
        onText={onText}
        label={label}
        className={cn('absolute right-1', multiline ? 'top-1' : 'top-1/2 -translate-y-1/2')}
      />
    </div>
  )
}
