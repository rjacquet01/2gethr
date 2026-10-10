import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { sql } from '@/lib/db'
import { getUserFromRequest, logAuditEvent } from '@/lib/auth'
import { collectUserExport, type ExportRow, type UserExport } from '@/lib/data-export'

// Account data export. GET /api/user/export?format=xlsx (default) | json
//
// - xlsx: one sheet per section plus a "README" sheet, for people.
// - json: everything in one machine-readable file (data portability).
// The response is streamed so large exports are not held to the 4.5 MB
// serverless response limit, and one export per user is allowed every
// 2 minutes so the endpoint cannot be used to hammer the database.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MIN_INTERVAL_SECONDS = 120
const XLSX_MAX_ROWS = 1_000_000
const XLSX_MAX_CELL = 32_000

function cell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.length > XLSX_MAX_CELL ? v.slice(0, XLSX_MAX_CELL) + '…' : v
  const j = JSON.stringify(v)
  return j.length > XLSX_MAX_CELL ? j.slice(0, XLSX_MAX_CELL) + '…' : j
}

function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet'
  let n = base
  let i = 2
  while (used.has(n.toLowerCase())) n = base.slice(0, 28) + ' ' + i++
  used.add(n.toLowerCase())
  return n
}

function buildXlsx(data: UserExport): Buffer {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  const readme: (string | number)[][] = [
    ['Togethr data export'],
    ['Generated', data.manifest.generatedAt],
    [],
    ['Sheet', 'Rows', 'Description'],
  ]
  for (const s of data.sections) {
    readme.push([s.name, s.rows.length, s.description + (s.truncated ? ' (limited to the most recent rows)' : '')])
  }
  readme.push([], ['Not included'])
  for (const x of data.manifest.excluded) readme.push([x])
  if (data.manifest.notes.length) {
    readme.push([], ['Notes'])
    for (const n of data.manifest.notes) readme.push([n])
  }
  if (data.manifest.errors.length) {
    readme.push([], ['Sections that could not be read'])
    for (const e of data.manifest.errors) readme.push([e.section, e.message])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), sheetName('README', used))

  for (const s of data.sections) {
    const rows = s.rows.slice(0, XLSX_MAX_ROWS)
    const out: ExportRow[] =
      rows.length > 0
        ? rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])))
        : [{ Info: 'No data' }]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), sheetName(s.name, used))
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function streamJson(data: UserExport): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const parts: (() => string)[] = [() => `{"manifest":${JSON.stringify(data.manifest)},"data":{`]
  data.sections.forEach((s, i) => {
    parts.push(() => `${i ? ',' : ''}${JSON.stringify(s.name)}:[`)
    // Write rows in slices so no single chunk is huge.
    const SLICE = 500
    for (let o = 0; o < s.rows.length; o += SLICE) {
      parts.push(() => {
        const chunk = s.rows.slice(o, o + SLICE).map((r) => JSON.stringify(r)).join(',')
        return (o ? ',' : '') + chunk
      })
    }
    parts.push(() => ']')
  })
  parts.push(() => '}}')
  let idx = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (idx >= parts.length) return controller.close()
      controller.enqueue(enc.encode(parts[idx++]()))
    },
  })
}

function streamBuffer(buf: Buffer): ReadableStream<Uint8Array> {
  const CHUNK = 256 * 1024
  let o = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (o >= buf.length) return controller.close()
      controller.enqueue(new Uint8Array(buf.subarray(o, o + CHUNK)))
      o += CHUNK
    },
  })
}

export async function GET(request: Request) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const format = (url.searchParams.get('format') || 'xlsx').toLowerCase()
    if (format !== 'xlsx' && format !== 'json') {
      return NextResponse.json({ error: 'format must be xlsx or json' }, { status: 400 })
    }

    // Light rate limit using the audit log.
    try {
      const recent = await sql`
        SELECT 1 FROM audit_logs
        WHERE user_id = ${user.id} AND action = 'EXPORT' AND entity_type = 'user_data'
          AND created_at > NOW() - (${MIN_INTERVAL_SECONDS} * INTERVAL '1 second')
        LIMIT 1
      `
      if (recent.length > 0) {
        return NextResponse.json(
          { error: 'You just exported your data. Please wait a couple of minutes and try again.' },
          { status: 429, headers: { 'Retry-After': String(MIN_INTERVAL_SECONDS) } }
        )
      }
    } catch (e) {
      console.error('Export rate-limit check failed (continuing):', e)
    }

    const data = await collectUserExport(user.id, format)

    // Record the export (best effort - never block the user's own data).
    try {
      await logAuditEvent(user.id, 'EXPORT', 'user_data', user.id, {
        metadata: { format, sections: data.manifest.sections.length, errors: data.manifest.errors.length },
        ipAddress: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      })
    } catch (e) {
      console.error('Export audit log failed (continuing):', e)
    }

    const stamp = new Date().toISOString().split('T')[0]
    if (format === 'json') {
      return new Response(streamJson(data), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="togethr-export-${stamp}.json"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return new Response(streamBuffer(buildXlsx(data)), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="togethr-export-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Failed to export your data. Please try again.' }, { status: 500 })
  }
}
