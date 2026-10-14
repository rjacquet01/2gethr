# Law-enforcement and legal requests: internal guide

Togethr holds family location history and account information. We disclose it only
through the legal-request system in the admin area (Admin > Legal Requests). No admin,
including super admins, has standing access to location or account data.

## Who does what
- **Legal Compliance role**: assigned by a super admin (Admin > Legal Requests > Legal team). Not included in Super Admin.
- Two different people with that role are needed: one **opens** a case, another **approves** it.
- Outside counsel signs off before approval. Record who and when in the case.

## Standard requests (subpoena, warrant, court order)
1. Requester sends the document to the legal contact address. Save the signed copy; note where in the case.
2. Open a case: agency, requester, their reference, exactly whose data (person or family) and the date range the document covers. Scope the case to the document, not wider.
3. Send to counsel. Record the sign-off in the case.
4. A different approver approves, choosing an access window (default 72 hours, max 7 days). Access is read-only and ends automatically.
5. Use Export to produce one file. Its SHA-256 is recorded. Send it through the secure channel counsel specifies.
6. Close the case. If the order includes a non-disclosure instruction, mark it on the case; the family is then not notified. Otherwise use "Notify family" once the request has been answered.
7. Use **Preservation hold** if an agency asks us to preserve data while they obtain process (typically 90 days). Held data is excluded from the retention purge.

## Emergencies (imminent danger, e.g. a missing child)
- Open an **Emergency** case describing the danger. Access starts immediately for 12 hours.
- Disclose only what is needed to address the emergency.
- A different Legal admin must review it within **72 hours** and mark it justified or not. Overdue reviews show as a warning on the Legal Requests page.
- Live ping: sends the normal location request to the person's phone. It works only if their app is already sharing location; it cannot turn location on remotely. If sharing is off, use the stored location history.

## What is never available
- Message or calendar content, photos, or anything outside the case scope and date range.
- Access without an approved case or after the window closes.

## Records
Every step (case opened, counsel sign-off, approval, each data view, exports with hash, pings, notices) is written to an append-only log that cannot be edited or deleted from the application.

## Retention
Location history is purged after `LOCATION_RETENTION_DAYS` (default 90) for every plan, unless covered by an open or approved case or a preservation hold. Less stored data means less to disclose.

## Suggested privacy policy wording (have counsel review)
"We may disclose information, including location information, to law enforcement or other authorities when we believe in good faith that it is required by valid legal process (such as a subpoena, court order or warrant), or when we believe it is necessary to prevent imminent danger of death or serious physical injury. We review each request, disclose only what the request lawfully requires, and, where the law allows, notify the affected family. We keep location history for a limited period (up to 90 days)."
