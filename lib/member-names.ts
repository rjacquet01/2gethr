import { sql } from "./db"

// One name per person, wherever a family shows them. A name is stored in
// three places (family_members.nickname, child_profiles.display_name,
// users.first_name/last_name) and screens used to pick among them in
// different orders. The rule, everywhere:
//
//   A child (role CHILD): the profile name their parent gave them, then
//     their nickname, then their account first name. The profile name comes
//     first because children renamed before nicknames were kept in step can
//     still have an old nickname (no data migration).
//   Everyone else: their family nickname, if set (the "Name shown to this
//     family", which an adult sets for themselves on the Family page, per
//     family), then their account first name. A child profile left over
//     after an 18th-birthday promotion is ignored.
//   Account names add the last name only on screens that showed last names
//   before, so nobody sees a last name they couldn't see. Then a fallback
//   ("Family member", or something that fits the sentence).
//
// Keeping the stored names in step:
// - A child's nickname follows their profile name (setChildName), and a
//   child login's first name too. A child can't rename themselves.
// - When an adult changes their account name, a family nickname that was
//   just their old name follows it; a nickname they chose themselves stays.

export interface NameParts {
  role?: string | null
  nickname?: string | null
  childDisplayName?: string | null
  firstName?: string | null
  lastName?: string | null
}

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "")

/** The name a family shows for this member (see the rule above). */
export function memberName(p: NameParts, opts: { withLastName?: boolean; fallback?: string } = {}): string {
  const order = p.role === "CHILD" ? [p.childDisplayName, p.nickname] : [p.nickname]
  for (const n of order) if (clean(n)) return clean(n)
  const account = [clean(p.firstName), opts.withLastName ? clean(p.lastName) : ""].filter(Boolean).join(" ")
  return account || (opts.fallback ?? "Family member")
}

/**
 * The same rule in SQL (first name only), for queries that need the name in
 * the database. Expects the aliases fm (family_members), cp (child_profiles,
 * LEFT JOINed) and u (users, LEFT JOINed). The database client can't splice
 * fragments, so queries repeat this text exactly; scripts/test-member-names.ts
 * checks every copy.
 */
export const MEMBER_NAME_SQL =
  "CASE WHEN fm.role = 'CHILD' THEN COALESCE(NULLIF(TRIM(cp.display_name), ''), NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) ELSE COALESCE(NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) END"

/**
 * A task's assignee as the family sees them: a child profile it is assigned
 * to, else the assigned account's name in the task's family (the task
 * queries join that membership as fm_a / cp_a). Null when unassigned.
 */
export function taskAssigneeName(t: Record<string, unknown>): string | null {
  if (clean(t.child_display_name)) return clean(t.child_display_name)
  if (!t.assigned_to_id) return null
  return memberName(
    {
      role: t.assignee_role as string | null,
      nickname: t.assignee_nickname as string | null,
      childDisplayName: t.assignee_child_name as string | null,
      firstName: t.assignee_first_name as string | null,
      lastName: t.assignee_last_name as string | null,
    },
    { withLastName: true }
  )
}

/**
 * An event participant as the family sees them: the child profile they were
 * added as, else their membership in the event's family (the event queries
 * join it as fm / cpm).
 */
export function participantName(p: Record<string, unknown>): string {
  if (clean(p.child_name)) return clean(p.child_name)
  return memberName(
    {
      role: p.role as string | null,
      nickname: p.nickname as string | null,
      childDisplayName: p.member_child_name as string | null,
      firstName: p.first_name as string | null,
      lastName: p.last_name as string | null,
    },
    { withLastName: true }
  )
}

/** This person's name in this family (for alerts sent to the family). */
export async function nameInFamily(familyId: string, userId: string, fallback = "Family member"): Promise<string> {
  const rows = await sql`
    SELECT CASE WHEN fm.role = 'CHILD' THEN COALESCE(NULLIF(TRIM(cp.display_name), ''), NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) ELSE COALESCE(NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) END AS name
    FROM family_members fm
    LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
    LEFT JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ${familyId} AND fm.user_id = ${userId} AND fm.is_active = true
    LIMIT 1
  `
  return (rows[0]?.name as string | null) || fallback
}

/**
 * The person doing something ("Mia assigned you a task"), named as this
 * family knows them. Not a member there (or no family): their account first
 * name, then the sentence's own fallback ("Someone", "A parent").
 */
export async function actorNameInFamily(
  familyId: string | null | undefined,
  user: { id: string; firstName?: string | null },
  fallback: string
): Promise<string> {
  const account = clean(user.firstName) || fallback
  return familyId ? nameInFamily(familyId, user.id, account) : account
}

/** Give a child membership this name everywhere (profile, nickname, own login). */
export async function setChildName(memberId: string, name: string): Promise<void> {
  const name_ = name.trim()
  if (!name_) return
  await sql`UPDATE child_profiles SET display_name = ${name_}, updated_at = NOW() WHERE family_member_id = ${memberId}`
  const rows = await sql`
    UPDATE family_members SET nickname = ${name_}, updated_at = NOW()
    WHERE id = ${memberId} AND role = 'CHILD'
    RETURNING user_id
  `
  const userId = rows[0]?.user_id as string | null | undefined
  // The login's last name is left alone: family screens show a child by
  // their profile name, and nothing needs it cleared.
  if (userId) await sql`UPDATE users SET first_name = ${name_}, updated_at = NOW() WHERE id = ${userId}`
}

/** Copy a child's current profile name to their nickname and login (if it has one). */
export async function syncChildNameFromProfile(memberId: string): Promise<void> {
  const rows = await sql`SELECT display_name FROM child_profiles WHERE family_member_id = ${memberId} LIMIT 1`
  const name = rows[0]?.display_name as string | null | undefined
  if (name && name.trim()) await setChildName(memberId, name)
}

/**
 * After an adult changes their account name: in each family where their
 * nickname was just their old name (first, or first and last), it becomes
 * the new first name. A nickname they picked themselves is kept.
 */
export async function syncAdultNicknames(userId: string, old: { firstName?: string | null; lastName?: string | null }): Promise<void> {
  const oldFirst = clean(old.firstName).toLowerCase()
  const oldFull = [clean(old.firstName), clean(old.lastName)].filter(Boolean).join(" ").toLowerCase()
  if (!oldFirst && !oldFull) return
  await sql`
    UPDATE family_members fm SET nickname = u.first_name, updated_at = NOW()
    FROM users u
    WHERE u.id = ${userId} AND fm.user_id = u.id AND fm.role <> 'CHILD'
      AND COALESCE(TRIM(u.first_name), '') <> ''
      AND LOWER(TRIM(fm.nickname)) IN (${oldFirst}, ${oldFull})
  `
}

/** Is this login a child account (in any family)? Its name is set by a parent. */
export async function isChildLogin(userId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM family_members WHERE user_id = ${userId} AND role = 'CHILD' LIMIT 1`
  return rows.length > 0
}
