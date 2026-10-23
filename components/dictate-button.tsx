'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Square } from 'lucide-react'
import { toast } from 'sonner'
import { useMyRole } from '@/hooks/use-my-role'
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

export function DictateButton({
  onText,
  label = 'Dictate',
  className,
}: {
  /** Called with each finished phrase. */
  onText: (text: string) => void
  label?: string
  className?: string
}) {
  const supported = useSyncExternalStore(noSubscribe, () => !!recognitionCtor(), () => false)
  const { isChild } = useMyRole()
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  })
  useEffect(() => () => rec.current?.abort(), [])

  if (!supported || isChild) return null

  const start = () => {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    const r = new Ctor()
    r.lang = navigator.language || 'en-US'
    r.interimResults = false
    // One phrase per tap: continuous mode repeats words on Android Chrome.
    r.continuous = false
    r.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript
      }
      if (text.trim()) onTextRef.current(text)
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Allow microphone access in your browser to use voice input')
      } else if (e.error === 'no-speech') {
        toast('Didn’t catch that. Tap the mic and try again.')
      } else if (e.error === 'network') {
        toast.error('Voice input needs an internet connection')
      }
    }
    r.onend = () => {
      setListening(false)
      rec.current = null
    }
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => (listening ? rec.current?.stop() : start())}
      aria-label={listening ? 'Stop dictating' : label}
      aria-pressed={listening}
      title={listening ? 'Listening… tap to stop' : label}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        listening && 'animate-pulse bg-red-500/15 text-red-600 hover:bg-red-500/20 hover:text-red-600',
        className
      )}
    >
      {listening ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
      <span className="sr-only" aria-live="polite">{listening ? 'Listening' : ''}</span>
    </button>
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
