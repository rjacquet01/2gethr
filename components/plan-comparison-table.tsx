import { listTierDefinitions, type TierDefinition } from '@/lib/subscription-tiers'

// Plan-by-plan limits for /pricing. Every number comes from
// lib/subscription-tiers.ts, so this table can't drift from what the
// server enforces (lib/tier-limits.ts).

const n = (v: number, unlimited = 'Unlimited') => (v < 0 ? unlimited : v.toLocaleString('en-US'))

const ROWS: { label: string; value: (t: TierDefinition) => string }[] = [
  { label: 'Family members', value: (t) => n(t.limits.maxFamilyMembers) },
  { label: 'Children', value: (t) => n(t.limits.maxChildren) },
  { label: 'Sharing live location at once', value: (t) => n(t.limits.maxLocationSharers, 'Whole family') },
  { label: 'Saved places', value: (t) => n(t.limits.maxSavedPlaces) },
  {
    label: 'Arrival & departure alerts',
    value: (t) => (!t.features.geofencing || t.limits.maxAlertPlaces === 0 ? '-' : n(t.limits.maxAlertPlaces, 'Every place') + (t.limits.maxAlertPlaces > 0 ? ' places' : '')),
  },
  { label: 'New events a month', value: (t) => n(t.limits.maxEventsPerMonth) },
  { label: 'Active reminders', value: (t) => n(t.limits.maxActiveReminders) },
  { label: 'Family board photo uploads', value: (t) => n(t.limits.maxBoardUploads) },
  { label: 'Notifications a month', value: (t) => n(t.limits.pushMonthlyQuota) },
  { label: 'Location trail', value: (t) => `${t.limits.locationTrailDays} days` },
  { label: 'Past events & archives', value: (t) => `${t.limits.historyDays} days` },
]

export function PlanComparisonTable() {
  const tiers = listTierDefinitions()
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left font-medium">Plan limits</th>
            {tiers.map((t) => (
              <th key={t.key} scope="col" className="px-4 py-3 text-center font-medium">{t.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} className="border-t">
              <th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">{row.label}</th>
              {tiers.map((t) => (
                <td key={t.key} className="px-4 py-2.5 text-center">{row.value(t)}</td>
              ))}
            </tr>
          ))}
          <tr className="border-t">
            <th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">Safety alerts count toward the notification limit</th>
            {tiers.map((t) => (
              <td key={t.key} className="px-4 py-2.5 text-center">Never</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
