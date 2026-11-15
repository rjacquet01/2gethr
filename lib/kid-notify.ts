// Who hears about what, for parents:
//  - Anything about a child (the child did it, it is the child's task or event,
//    the child arrived somewhere) reaches every parent/guardian on every channel
//    (in-app, push, email, and a text when they opted in), ignoring the
//    creator's channel picks. Each parent's own Settings toggles still apply.
//  - A parent is not told about another grown-up's own activity. Things sent
//    to them directly (their task, an invite, an approval request, SOS) are
//    decided at each send site, not here.
import { sql } from "./db"
import { createNotification, type NotificationChannel, type NotificationType } from "./notifications"

export const ALL_CHANNELS: NotificationChannel[] = ["in_app", "push", "email", "sms"]

/** Active roles of these users in the family. */
export async function familyRoles(familyId: string, userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))]
  const roles = new Map<string, string>()
  if (ids.length === 0) return roles
  const rows = await sql`
    SELECT user_id, role FROM family_members
    WHERE family_id = ${familyId} AND is_active = true AND user_id = ANY(${ids}::text[])
  `
  for (const r of rows) roles.set(r.user_id as string, r.role as string)
  return roles
}

/** Is a child involved: one of these users is a CHILD member, or a child profile is named? */
export async function involvesChild(
  familyId: string,
  who: { userIds?: (string | null | undefined)[]; childProfileId?: string | null }
): Promise<boolean> {
  if (who.childProfileId) return true
  const roles = await familyRoles(familyId, who.userIds ?? [])
  return [...roles.values()].includes("CHILD")
}

/** Parents/guardians with a login, minus the given users. */
export async function parentIds(familyId: string, exclude: (string | null | undefined)[] = []): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT user_id FROM family_members
    WHERE family_id = ${familyId} AND is_active = true
      AND role IN ('PARENT', 'GUARDIAN') AND user_id IS NOT NULL
  `
  const skip = new Set(exclude.filter(Boolean))
  return rows.map((r) => r.user_id as string).filter((id) => !skip.has(id))
}

/**
 * Tell the parents about something a child did or that concerns a child, on
 * every channel. Does nothing when no child is involved. Skips `exclude`
 * (the actor, people already told). Returns who was notified. Never throws.
 */
export async function notifyParentsAboutKid(args: {
  familyId: string
  kid: { userIds?: (string | null | undefined)[]; childProfileId?: string | null }
  exclude?: (string | null | undefined)[]
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
}): Promise<string[]> {
  try {
    if (!(await involvesChild(args.familyId, args.kid))) return []
    const ids = await parentIds(args.familyId, args.exclude)
    for (const userId of ids) {
      await createNotification({
        userId,
        type: args.type,
        title: args.title,
        body: args.body,
        data: { familyId: args.familyId, ...(args.data ?? {}) },
        channels: ALL_CHANNELS,
      })
    }
    return ids
  } catch (err) {
    console.error("[kid-notify] parent notice failed (non-fatal):", err instanceof Error ? err.message : err)
    return []
  }
}
