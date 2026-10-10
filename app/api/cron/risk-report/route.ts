import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { sendEmail, ADMIN_EMAIL } from "@/lib/services/email"

// Weekly risk-flag report emailed to the admin mailbox (Mondays 12:00 UTC,
// ~8am Eastern). Always sends, even with zero flags, so silence means the
// job is broken rather than "all clear".

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization")
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const counts = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open,
        COUNT(*) FILTER (WHERE status = 'INVESTIGATING')::int AS investigating,
        COUNT(*) FILTER (WHERE status = 'ESCALATED')::int AS escalated,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL' AND status NOT IN ('RESOLVED','DISMISSED'))::int AS critical,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_week,
        COUNT(*) FILTER (WHERE status IN ('RESOLVED','DISMISSED') AND updated_at > NOW() - INTERVAL '7 days')::int AS closed_week
      FROM risk_flags
    `
    const active = await sql`
      SELECT rf.flag_type, rf.severity, rf.status, rf.description, rf.created_at,
             u.email AS user_email, f.name AS family_name
      FROM risk_flags rf
      LEFT JOIN users u ON u.id = rf.user_id
      LEFT JOIN families f ON f.id = rf.family_id
      WHERE rf.status IN ('OPEN','INVESTIGATING','ESCALATED')
      ORDER BY CASE rf.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
               rf.created_at DESC
      LIMIT 50
    `
    const closedAccts = await sql`
      SELECT COUNT(*)::int AS n FROM users
      WHERE email LIKE 'deleted-%@deleted.togethrapp.com' AND updated_at > NOW() - INTERVAL '7 days'
    `
    const c = counts[0]
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://mytogethr.com"

    const rows = active.length
      ? active.map((r) => `<tr>
          <td style="padding:6px;border-bottom:1px solid #eee"><b>${esc(r.severity)}</b></td>
          <td style="padding:6px;border-bottom:1px solid #eee">${esc(String(r.flag_type).replace(/_/g, " "))}</td>
          <td style="padding:6px;border-bottom:1px solid #eee">${esc(r.description)}<br><span style="color:#888;font-size:12px">${esc(r.user_email || r.family_name || "")} - ${esc(r.status)}</span></td>
        </tr>`).join("")
      : `<tr><td colspan="3" style="padding:12px;color:#555">No open risk flags.</td></tr>`

    const html = `<div style="font-family:Arial,sans-serif;max-width:640px">
      <h2>Togethr weekly risk report</h2>
      <p><b>${c.open}</b> open - <b>${c.investigating}</b> investigating - <b>${c.escalated}</b> escalated - <b style="color:#b00">${c.critical}</b> critical<br>
      ${c.new_week} new this week - ${c.closed_week} resolved/dismissed this week - ${closedAccts[0].n} accounts closed this week</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>
      <p><a href="${appUrl}/admin/risk-flags">Open the risk flags queue</a></p></div>`
    const text = `Togethr weekly risk report\nOpen ${c.open}, investigating ${c.investigating}, escalated ${c.escalated}, critical ${c.critical}\nNew this week ${c.new_week}, resolved ${c.closed_week}, accounts closed ${closedAccts[0].n}\n\n` +
      active.map((r) => `[${r.severity}] ${r.flag_type}: ${r.description}`).join("\n") +
      `\n\n${appUrl}/admin/risk-flags`

    const result = await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Togethr weekly risk report: ${c.open + c.investigating + c.escalated} active flag(s)${c.critical ? `, ${c.critical} CRITICAL` : ""}`,
      html,
      text,
    })
    return NextResponse.json({ success: true, emailed: ADMIN_EMAIL, result })
  } catch (error) {
    console.error("Risk report error:", error)
    return NextResponse.json({ error: "Failed to send risk report" }, { status: 500 })
  }
}
