// When an admin or super admin account is created: a summary to the admin
// mailbox and a confirmation to the new admin's own address. Neither email
// carries the password; the person who created the account hands it over.
import { appUrl } from '@/lib/app-url'
import { escapeHtml, sendEmail } from '@/lib/services/email'

export const ADMIN_MAILBOX = 'admin@mytogethr.com'

export interface CreatedAdmin {
  email: string
  firstName: string
  lastName: string
  role: string
}

const roleLabel = (role: string) => (role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin')

/** createdBy: "Jane Doe (jane@...)" or null for the first-time setup page. */
export function adminCreatedEmails(admin: CreatedAdmin, createdBy: string | null, at: Date = new Date()) {
  const name = `${admin.firstName} ${admin.lastName}`.trim()
  const role = roleLabel(admin.role)
  const by = createdBy ?? 'First-time setup'
  const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(at) + ' ET'
  const loginUrl = `${appUrl()}/admin/login`
  const rows: [string, string][] = [['Name', name], ['Email', admin.email], ['Role', role], ['Created by', by], ['Created', when]]
  const table = `<table style="border-collapse: collapse;">${rows
    .map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">${k}</td><td style="padding: 4px 0;"><strong>${escapeHtml(v)}</strong></td></tr>`)
    .join('')}</table>`
  const textRows = rows.map(([k, v]) => `${k}: ${v}`).join('\n')

  const summary = {
    to: ADMIN_MAILBOX,
    subject: `New ${role} account: ${name}`,
    html: `<h2 style="color: #3b4563;">New ${role} account created</h2>${table}<p>If this wasn't expected, deactivate it in the admin portal under Settings, Admin Users.</p>`,
    text: `New ${role} account created\n\n${textRows}\n\nIf this wasn't expected, deactivate it in the admin portal under Settings, Admin Users.`,
  }
  const confirmation = {
    to: admin.email,
    subject: `Your Togethr ${role} account was created`,
    html: `<h2 style="color: #3b4563;">Hi ${escapeHtml(admin.firstName)},</h2><p>A Togethr ${role} account was created for you.</p>${table}<p><a href="${loginUrl}" style="display: inline-block; background-color: #3b4563; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Sign in to the admin portal</a></p><p>Your password comes from the person who created the account. After signing in, change it under Settings, Security, and turn on two-step verification.</p><p style="color: #6b7280; font-size: 14px;">Didn't expect this? Reply to this email or write to ${ADMIN_MAILBOX}.</p>`,
    text: `Hi ${admin.firstName},\n\nA Togethr ${role} account was created for you.\n\n${textRows}\n\nSign in: ${loginUrl}\n\nYour password comes from the person who created the account. After signing in, change it under Settings, Security, and turn on two-step verification.\n\nDidn't expect this? Write to ${ADMIN_MAILBOX}.`,
    replyTo: ADMIN_MAILBOX,
  }
  return { summary, confirmation }
}

/** Sends both emails. Never throws: the account already exists either way. */
export async function sendAdminCreatedEmails(admin: CreatedAdmin, createdBy: string | null): Promise<void> {
  const { summary, confirmation } = adminCreatedEmails(admin, createdBy)
  const results = await Promise.allSettled([sendEmail(summary), sendEmail(confirmation)])
  results.forEach((r, i) => {
    const which = i === 0 ? 'summary' : 'confirmation'
    if (r.status === 'rejected') console.error(`[admin-created] ${which} email threw:`, r.reason)
    else if (!r.value.success) console.error(`[admin-created] ${which} email failed:`, r.value.error)
  })
}
