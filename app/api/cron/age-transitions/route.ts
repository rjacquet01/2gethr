import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import { ensureAgeColumns } from "@/lib/age-schema"
import { ADULT_AGE, ageFromDob, birthdayDate, daysUntilBirthday } from "@/lib/age"

// Daily (see vercel.json). Uses each child's date of birth:
//  - 30 days before they turn 18: one heads-up to the family's PARENTs.
//  - From 18 while still a CHILD member (and not snoozed): a reminder to the
//    PARENTs, and to the member if they have a login, to choose their role.
//    At most once a week and at most 4 times; after that the card on the
//    Family page is the only reminder.
// Every send is claimed with a conditional UPDATE first, so running this
// more than once a day (or twice at the same time) never double-sends.
const NOTICE_DAYS = 30
const PROMPT_MAX = 4

function verifyCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== "production" // fail closed in production
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

const longDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })

async function parentUserIds(familyId: string): Promise<string[]> {
  const rows = await sql`
    SELECT user_id FROM family_members
    WHERE family_id = ${familyId} AND is_active = true AND role = 'PARENT' AND user_id IS NOT NULL
  `
  return rows.map((r) => r.user_id as string)
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyCronRequest(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }
    await ensureAgeColumns()

    const kids = await sql`
      SELECT cp.id, cp.display_name, to_char(cp.date_of_birth, 'YYYY-MM-DD') AS dob,
             cp.turning18_notice_sent_at, cp.adult_prompt_last_sent_at,
             COALESCE(cp.adult_prompt_count, 0) AS adult_prompt_count, cp.adult_prompt_snoozed_until,
             fm.family_id, fm.user_id, f.name AS family_name
      FROM child_profiles cp
      JOIN family_members fm ON fm.id = cp.family_member_id
      JOIN families f ON f.id = fm.family_id
      WHERE cp.date_of_birth IS NOT NULL AND fm.role = 'CHILD' AND fm.is_active = true
    `

    const now = new Date()
    let notices = 0
    let prompts = 0

    for (const k of kids) {
      const dob = k.dob as string
      const age = ageFromDob(dob, now)
      const daysTo18 = daysUntilBirthday(dob, ADULT_AGE, now)
      if (age === null || daysTo18 === null) continue
      const name = (k.display_name as string) || "Your child"

      // 1) Heads-up 30 days before the 18th birthday (once).
      if (age < ADULT_AGE && daysTo18 > 0 && daysTo18 <= NOTICE_DAYS && !k.turning18_notice_sent_at) {
        const claimed = await sql`
          UPDATE child_profiles SET turning18_notice_sent_at = NOW()
          WHERE id = ${k.id} AND turning18_notice_sent_at IS NULL
          RETURNING id
        `
        if (claimed.length > 0) {
          const on = longDate(birthdayDate(dob, ADULT_AGE) as string)
          for (const uid of await parentUserIds(k.family_id)) {
            await createNotification({
              userId: uid,
              type: "SYSTEM",
              title: `${name} turns 18 soon`,
              body: `${name} turns 18 on ${on}. After that you can switch them to Guardian or Adult.`,
              data: { subType: "TURNING_18", childProfileId: k.id, familyId: k.family_id },
            })
          }
          notices++
        }
        continue
      }

      // 2) 18+ and still a CHILD: weekly reminder, at most PROMPT_MAX times.
      if (age >= ADULT_AGE && Number(k.adult_prompt_count) < PROMPT_MAX) {
        const claimed = await sql`
          UPDATE child_profiles
          SET adult_prompt_count = COALESCE(adult_prompt_count, 0) + 1, adult_prompt_last_sent_at = NOW()
          WHERE id = ${k.id}
            AND COALESCE(adult_prompt_count, 0) < ${PROMPT_MAX}
            AND (adult_prompt_last_sent_at IS NULL OR adult_prompt_last_sent_at <= NOW() - INTERVAL '7 days')
            AND (adult_prompt_snoozed_until IS NULL OR adult_prompt_snoozed_until <= NOW())
          RETURNING id
        `
        if (claimed.length > 0) {
          for (const uid of await parentUserIds(k.family_id)) {
            await createNotification({
              userId: uid,
              type: "SYSTEM",
              title: `${name} is 18`,
              body: `${name} is now 18 - choose their role in Family.`,
              data: { subType: "ADULT_ROLE_CHOICE", childProfileId: k.id, familyId: k.family_id },
            })
          }
          if (k.user_id) {
            await createNotification({
              userId: k.user_id,
              type: "SYSTEM",
              title: "You're 18",
              body: `A parent in ${k.family_name} can now switch your account to an adult role.`,
              data: { subType: "ADULT_ROLE_CHOICE_SELF", familyId: k.family_id },
            })
          }
          prompts++
        }
      }
    }

    return NextResponse.json({ success: true, data: { checked: kids.length, notices, prompts } })
  } catch (error) {
    console.error("Age transitions cron error:", error)
    return NextResponse.json({ success: false, error: "Age transitions cron failed" }, { status: 500 })
  }
}
