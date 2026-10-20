// Consent wording shared by the screens and the server (no server imports).
// The server stores CHILD_CONSENT_TEXT with every parental consent record.

/** Terms of Service / Privacy Policy version accepted at sign-up (their "Last updated" date). */
export const TERMS_VERSION = "2026-10-19"

/** Bump when CHILD_CONSENT_STATEMENT or CHILD_DATA_NOTICE changes. */
export const CHILD_CONSENT_VERSION = "child-consent-2026-10-19"

export const CHILD_CONSENT_STATEMENT =
  "I am this child's parent or legal guardian, and I consent to Togethr collecting and using my child's information as described here."

/** The short "what we collect from your child" notice shown next to the consent box. */
export const CHILD_DATA_NOTICE: readonly string[] = [
  "Their name and date of birth (school, grade and notes only if you add them).",
  "Calendar events, tasks, messages and board posts your family creates.",
  "Location only if you turn it on for them. It is off by default.",
  "No ads, no selling of data, no third-party tracking.",
  "You can review, change or delete this information, or withdraw consent, at any time in Family, or by emailing admin@mytogethr.com.",
]

/** Exactly what is stored as the consent text for CHILD_CONSENT_VERSION. */
export const CHILD_CONSENT_TEXT = [CHILD_CONSENT_STATEMENT, ...CHILD_DATA_NOTICE.map((l) => `- ${l}`)].join("\n")

/** Sign-up confirmations (adults only). */
export const AGE_CONFIRMATION_LABEL = "I am 18 or older"
