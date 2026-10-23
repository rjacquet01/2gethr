import { del } from "@vercel/blob"
import { sql } from "@/lib/db"
import { revokeAllUserTokens } from "@/lib/auth"
import { stripe } from "@/lib/stripe"
import { ensureSocialTables } from "@/lib/social"
import { deleteFlyerFiles, ensureBoardFlyerColumns, type FlyerFileRow } from "@/lib/board-flyers"

// Shared account-closure logic used by both self-service deletion
// (/api/account/delete) and admin closure of ToS-violating accounts.
// Scrubs personal data, hands off or removes owned families, cancels Stripe
// billing and permanently deactivates the login. The users row is kept
// (anonymised) because shared family data still references it.
export async function closeUserAccount(user: { id: string; email: string }): Promise<void> {
    // 1. Hand off any families this user owns.
    const ownedFamilies = await sql`
      SELECT id FROM families WHERE owner_id = ${user.id}
    `

    for (const family of ownedFamilies) {
      const remaining = await sql`
        SELECT user_id, role FROM family_members
        WHERE family_id = ${family.id} AND user_id != ${user.id} AND is_active = true
          AND role <> 'GUEST'
        ORDER BY
          CASE role WHEN 'PARENT' THEN 0 WHEN 'GUARDIAN' THEN 1 WHEN 'ADULT' THEN 2 ELSE 3 END,
          joined_at ASC
      `
      // A child never inherits ownership (it would let a kid manage invites,
      // remove members or delete the family).
      const otherMembers = remaining.filter((m) => m.role !== 'CHILD')
      const onlyChildrenLeft = otherMembers.length === 0 && remaining.length > 0

      if (onlyChildrenLeft) {
        // Keep the family so the children keep their data; ownership stays
        // with this (closed) account. Its paid plan ends, since the person
        // paying for it is gone.
        const subs = await sql`
          SELECT stripe_subscription_id FROM subscriptions
          WHERE family_id = ${family.id} AND stripe_subscription_id IS NOT NULL
        `
        for (const sub of subs) {
          try {
            await stripe.subscriptions.cancel(sub.stripe_subscription_id)
          } catch (err) {
            console.error('Failed to cancel Stripe subscription during account deletion:', err)
          }
        }
      } else if (otherMembers.length > 0) {
        // Transfer ownership to the longest-standing parent/guardian/adult (or
        // whoever else is left) so the family and its data keep existing
        // for the remaining members. A guest never inherits ownership.
        await sql`
          UPDATE families SET owner_id = ${otherMembers[0].user_id}, updated_at = NOW()
          WHERE id = ${family.id}
        `
      } else {
        // This user was the only member - cancel any active Stripe
        // subscription before the family (and its subscription row) is
        // removed, so we don't leave an orphaned recurring charge running.
        const subs = await sql`
          SELECT stripe_subscription_id FROM subscriptions
          WHERE family_id = ${family.id} AND stripe_subscription_id IS NOT NULL
        `
        for (const sub of subs) {
          try {
            await stripe.subscriptions.cancel(sub.stripe_subscription_id)
          } catch (err) {
            // Continue even if Stripe cancellation fails (e.g. already
            // cancelled) - we still want to delete the local family data.
            console.error('Failed to cancel Stripe subscription during account deletion:', err)
          }
        }

        // Board posts have no foreign key to families: delete their flyer
        // photo files, then the posts and comments, before the family goes.
        await ensureBoardFlyerColumns()
        const famFlyers = await sql`
          SELECT id, flyer_full_url, flyer_thumb_url FROM family_posts
          WHERE family_id = ${family.id} AND flyer_full_url IS NOT NULL
        `
        const famDone = await deleteFlyerFiles(famFlyers as FlyerFileRow[])
        if (famDone.size < famFlyers.length) throw new Error('Could not delete board flyer photos; try again')
        await sql`DELETE FROM family_post_comments WHERE family_id = ${family.id}`
        await sql`DELETE FROM family_posts WHERE family_id = ${family.id}`

        // Cascades to family_members, calendars -> events, tasks,
        // subscriptions, calendar_sync_connections, saved_places, etc.
        await sql`DELETE FROM families WHERE id = ${family.id}`
      }
    }

    // 2. Delete data this user directly owns, wherever it can be removed
    // without breaking other users' shared family data.
    await sql`DELETE FROM user_favorites WHERE user_id = ${user.id}`
    await sql`DELETE FROM notifications WHERE user_id = ${user.id}`
    await sql`DELETE FROM location_pings WHERE user_id = ${user.id}`
    await sql`DELETE FROM geofence_events WHERE user_id = ${user.id}`
    await sql`
      DELETE FROM location_settings
      WHERE family_member_id IN (SELECT id FROM family_members WHERE user_id = ${user.id})
    `
    await sql`DELETE FROM task_comments WHERE user_id = ${user.id}`
    // Event comments and family board posts/comments are removed like task
    // comments. A removed post takes the replies under it with it.
    await ensureSocialTables()
    await ensureBoardFlyerColumns()
    // Flyer photo files go first, so none outlive their post.
    const myFlyers = await sql`
      SELECT id, flyer_full_url, flyer_thumb_url FROM family_posts
      WHERE user_id = ${user.id} AND flyer_full_url IS NOT NULL
    `
    const myDone = await deleteFlyerFiles(myFlyers as FlyerFileRow[])
    if (myDone.size < myFlyers.length) throw new Error('Could not delete board flyer photos; try again')
    await sql`DELETE FROM event_comments WHERE user_id = ${user.id}`
    await sql`
      DELETE FROM family_post_comments
      WHERE user_id = ${user.id} OR post_id IN (SELECT id FROM family_posts WHERE user_id = ${user.id})
    `
    await sql`DELETE FROM family_posts WHERE user_id = ${user.id}`
    await sql`DELETE FROM social_push_log WHERE user_id = ${user.id}`
    await sql`DELETE FROM task_history WHERE user_id = ${user.id}`
    await sql`UPDATE tasks SET assigned_to_id = NULL WHERE assigned_to_id = ${user.id}`
    await sql`DELETE FROM event_participants WHERE user_id = ${user.id}`
    await sql`DELETE FROM reminder_settings WHERE user_id = ${user.id}`
    await sql`DELETE FROM consents WHERE user_id = ${user.id}`
    await sql`DELETE FROM calendar_sync_connections WHERE user_id = ${user.id}`
    await sql`DELETE FROM password_reset_tokens WHERE user_id = ${user.id}`
    // Devices stop receiving this account's notifications.
    await sql`DELETE FROM push_tokens WHERE user_id = ${user.id}`
    // The profile photo file itself, not just the link to it below.
    const photo = await sql`SELECT profile_photo_url FROM users WHERE id = ${user.id}`
    if (photo[0]?.profile_photo_url) {
      try {
        await del(photo[0].profile_photo_url as string)
      } catch (err) {
        if (!/NotFound/i.test((err as Error)?.name || "")) throw new Error("Could not delete your profile photo; try again")
      }
    }

    // Any remaining family memberships (families this user didn't own)
    await sql`DELETE FROM family_members WHERE user_id = ${user.id}`

    // 3. Revoke all sessions.
    await revokeAllUserTokens(user.id)

    // 4. Scrub personal data and permanently deactivate the account.
    // The row itself stays (events/tasks created in shared family calendars
    // may still reference it), but every identifying field is cleared and
    // the account can never be logged into again.
    const anonymizedEmail = `deleted-${user.id}@deleted.togethrapp.com`
    await sql`
      UPDATE users
      SET
        email = ${anonymizedEmail},
        password_hash = 'DELETED',
        first_name = 'Deleted',
        last_name = 'User',
        phone = NULL,
        date_of_birth = NULL,
        profile_photo_url = NULL,
        profile_photo_path = NULL,
        is_active = false,
        updated_at = NOW()
      WHERE id = ${user.id}
    `
}
