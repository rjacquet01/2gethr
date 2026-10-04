import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { decrypt, encrypt } from '@/lib/encryption'
import { sql } from '@/lib/db'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

// Refresh access token if expired
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) return null

    const data = await response.json()
    return data.access_token
  } catch {
    return null
  }
}

// Get or create Togethr task list in Google Tasks
async function getOrCreateTaskList(accessToken: string, connectionId: string): Promise<string | null> {
  try {
    // Check if we already have a task list ID stored
    const connections = await sql`
      SELECT google_tasklist_id FROM calendar_sync_connections WHERE id = ${connectionId}
    `
    
    if (connections[0]?.google_tasklist_id) {
      // Verify it still exists
      const verifyRes = await fetch(
        `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${connections[0].google_tasklist_id}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (verifyRes.ok) {
        return connections[0].google_tasklist_id
      }
    }

    // List existing task lists to find Togethr list
    const listRes = await fetch(
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!listRes.ok) return null

    const lists = await listRes.json()
    const familyHubList = lists.items?.find((list: { title: string }) => list.title === 'Togethr Tasks')

    if (familyHubList) {
      // Save the list ID
      await sql`
        UPDATE calendar_sync_connections SET google_tasklist_id = ${familyHubList.id} WHERE id = ${connectionId}
      `
      return familyHubList.id
    }

    // Create new task list
    const createRes = await fetch(
      'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Togethr Tasks' }),
      }
    )

    if (!createRes.ok) return null

    const newList = await createRes.json()
    
    // Save the list ID
    await sql`
      UPDATE calendar_sync_connections SET google_tasklist_id = ${newList.id} WHERE id = ${connectionId}
    `

    return newList.id
  } catch (error) {
    console.error('Error getting/creating task list:', error)
    return null
  }
}

// Sync Togethr tasks to Google Tasks
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || 'Not authenticated' },
        { status: 401 }
      )
    }

    // Get Google connection with task sync enabled
    // BUG FIX: the real columns are `access_token_encrypted` /
    // `refresh_token_encrypted`, and the connection's enabled flag is
    // `sync_enabled` - there is no `is_active` column on this table (see
    // scripts/add-calendar-sync-tables.sql). The old names don't exist, so
    // this query always threw and task sync could never run.
    const connections = await sql`
      SELECT id, access_token_encrypted, refresh_token_encrypted, sync_tasks
      FROM calendar_sync_connections
      WHERE user_id = ${user.id} AND provider = 'google' AND sync_enabled = true
    `

    if (connections.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No Google Calendar connection found' },
        { status: 404 }
      )
    }

    const connection = connections[0]

    if (!connection.sync_tasks) {
      return NextResponse.json(
        { success: false, error: 'Task sync is not enabled' },
        { status: 400 }
      )
    }

    // Decrypt tokens
    const refreshToken = decrypt(connection.refresh_token_encrypted)
    let accessToken = decrypt(connection.access_token_encrypted)

    // Refresh token
    const newAccessToken = await refreshAccessToken(refreshToken)
    if (newAccessToken) {
      accessToken = newAccessToken
      await sql`
        UPDATE calendar_sync_connections
        SET access_token_encrypted = ${encrypt(newAccessToken)}
        WHERE id = ${connection.id}
      `
    }

    // Get or create task list
    const taskListId = await getOrCreateTaskList(accessToken, connection.id)
    if (!taskListId) {
      return NextResponse.json(
        { success: false, error: 'Failed to get or create Google Tasks list' },
        { status: 500 }
      )
    }

    // Get user's family
    const familyMembers = await sql`
      SELECT family_id FROM family_members WHERE user_id = ${user.id} LIMIT 1
    `

    if (familyMembers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'User is not part of any family' },
        { status: 400 }
      )
    }

    const familyId = familyMembers[0].family_id

    // --- Pull: reflect changes made directly in Google Tasks back into
    // Togethr. This used to be push-only (Togethr -> Google Tasks), so
    // completing or editing a task in the Google Tasks app, or adding a
    // brand new one there, never showed up here. Runs before the push
    // loop below, so a task just pulled in doesn't immediately get
    // pushed back out as if it were a local change.
    let pulled = 0
    const listRes = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks?showCompleted=true&showHidden=true&maxResults=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (listRes.ok) {
      const listed = await listRes.json()

      for (const gTask of listed.items || []) {
        if (!gTask.id || !gTask.title || gTask.deleted) continue

        const googleUpdated = gTask.updated ? new Date(gTask.updated) : new Date()
        const googleStatus = gTask.status === 'completed' ? 'COMPLETED' : 'PENDING'
        const googleDue = gTask.due ? new Date(gTask.due) : null

        const mapped = await sql`
          SELECT id as sync_id, familyhub_task_id, last_synced_at
          FROM synced_tasks
          WHERE connection_id = ${connection.id} AND google_task_id = ${gTask.id}
          LIMIT 1
        `

        if (mapped.length > 0) {
          const row = mapped[0]
          const lastSynced = row.last_synced_at ? new Date(row.last_synced_at) : new Date(0)
          // Only pull if Google's own "updated" timestamp is newer than our
          // last sync checkpoint - otherwise this is just Google echoing
          // back a change the push loop already sent it, and re-applying it
          // here would stomp a more recent local edit with stale data.
          if (googleUpdated > lastSynced) {
            await sql`
              UPDATE tasks
              SET title = ${gTask.title}, description = ${gTask.notes || null},
                  due_date = ${googleDue}, status = ${googleStatus}, updated_at = NOW()
              WHERE id = ${row.familyhub_task_id}
            `
            await sql`UPDATE synced_tasks SET last_synced_at = NOW() WHERE id = ${row.sync_id}`
            pulled++
          }
          continue
        }

        // No mapping - this task didn't come from Togethr, so it was
        // created directly in Google Tasks. Atomically claim it by
        // google_task_id before importing, so two overlapping sync calls
        // (the 1-minute auto-sync timer and a manual "Sync Tasks Now"
        // click, say) can't both import the same new Google task as two
        // separate Togethr tasks.
        const claimed = await sql`
          INSERT INTO synced_tasks (connection_id, familyhub_task_id, google_task_id, google_tasklist_id, last_synced_at)
          VALUES (${connection.id}, ${'pending:' + gTask.id}, ${gTask.id}, ${taskListId}, NOW())
          ON CONFLICT (connection_id, google_task_id) DO NOTHING
          RETURNING id
        `
        if (claimed.length === 0) continue

        const newTask = await sql`
          INSERT INTO tasks (family_id, title, description, created_by_id, due_date, priority, category, status)
          VALUES (${familyId}, ${gTask.title}, ${gTask.notes || null}, ${user.id}, ${googleDue}, 'MEDIUM', 'OTHER', ${googleStatus})
          RETURNING id
        `
        await sql`UPDATE synced_tasks SET familyhub_task_id = ${newTask[0].id} WHERE id = ${claimed[0].id}`
        pulled++
      }
    }

    // --- Push: Togethr tasks with due dates that haven't been synced or
    // need updating, out to Google Tasks.
    // BUG FIX: synced_tasks' column linking back to tasks is `familyhub_task_id`,
    // not `task_id` (see scripts/add-synced-tasks-table.sql) - the old name
    // doesn't exist, so this join always threw and task sync never ran.
    const tasks = await sql`
      SELECT t.id, t.title, t.description, t.due_date, t.status, t.updated_at,
             st.id as sync_id, st.google_task_id, st.last_synced_at
      FROM tasks t
      LEFT JOIN synced_tasks st ON t.id = st.familyhub_task_id AND st.connection_id = ${connection.id}
      WHERE t.family_id = ${familyId}
      AND t.due_date IS NOT NULL
      AND t.status NOT IN ('ARCHIVED', 'CANCELLED')
      AND (
        st.id IS NULL
        OR t.updated_at > st.last_synced_at
      )
    `

    let synced = 0
    let errors = 0

    for (const task of tasks) {
      try {
        // Convert status
        const googleStatus = task.status === 'COMPLETED' ? 'completed' : 'needsAction'

        // Format due date (Google Tasks uses RFC 3339 date format)
        const dueDate = new Date(task.due_date).toISOString()

        const taskData = {
          title: task.title,
          notes: task.description || '',
          due: dueDate,
          status: googleStatus,
        }

        let googleTaskId = task.google_task_id
        let claimedSyncId: string | null = null

        if (!googleTaskId) {
          // Not yet synced - atomically claim this local task before
          // creating anything on Google's side. The claim's UNIQUE
          // constraint on (connection_id, familyhub_task_id) is the
          // "already being synced?" check now, closing the gap that used
          // to let two overlapping sync calls both decide to create a
          // fresh Google Task for the same local task (leaving one
          // orphaned, since only the last writer's id ever got tracked).
          const claimed = await sql`
            INSERT INTO synced_tasks (connection_id, familyhub_task_id, google_task_id, google_tasklist_id, last_synced_at)
            VALUES (${connection.id}, ${task.id}, ${'pending:' + task.id}, ${taskListId}, NOW())
            ON CONFLICT (connection_id, familyhub_task_id) DO NOTHING
            RETURNING id
          `
          if (claimed.length === 0) continue
          claimedSyncId = claimed[0].id
        } else {
          // Update existing task
          const updateRes = await fetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${googleTaskId}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(taskData),
            }
          )

          if (!updateRes.ok) {
            // Task may have been deleted on Google's side - fall through
            // to create a replacement below.
            googleTaskId = null
          }
        }

        if (!googleTaskId) {
          // Create new task
          const createRes = await fetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(taskData),
            }
          )

          if (createRes.ok) {
            const newTask = await createRes.json()
            googleTaskId = newTask.id
          } else {
            errors++
            continue
          }
        }

        if (claimedSyncId) {
          await sql`UPDATE synced_tasks SET google_task_id = ${googleTaskId}, last_synced_at = NOW() WHERE id = ${claimedSyncId}`
        } else {
          await sql`
            UPDATE synced_tasks SET google_task_id = ${googleTaskId}, last_synced_at = NOW()
            WHERE connection_id = ${connection.id} AND familyhub_task_id = ${task.id}
          `
        }

        synced++
      } catch (err) {
        console.error('Error syncing task:', task.id, err)
        errors++
      }
    }

    // Update last sync time
    await sql`
      UPDATE calendar_sync_connections SET last_sync_at = NOW() WHERE id = ${connection.id}
    `

    return NextResponse.json({
      success: true,
      synced,
      pulled,
      errors,
      message: `Synced ${synced} task(s) to Google Tasks, pulled ${pulled} change(s) from Google Tasks` +
        `${errors > 0 ? `, ${errors} error(s)` : ''}`,
    })
  } catch (error) {
    console.error('Task sync error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to sync tasks' },
      { status: 500 }
    )
  }
}

// Toggle task sync on/off
export async function PATCH(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || 'Not authenticated' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { syncTasks } = body

    if (typeof syncTasks !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'syncTasks must be a boolean' },
        { status: 400 }
      )
    }

    const result = await sql`
      UPDATE calendar_sync_connections
      SET sync_tasks = ${syncTasks}
      WHERE user_id = ${user.id} AND provider = 'google' AND sync_enabled = true
      RETURNING id
    `

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No Google connection found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, syncTasks })
  } catch (error) {
    console.error('Toggle task sync error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update task sync setting' },
      { status: 500 }
    )
  }
}
