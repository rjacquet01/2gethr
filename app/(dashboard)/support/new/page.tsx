'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ArrowLeft, Send, Lightbulb, CreditCard, Wrench, User, LifeBuoy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useFamilies } from '@/hooks/use-family'
import { authFetch } from '@/hooks/use-events'
import { DictateField } from '@/components/dictate-button'
import { appendDictation } from '@/lib/dictation'

const categories: { value: string; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { value: 'BILLING', label: 'Billing & Payments', icon: CreditCard, description: 'Subscription, charges, refunds' },
  { value: 'TECHNICAL', label: 'Technical Issue', icon: Wrench, description: 'Bugs, errors, app not working' },
  { value: 'ACCOUNT', label: 'Account & Profile', icon: User, description: 'Login, settings, privacy' },
  { value: 'FEATURE_REQUEST', label: 'Feature Request', icon: Lightbulb, description: 'Suggestions for new features' },
  { value: 'GENERAL', label: 'General Inquiry', icon: LifeBuoy, description: 'Other questions' },
]

const priorities = [
  { value: 'LOW', label: 'Low', description: 'General questions, not urgent' },
  { value: 'MEDIUM', label: 'Medium', description: 'Need help but not blocking' },
  { value: 'HIGH', label: 'High', description: 'Significantly impacting usage' },
  { value: 'URGENT', label: 'Urgent', description: 'Critical - cannot use the app' },
]

export default function NewTicketPage() {
  const router = useRouter()
  const { families } = useFamilies()
  
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState('MEDIUM')
  const [familyId, setFamilyId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!subject.trim() || !description.trim() || !category) {
      toast.error('Please fill in all required fields')
      return
    }

    setSubmitting(true)
    try {
      const res = await authFetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          description,
          category,
          priority,
          familyId: familyId && familyId !== 'none' ? familyId : null,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success('Ticket created successfully')
        router.push(`/support/${data.data.id}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create ticket')
      }
    } catch (error) {
      toast.error('Failed to create ticket')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCategory = categories.find(c => c.value === category)

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" asChild className="h-9 w-9 shrink-0">
          <Link href="/support">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">New ticket</h1>
          <p className="text-sm text-muted-foreground">Tell us what's going on and we'll help</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Category Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What do you need help with?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {categories.map((cat) => {
                const Icon = cat.icon
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCategory(cat.value)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      category === cat.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{cat.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{cat.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Ticket Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject *</Label>
              <Input
                id="subject"
                placeholder="Brief summary of your issue"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <DictateField multiline label="Dictate the description" onText={(t) => setDescription((v) => appendDictation(v, t))}>
                <Textarea
                  id="description"
                  placeholder="Please describe your issue in detail. Include any error messages, steps to reproduce, or relevant information..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  required
                  className="pr-11"
                />
              </DictateField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {priorities.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <div className="flex flex-col">
                          <span>{p.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {priorities.find(p => p.value === priority)?.description}
                </p>
              </div>

              {families.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="family">Related Family (Optional)</Label>
                  <Select value={familyId} onValueChange={setFamilyId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select family" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No specific family</SelectItem>
                      {families.map((family) => (
                        <SelectItem key={family.id} value={family.id}>
                          {family.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tips */}
        {selectedCategory && (
          <Card className="bg-muted/50 border-dashed">
            <CardContent className="flex gap-4 p-4">
              <Lightbulb className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium mb-1">Tips for {selectedCategory.label} issues:</p>
                {category === 'BILLING' && (
                  <p className="text-muted-foreground">Include your subscription plan, any error messages during payment, and the date of the transaction if applicable.</p>
                )}
                {category === 'TECHNICAL' && (
                  <p className="text-muted-foreground">Include steps to reproduce the issue, what device/browser you're using, and any error messages you see.</p>
                )}
                {category === 'ACCOUNT' && (
                  <p className="text-muted-foreground">Don't share your password. Include the email associated with your account and what you were trying to do.</p>
                )}
                {category === 'FEATURE_REQUEST' && (
                  <p className="text-muted-foreground">Describe what you'd like to see, why it would be helpful, and how you'd use it.</p>
                )}
                {category === 'GENERAL' && (
                  <p className="text-muted-foreground">Provide any context that might help us understand your question or concern.</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" asChild>
            <Link href="/support">Cancel</Link>
          </Button>
          <Button type="submit" disabled={submitting || !subject || !description || !category}>
            {submitting ? (
              <>
                <Spinner className="w-4 h-4 mr-2" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Submit Ticket
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
