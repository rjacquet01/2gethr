// Ready-made chores for Quick Add on the Tasks page. Pure client data: never
// stored, never sent anywhere until the user adds one as a task.

export type SuggestionCategory = 'home' | 'errands' | 'admin' | 'health' | 'kids'

export interface QuickAddSuggestion {
  title: string
  category: SuggestionCategory
  priority?: 'low' | 'medium' | 'high'
  /** gentle timing hint, never applied automatically */
  due?: 'today' | 'tomorrow' | 'weekend' | 'this_week'
  minutes?: number
  kid?: boolean
}

export const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  home: 'Home & Chores',
  errands: 'Errands & Shopping',
  admin: 'Work & Admin',
  health: 'Health & Personal',
  kids: "Kids' Chores",
}

export const QUICK_ADD_SUGGESTIONS: QuickAddSuggestion[] = [
  // Home & Chores
  { title: 'Clean the hair out of the shower drain', category: 'home', priority: 'low', minutes: 5 },
  { title: 'Throw away expired food from the fridge door', category: 'home', priority: 'low', minutes: 10 },
  { title: 'Wipe down the microwave food splatters', category: 'home', priority: 'low', minutes: 5 },
  { title: 'Bring in the empty trash bins from the curb', category: 'home', priority: 'medium', due: 'today', minutes: 5 },
  { title: 'Wash the kitchen trash can liner', category: 'home', priority: 'low', due: 'weekend', minutes: 15 },
  { title: 'Strip the bed sheets for washing', category: 'home', priority: 'medium', due: 'weekend', minutes: 20 },
  { title: 'Flip or rotate your bed mattress', category: 'home', priority: 'low', due: 'weekend', minutes: 15 },
  { title: 'Shake out the front doormat', category: 'home', priority: 'low', minutes: 5 },
  { title: 'Clean the dishwasher filter', category: 'home', priority: 'low', due: 'weekend', minutes: 10 },
  { title: 'Run a cleaning cycle on the washing machine', category: 'home', priority: 'low', due: 'weekend', minutes: 5 },

  // Errands & Shopping
  { title: 'Buy replacement AA and AAA batteries', category: 'errands', priority: 'low', minutes: 15 },
  { title: 'Restock toilet paper and paper towels', category: 'errands', priority: 'medium', due: 'this_week', minutes: 20 },
  { title: 'Pick up a roll of packing or Scotch tape', category: 'errands', priority: 'low', minutes: 10 },
  { title: 'Get a spare house or car key cut', category: 'errands', priority: 'medium', due: 'this_week', minutes: 20 },
  { title: 'Buy a standard greeting card box set', category: 'errands', priority: 'low', minutes: 10 },
  { title: 'Grab a pack of multi-purpose surface wipes', category: 'errands', priority: 'low', minutes: 10 },
  { title: 'Pick up a bottle of windshield wiper fluid', category: 'errands', priority: 'medium', due: 'this_week', minutes: 10 },
  { title: 'Buy a lightbulb to replace the burned-out one', category: 'errands', priority: 'medium', due: 'this_week', minutes: 10 },
  { title: 'Return a borrowed item to a friend', category: 'errands', priority: 'medium', due: 'this_week', minutes: 20 },
  { title: 'Drop off old electronics at a recycling depot', category: 'errands', priority: 'low', due: 'weekend', minutes: 30 },

  // Work & Admin
  { title: 'Unsubscribe from three junk email lists', category: 'admin', priority: 'low', minutes: 10 },
  { title: 'Download and save your latest pay stub', category: 'admin', priority: 'low', minutes: 5 },
  { title: 'Update your emergency contact info at work', category: 'admin', priority: 'medium', minutes: 10 },
  { title: 'Clear the temporary cache on your browser', category: 'admin', priority: 'low', minutes: 5 },
  { title: 'Log into your 401(k) to check the balance', category: 'admin', priority: 'low', minutes: 15 },
  { title: 'File your vehicle registration or insurance card', category: 'admin', priority: 'medium', minutes: 10 },
  { title: 'Delete duplicate photos taking up phone storage', category: 'admin', priority: 'low', minutes: 20 },
  { title: 'Schedule a calendar block for deep work', category: 'admin', priority: 'medium', minutes: 5 },
  { title: 'Confirm a meeting time for next week', category: 'admin', priority: 'medium', due: 'this_week', minutes: 5 },
  { title: 'Check your credit score on your banking app', category: 'admin', priority: 'low', minutes: 5 },

  // Health & Personal
  { title: 'Clean your reusable water bottle with soap', category: 'health', priority: 'low', minutes: 5 },
  { title: 'Replace your old toothbrush or electric head', category: 'health', priority: 'medium', minutes: 5 },
  { title: 'Clip and file your fingernails', category: 'health', priority: 'low', minutes: 10 },
  { title: 'Wash your pillowcases to prevent breakouts', category: 'health', priority: 'low', due: 'weekend', minutes: 10 },
  { title: 'Clean your sunglasses and everyday eyeglasses', category: 'health', priority: 'low', minutes: 5 },
  { title: 'Put a fresh pack of gum or mints in your bag', category: 'health', priority: 'low', minutes: 5 },
  { title: 'Refill your portable travel pill organizer', category: 'health', priority: 'high', due: 'weekend', minutes: 10 },
  { title: 'Apply lip balm before your lips chap', category: 'health', priority: 'low', minutes: 5 },
  { title: 'Check the expiration date on your sunscreen', category: 'health', priority: 'low', minutes: 5 },
  { title: 'Stand up and do ten air squats to wake up', category: 'health', priority: 'low', minutes: 2 },

  // Kids' Chores (added for a family app)
  { title: 'Make your bed', category: 'kids', priority: 'low', due: 'today', minutes: 5, kid: true },
  { title: 'Put dirty clothes in the hamper', category: 'kids', priority: 'low', due: 'today', minutes: 3, kid: true },
  { title: 'Set the table for dinner', category: 'kids', priority: 'medium', due: 'today', minutes: 5, kid: true },
  { title: 'Clear your plate and load the dishwasher', category: 'kids', priority: 'medium', due: 'today', minutes: 10, kid: true },
  { title: 'Feed the pet', category: 'kids', priority: 'high', due: 'today', minutes: 5, kid: true },
  { title: 'Tidy your room for 15 minutes', category: 'kids', priority: 'medium', due: 'weekend', minutes: 15, kid: true },
  { title: 'Pack your school bag for tomorrow', category: 'kids', priority: 'medium', due: 'today', minutes: 10, kid: true },
  { title: 'Take the recycling out', category: 'kids', priority: 'low', due: 'this_week', minutes: 10, kid: true },
  { title: 'Fold and put away your laundry', category: 'kids', priority: 'medium', due: 'weekend', minutes: 15, kid: true },
  { title: 'Water the plants', category: 'kids', priority: 'low', due: 'this_week', minutes: 5, kid: true },
]

