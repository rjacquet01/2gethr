# Runbook: a child under 13 (or a parent's request)

Use this when someone tells us (support email to admin@mytogethr.com, an in-app ticket, a review, anything) that:

- **A.** a child under 13 has an account or is in a family **without a parent's consent**, or
- **B.** a parent wants to **review, delete, or withdraw consent** for their child's information and can't do it in the app.

Togethr is for adults 18+. Children exist in Togethr only when a parent adds them (with recorded consent), so case A should not happen. Treat it as urgent anyway.

> This is an operations guide, not legal advice. The time limits below are our own targets; counsel should confirm them.

## 1. Acknowledge (within 2 business days)

Reply to the sender: we received the report, we'll look into it, and we'll confirm when it's done. Don't ask a child for more personal information.

## 2. Find the account

Admin panel > **Users**: search by the email given. Note:
- whether it is a **login** (has an email) or a **child profile without a login** (a name inside a family);
- which family or families it belongs to and who the parents are;
- whether any parental consent is on record (the parent can see it under Family > the child > **Consent**; it is also in the `parental_consents` table).

## 3. Verify (before acting on a parent's request)

- **Case A (child without a parent):** no verification is needed to **delete**. Deleting is the safe direction. Go to step 4.
- **Case B (a parent asks):** confirm the requester is that child's parent:
  - The request must come **from the email address on file** for a PARENT member of the child's family. If it came from another address, email the address on file and ask them to confirm by replying.
  - Never send a child's information to an address that isn't a parent's on file.
  - If no parent account exists, or you can't verify: don't disclose anything. Delete only if the request is to delete.

## 4. Act (delete within 10 business days of step 3)

| Situation | How |
|---|---|
| Parent can do it themselves | Point them to **Family > the child > Consent > Withdraw consent**. It deletes the child's profile, login and location data right away. |
| A child **login** (has an email) | Admin panel > Users > the user > **Close Account (permanent)**. This runs the same account closure as self-deletion: sessions revoked, personal fields scrubbed, location history and memberships deleted. |
| A child **profile without a login** | Ask a parent in the family to use Remove (or Withdraw consent), which deletes the profile. **TODO:** there is no admin-panel button for this yet; until there is, an engineer runs `deleteChildData()` from `lib/parental-consent.ts` for that member. |
| Parent wants a copy first | They can download it in Settings > **Export my data** (it includes their children's profiles and the consent records). |

Things that are **not** deleted: events and tasks the family created (they belong to the family; the child's name link is cleared from tasks), and the consent record itself (kept, marked withdrawn, as proof of what happened).

**Backups:** deleted data can remain in the database provider's point-in-time backups until they roll off (Neon's history window for our plan). **TODO:** confirm the window and add it here.

## 5. Confirm and record

- Email the requester that it's done (no child details in the email).
- Add a short internal note (support ticket): date received, what was deleted, by whom, date done.
- If it was case A, look at how it happened (it should be impossible) and tell engineering.
