// One rule for "overdue", shared by Home, the Today list, the Tasks page and the
// weekly digest: a task is overdue when it is still active and its due time has
// passed. The task forms save a date-only task as 23:59:59 local time, so it
// becomes overdue only once that day ends. A bare YYYY-MM-DD gets the same treatment.

/** Statuses that still need doing (lower case; the database stores upper case). */
export const ACTIVE_TASK_STATUSES = ["pending", "in_progress", "pending_approval"]

/** Upper-case copy for SQL: `status = ANY(${ACTIVE_TASK_STATUSES_DB})`. */
export const ACTIVE_TASK_STATUSES_DB = ACTIVE_TASK_STATUSES.map((s) => s.toUpperCase())

/** Lower-cased status; a parent-approved task counts as completed. */
export function normTaskStatus(s?: string | null): string {
  const v = (s || "").toLowerCase()
  return v === "approved" ? "completed" : v
}

export function isTaskActive(status?: string | null): boolean {
  return ACTIVE_TASK_STATUSES.includes(normTaskStatus(status))
}

/** When the task is due, or null without a due date. */
export function taskDueAt(due?: string | null): Date | null {
  if (!due) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due.trim())
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999)
  const d = new Date(due)
  return Number.isNaN(d.getTime()) ? null : d
}

export function isTaskOverdue(
  task: { status?: string | null; due_date?: string | null; dueDate?: string | null },
  now: Date = new Date()
): boolean {
  if (!isTaskActive(task.status)) return false
  const due = taskDueAt(task.due_date ?? task.dueDate)
  return !!due && due.getTime() < now.getTime()
}
