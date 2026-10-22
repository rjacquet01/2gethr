import { ddl } from "./schema-snapshot"

// The task forms have offered "Require Approval" (a parent approves the task
// when it's marked complete), but tasks had no column for it, so the choice
// was dropped on save. Add it idempotently the first time a task route runs.
let ensured: Promise<void> | null = null

export function ensureTaskApprovalColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT false`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
