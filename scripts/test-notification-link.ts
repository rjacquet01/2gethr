// Usage: npx tsx --tsconfig tsconfig.json scripts/test-notification-link.ts
// Where clicking a notification takes you (lib/notification-link.ts), for
// the notifications the app creates. Pure function: no database, no network.
import assert from "node:assert"
import { notificationHref } from "../lib/notification-link"

const cases: [string, string, Record<string, unknown>, string | null][] = [
  ["task assigned", "TASK_ASSIGNED", { taskId: "t1", familyId: "f" }, "/tasks/t1"],
  ["task approval request", "APPROVAL_REQUEST", { taskId: "t2" }, "/tasks/t2"],
  ["task on hold (kind)", "REMINDER", { kind: "on_hold_3d", taskId: "t3" }, "/tasks/t3"],
  ["weekly task reminder", "REMINDER", { kind: "weekly_tasks", familyId: "f" }, "/tasks"],
  ["new family event", "EVENT_CREATED", { eventId: "e1" }, "/calendar/event/e1"],
  ["event approval request", "EVENT_APPROVAL_REQUEST", { eventId: "e2" }, "/calendar/event/e2"],
  ["event comment", "EVENT_UPDATE", { subType: "EVENT_COMMENT", eventId: "e3" }, "/calendar/event/e3"],
  ["calendar import", "EVENT_INVITATION", { kind: "ics_import_assigned" }, "/calendar"],
  ["reminder approval request", "APPROVAL_REQUEST", { reminderId: "r1" }, "/dashboard/reminders"],
  ["reminder fired", "REMINDER", { reminderId: "r2" }, "/dashboard/reminders"],
  ["SOS (its eventId is not a calendar event)", "LOCATION_ALERT", { subType: "SOS", eventId: "sos-1" }, "/location"],
  ["emergency alert", "LOCATION_ALERT", { subType: "EMERGENCY_ALERT", alertId: "a" }, "/location"],
  ["location ping request", "LOCATION_ALERT", { subType: "LOCATION_APPROVAL", requestId: "q" }, "/location"],
  ["arrived at a place", "LOCATION_ALERT", { placeName: "Home", eventType: "ARRIVAL" }, "/places"],
  ["background sharing stopped", "LOCATION_ALERT", { subType: "BG_SHARING_STOPPED" }, "/location?resume=1"],
  ["board post", "SYSTEM", { subType: "BOARD_POST", postId: "p" }, "/board"],
  ["join request", "FAMILY_INVITATION", { subType: "JOIN_REQUEST", requestId: "j" }, "/family"],
  ["join request approved", "FAMILY_INVITATION", { subType: "JOIN_REQUEST_RESULT", outcome: "APPROVED" }, "/family"],
  ["join request declined", "FAMILY_INVITATION", { subType: "JOIN_REQUEST_RESULT", outcome: "DENIED" }, null],
  ["turning 18", "SYSTEM", { subType: "TURNING_18", childProfileId: "c1" }, "/family/child/c1"],
  ["weekly digest", "WEEKLY_DIGEST", { weekStart: "x" }, "/dashboard"],
  ["admin broadcast", "SYSTEM_ALERT", { sentByAdmin: true }, null],
  ["test notification (made-up ids)", "TASK_ASSIGNED", { test: true, taskId: "fake" }, null],
]

let passed = 0
for (const [name, type, data, want] of cases) {
  assert.equal(notificationHref(type, data), want, name)
  passed++
}
assert.equal(notificationHref("TASK_ASSIGNED", { taskId: "a/b" }), "/tasks/a%2Fb", "ids are URL-encoded")
assert.equal(notificationHref("SYSTEM", null), null)
passed += 2
console.log(`${passed} passed`)
