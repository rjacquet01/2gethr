import { sql } from "./db"
import { isUnderLegalHold } from "./legal"

// A person's stored location history: their location points and their
// arrival/departure records. Deleted when they stop sharing (privacy policy
// section 4) and when their account is deleted (lib/account-closure.ts).

/**
 * After a member's sharing was turned off: delete the person's location
 * history, unless they still share with another family (points belong to the
 * person, not one family) or a legal hold covers them. Nothing else is touched.
 */
export async function deleteLocationHistoryAfterSharingOff(userId: string | null | undefined): Promise<"deleted" | "still-sharing" | "legal-hold" | "no-user"> {
  if (!userId) return "no-user"
  const sharing = await sql`
    SELECT 1 FROM location_settings ls
    JOIN family_members fm ON fm.id = ls.family_member_id
    WHERE fm.user_id = ${userId} AND fm.is_active = true
      AND ls.mode <> 'OFF' AND ls.share_with_family = true
    LIMIT 1
  `
  if (sharing.length > 0) return "still-sharing"
  if (await isUnderLegalHold(userId)) return "legal-hold"
  await sql`DELETE FROM location_pings WHERE user_id = ${userId}`
  await sql`DELETE FROM geofence_events WHERE user_id = ${userId}`
  return "deleted"
}
