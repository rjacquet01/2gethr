// Where a notification takes you when you click it: the bell's list, the
// Notifications page and the push itself all use this, so they agree.
// Returns null when there's nothing to open (e.g. an admin broadcast).

const enc = encodeURIComponent

export function notificationHref(type: string, data: Record<string, unknown> | null | undefined): string | null {
  const d = data || {}
  const str = (k: string) => (typeof d[k] === 'string' && (d[k] as string).length > 0 ? (d[k] as string) : null)
  if (d.test === true || d.test === 'true') return null // test notifications carry made-up ids

  const sub = str('subType')
  const kind = str('kind')

  // SOS / emergency carry an SOS event id, not a calendar event.
  if (sub === 'SOS' || sub === 'EMERGENCY_ALERT' || sub === 'EMERGENCY_ACK') return '/location'

  const taskId = str('taskId')
  if (taskId) return `/tasks/${enc(taskId)}`
  if (str('reminderId')) return '/dashboard/reminders'
  const eventId = str('eventId')
  if (eventId) return `/calendar/event/${enc(eventId)}`

  if (sub === 'BOARD_POST') return '/board'
  if (sub === 'BG_SHARING_STOPPED') return '/location?resume=1'
  const childProfileId = str('childProfileId')
  if (childProfileId) return `/family/child/${enc(childProfileId)}`
  if (sub === 'JOIN_REQUEST_RESULT') return str('outcome') === 'APPROVED' ? '/family' : null
  if (type === 'FAMILY_INVITATION' || type === 'FAMILY_INVITE' || sub === 'ROLE_PROMOTED' || sub === 'ADULT_ROLE_CHOICE_SELF') return '/family'

  // Arrived/left a saved place; every other location alert.
  if (type === 'LOCATION_ALERT' || type === 'GEOFENCE_ALERT') return str('placeName') ? '/places' : '/location'

  if (kind === 'ics_import_assigned') return '/calendar'
  if (kind === 'weekly_tasks') return '/tasks'
  if (type === 'WEEKLY_DIGEST') return '/dashboard'
  if (type.startsWith('EVENT')) return '/calendar'
  if (type.startsWith('TASK')) return '/tasks'
  return null
}
