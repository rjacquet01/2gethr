import { ExistingUserConfirmations } from '@/components/existing-user-confirmations'

// A signed-in adult with no family lands here instead of the dashboard, so
// the one-time 18+ / Terms confirmation is shown here too.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ExistingUserConfirmations />
    </>
  )
}
