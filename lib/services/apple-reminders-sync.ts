import { sql } from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import { ensureSyncSchema } from '@/lib/sync-schema'
import {
  buildVTodo,
  deleteCalDavItem,
  listCalDavItems,
  parseVTodo,
  putCalDavItem,
  CalDavCredentials,
} from '@/lib/services/caldav'

/**
 * Two-way sync between Togethr tasks/reminders and the iCloud Reminders list
 * (a CalDAV VTODO collection), shared by the manual route
 * (app/api/calendar-sync/apple/tasks) and the background cron.
 *
 *  Togethr -> Apple: family tasks (with a 30-minute-before alert when they
 *    have a due time) and the user's personal reminders (alert at the due
 *    time) become VTODOs. Completing a task/reminder in Togethr completes
 *    it in Reminders; archiving/cancelling removes it.
 *  Apple -> Togethr: ticking something off in Reminders completes the
 *    matching task/reminder; renaming or re-dating a Reminders item updates
 *    the matching task (unless the task was also edited in Togethr since the
 *    last sync - Togethr wins a true conflict); and a new item created in the
 *    Reminders app arrives as a new Togethr task.
 *
 * Note: only Reminders lists still in the legacy iCloud format are reachable
 * over CalDAV. Apple does not expose lists that were upgraded to the iOS 13+
 * format; the connect flow reports that case instead of failing silently.
 */

export interface AppleTaskConnectionRow {
  id: string
  access_token_encrypted: string | null
  apple_task_calendar_url: string | null
  provider_account_email: string
  sync_tasks?: boolean | null
}

export interface AppleRemindersResult {
  pushed: number
  pulled: number
  completedFromApple: number
  removed: number
  errors: number
}

const MAX_PER_RUN = 200

function itemUrl(listUrl: string, uid: string): string {
  return `${listUrl}${listUrl.endsWith('/') ? '' : '/'}${encodeURIComponent(uid)}.ics`
}