export const SUGGESTION_CATEGORIES = Object.keys(SUGGESTION_CATEGORY_LABELS) as SuggestionCategory[]

/** The categories to offer: Kids' Chores only when the family has children. */
export function suggestionCategories(hasChildren: boolean): SuggestionCategory[] {
  return SUGGESTION_CATEGORIES.filter((c) => hasChildren || c !== 'kids')
}

/**
 * The suggestions to show. Kid chores only when the family has children, and
 * nothing already on the family's open list. With a query: up to 5 matches
 * from every category. Without: the selected category, in full (the caller
 * shows 6 at a time).
 */
export function filterSuggestions(opts: {
  category: SuggestionCategory
  query?: string
  hasChildren: boolean
  openTitles?: string[]
  all?: QuickAddSuggestion[]
}): QuickAddSuggestion[] {
  const open = new Set((opts.openTitles || []).map((t) => t.trim().toLowerCase()))
  const pool = (opts.all || QUICK_ADD_SUGGESTIONS).filter(
    (s) => (opts.hasChildren || !s.kid) && !open.has(s.title.toLowerCase())
  )
  const q = (opts.query || '').trim().toLowerCase()
  if (q) return pool.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 5)
  return pool.filter((s) => s.category === opts.category)
}

/** "suggested: this weekend" and so on. */
export function dueHint(due: QuickAddSuggestion['due']): string | null {
  if (!due) return null
  return { today: 'today', tomorrow: 'tomorrow', weekend: 'this weekend', this_week: 'this week' }[due]
}

/**
 * Quick Add tokens for a suggestion's timing and priority, e.g. "saturday !medium".
 * The weekend and "this week" both mean the coming Saturday (the week ends on
 * Saturday), or today when it is already Saturday.
 */
export function suggestedTokens(s: QuickAddSuggestion, now: Date = new Date()): string {
  const parts: string[] = []
  if (s.due === 'today' || s.due === 'tomorrow') parts.push(s.due)
  else if (s.due) parts.push(now.getDay() === 6 ? 'today' : 'saturday')
  if (s.priority) parts.push('!' + s.priority)
  return parts.join(' ')
}