export async function syncAppleReminders(
  connection: AppleTaskConnectionRow,
  familyId: string,
  userId: string
): Promise<AppleRemindersResult> {
  await ensureSyncSchema()

  if (!connection.access_token_encrypted) {
    throw new Error(
      "Apple Calendar isn't fully connected. Reconnect it with your Apple ID and an app-specific password."
    )
  }
  if (!connection.apple_task_calendar_url) {
    throw new Error(
      'No Reminders list was found over CalDAV for this iCloud account. If your Reminders were upgraded in iOS 13 or later, Apple does not share them with other apps - subscribe to the Togethr calendar link instead to see tasks and reminders on your iPhone.'
    )
  }

  const creds: CalDavCredentials = {
    username: connection.provider_account_email,
    password: decrypt(connection.access_token_encrypted),
  }
  const listUrl = connection.apple_task_calendar_url
  const result: AppleRemindersResult = { pushed: 0, pulled: 0, completedFromApple: 0, removed: 0, errors: 0 }

  // ---------------------------------------------------------------- pull
  // Read Apple's side first so a completion made in Reminders is applied
  // before we push Togethr's (older) state back over it.
  const appleItems = await listCalDavItems(listUrl, creds, 'VTODO')
  let importBudget = 50

  const taskMaps = await sql`
    SELECT st.id AS map_id, st.familyhub_task_id, st.apple_reminder_uid, st.last_synced_at,
           t.status, t.updated_at, t.title, t.due_date
    FROM synced_tasks st
    LEFT JOIN tasks t ON t.id = st.familyhub_task_id
    WHERE st.connection_id = ${connection.id} AND st.apple_reminder_uid IS NOT NULL
  `
  const taskMapByUid = new Map<string, Record<string, any>>() // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const r of taskMaps) taskMapByUid.set(r.apple_reminder_uid as string, r)

  const reminderMaps = await sql`
    SELECT sr.id AS map_id, sr.reminder_id, sr.apple_uid, sr.last_synced_at,
           r.status, r.updated_at
    FROM synced_reminders sr
    LEFT JOIN reminders r ON r.id::text = sr.reminder_id
    WHERE sr.connection_id = ${connection.id}
  `
  const reminderMapByUid = new Map<string, Record<string, any>>() // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const r of reminderMaps) reminderMapByUid.set(r.apple_uid as string, r)

  for (const item of appleItems) {
    const todo = parseVTodo(item.raw)
    if (!todo) continue

    try {
      const tm = taskMapByUid.get(todo.uid)
      const rm = reminderMapByUid.get(todo.uid)

      if (tm) {
        if (!tm.status) continue // local task was deleted
        const syncedAt = new Date(tm.last_synced_at).getTime()
        const localChanged = new Date(tm.updated_at).getTime() > syncedAt
        const appleChanged = todo.lastModified ? new Date(todo.lastModified).getTime() > syncedAt : false

        if (todo.completed && tm.status !== 'COMPLETED' && tm.status !== 'ARCHIVED' && !localChanged) {
          await sql`UPDATE tasks SET status = 'COMPLETED', updated_at = NOW() WHERE id = ${tm.familyhub_task_id}`
          await sql`UPDATE synced_tasks SET last_synced_at = NOW() WHERE id = ${tm.map_id}`
          result.completedFromApple++
        } else if (!todo.completed && tm.status === 'COMPLETED' && appleChanged && !localChanged) {
          // Un-ticked in Reminders.
          await sql`UPDATE tasks SET status = 'PENDING', updated_at = NOW() WHERE id = ${tm.familyhub_task_id}`
          await sql`UPDATE synced_tasks SET last_synced_at = NOW() WHERE id = ${tm.map_id}`
          result.pulled++
        } else if (appleChanged && !localChanged && !todo.completed) {
          await sql`
            UPDATE tasks
            SET title = ${todo.title},
                due_date = ${todo.due},
                updated_at = NOW()
            WHERE id = ${tm.familyhub_task_id}
              AND (title IS DISTINCT FROM ${todo.title} OR due_date IS DISTINCT FROM ${todo.due}::timestamptz)
          `
          await sql`UPDATE synced_tasks SET last_synced_at = NOW() WHERE id = ${tm.map_id}`
          result.pulled++
        }
        continue
      }

      if (rm) {
        if (rm.status === 'PENDING' && todo.completed) {
          await sql`UPDATE reminders SET status = 'COMPLETED', updated_at = NOW() WHERE id::text = ${rm.reminder_id}`
          await sql`UPDATE synced_reminders SET last_synced_at = NOW() WHERE id = ${rm.map_id}`
          result.completedFromApple++
        }
        continue
      }

      // Unknown to Togethr: something created in the Reminders app. Skip
      // finished ones and anything Togethr itself wrote (its mapping row may
      // be gone because the local item was deleted).
      if (todo.fromTogethr || todo.completed || importBudget <= 0) continue

      const claimed = await sql`
        INSERT INTO synced_tasks (connection_id, familyhub_task_id, apple_reminder_uid, last_synced_at)
        VALUES (${connection.id}, ${'pending:' + todo.uid}, ${todo.uid}, NOW())
        ON CONFLICT DO NOTHING
        RETURNING id
      `
      if (claimed.length === 0) continue

      const created = await sql`
        INSERT INTO tasks (family_id, title, description, created_by_id, assigned_to_id, due_date, priority, category, status)
        VALUES (${familyId}, ${todo.title}, ${todo.description}, ${userId}, ${userId}, ${todo.due}, 'MEDIUM', 'OTHER', 'PENDING')
        RETURNING id
      `
      await sql`UPDATE synced_tasks SET familyhub_task_id = ${created[0].id} WHERE id = ${claimed[0].id}`
      importBudget--
      result.pulled++
    } catch (err) {
      console.error('Apple Reminders pull error:', todo.uid, err)
      result.errors++
    }
  }

  // ---------------------------------------------------------------- push: tasks
  const tasks = await sql`
    SELECT t.id, t.title, t.description, t.due_date, t.status, t.updated_at,
           st.id AS map_id, st.apple_reminder_uid, st.last_synced_at
    FROM tasks t
    LEFT JOIN synced_tasks st ON st.familyhub_task_id = t.id AND st.connection_id = ${connection.id}
    WHERE t.family_id = ${familyId}
      AND t.status NOT IN ('ARCHIVED', 'CANCELLED')
      AND (t.due_date IS NOT NULL OR st.id IS NOT NULL)
      AND (st.id IS NULL OR t.updated_at > st.last_synced_at)
      AND (st.id IS NOT NULL OR t.status != 'COMPLETED')
    ORDER BY t.updated_at DESC
    LIMIT ${MAX_PER_RUN}
  `

  for (const task of tasks) {
    try {
      const uid: string = task.apple_reminder_uid || `togethr-task-${task.id}@togethr.app`
      const due = task.due_date ? new Date(task.due_date) : null
      const ics = buildVTodo({
        uid,
        title: task.title,
        description: task.description,
        due,
        completed: task.status === 'COMPLETED',
        alarmMinutesBefore: due ? 30 : null,
      })
      const ok = await putCalDavItem(itemUrl(listUrl, uid), creds, ics)
      if (!ok) {
        result.errors++
        continue
      }
      await sql`
        INSERT INTO synced_tasks (connection_id, familyhub_task_id, apple_reminder_uid, last_synced_at)
        VALUES (${connection.id}, ${task.id}, ${uid}, NOW())
        ON CONFLICT (connection_id, familyhub_task_id)
        DO UPDATE SET apple_reminder_uid = ${uid}, last_synced_at = NOW()
      `
      result.pushed++
    } catch (err) {
      console.error('Error pushing task to Apple Reminders:', task.id, err)
      result.errors++
    }
  }

  // Tasks archived/cancelled in Togethr: remove them from Reminders.
  const gone = await sql`
    SELECT st.id AS map_id, st.apple_reminder_uid
    FROM synced_tasks st
    JOIN tasks t ON t.id = st.familyhub_task_id
    WHERE st.connection_id = ${connection.id}
      AND st.apple_reminder_uid IS NOT NULL
      AND t.status IN ('ARCHIVED', 'CANCELLED')
    LIMIT ${MAX_PER_RUN}
  `
  for (const g of gone) {
    try {
      if (await deleteCalDavItem(itemUrl(listUrl, g.apple_reminder_uid), creds)) {
        await sql`DELETE FROM synced_tasks WHERE id = ${g.map_id}`
        result.removed++
      }
    } catch (err) {
      console.error('Error removing task from Apple Reminders:', g.apple_reminder_uid, err)
      result.errors++
    }
  }

  // ---------------------------------------------------------------- push: reminders
  const reminders = await sql`
    SELECT r.id::text AS id, r.title, r.description, r.remind_at, r.status, r.updated_at,
           sr.id AS map_id, sr.apple_uid, sr.last_synced_at
    FROM reminders r
    LEFT JOIN synced_reminders sr ON sr.reminder_id = r.id::text AND sr.connection_id = ${connection.id}
    WHERE r.user_id = ${userId}
      AND (
        (sr.id IS NULL AND r.status = 'PENDING' AND r.remind_at >= NOW() - INTERVAL '1 day')
        OR (sr.id IS NOT NULL AND r.updated_at > sr.last_synced_at)
      )
    ORDER BY r.remind_at ASC
    LIMIT ${MAX_PER_RUN}
  `
  for (const r of reminders) {
    try {
      const uid: string = r.apple_uid || `togethr-reminder-${r.id}@togethr.app`
      const finished = r.status !== 'PENDING'
      const ics = buildVTodo({
        uid,
        title: r.title,
        description: r.description,
        due: new Date(r.remind_at),
        completed: finished,
        alarmMinutesBefore: 0,
      })
      const ok = await putCalDavItem(itemUrl(listUrl, uid), creds, ics)
      if (!ok) {
        result.errors++
        continue
      }
      await sql`
        INSERT INTO synced_reminders (connection_id, reminder_id, apple_uid, last_synced_at)
        VALUES (${connection.id}, ${r.id}, ${uid}, NOW())
        ON CONFLICT (connection_id, reminder_id)
        DO UPDATE SET last_synced_at = NOW()
      `
      result.pushed++
    } catch (err) {
      console.error('Error pushing reminder to Apple Reminders:', r.id, err)
      result.errors++
    }
  }

  await sql`UPDATE calendar_sync_connections SET last_sync_at = NOW() WHERE id = ${connection.id}`
  return result
}
