import dns from "node:dns"
import https from "node:https"
import net from "node:net"
import type { LookupAddress, LookupOptions } from "node:dns"

// Fetching a URL a user typed (iCal import): https on port 443 only, never an
// internal address. Every address is checked inside the connection's own DNS
// lookup, so a name that resolves to a private address (or switches to one
// between a check and the connect) is refused; a literal IP is checked before
// connecting. Redirects are followed by hand, each hop checked the same way.
// The body is read with a byte cap. Error messages never include the upstream
// status or text: a caller can't use them to probe internal hosts.

export class UnsafeUrlError extends Error {}

const blocked = new net.BlockList()
for (const [net4, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net4, bits, "ipv4")
for (const [net6, bits] of [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net6, bits, "ipv6")

/** IPv4 inside an IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::a.b.c.d) IPv6 address. */
function embeddedIpv4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/)
  if (!m) return null
  if (m[1]) return m[1]
  const hi = parseInt(m[2], 16)
  const lo = parseInt(m[3], 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

/** True only for a routable public address. */
export function isPublicIp(ip: string): boolean {
  const kind = net.isIP(ip)
  if (kind === 4) return !blocked.check(ip, "ipv4")
  if (kind === 6) {
    const v4 = embeddedIpv4(ip)
    if (v4) return net.isIPv4(v4) && !blocked.check(v4, "ipv4")
    return !blocked.check(ip, "ipv6")
  }
  return false
}

/** https (webcal is https) on the default port, with a host; throws UnsafeUrlError otherwise. */
export function checkFetchUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim().replace(/^webcal:\/\//i, "https://"))
  } catch {
    throw new UnsafeUrlError("That isn't a valid link")
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https:// or webcal:// links can be imported")
  if (url.port && url.port !== "443") throw new UnsafeUrlError("That link uses a port that isn't allowed")
  if (url.username || url.password) throw new UnsafeUrlError("Links with a user name or password aren't allowed")
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (!host) throw new UnsafeUrlError("That isn't a valid link")
  if (net.isIP(host) && !isPublicIp(host)) throw new UnsafeUrlError("That address can't be imported")
  return url
}

type Resolver = (host: string, cb: (err: Error | null, addrs: LookupAddress[]) => void) => void
let resolve: Resolver = (host, cb) => dns.lookup(host, { all: true, verbatim: true }, cb)

/** Tests: replace DNS. */
export function __setResolverForTests(r: Resolver | null) {
  resolve = r ?? ((host, cb) => dns.lookup(host, { all: true, verbatim: true }, cb))
}

/** dns.lookup for https.request that refuses a name with any non-public address. */
function guardedLookup(
  host: string,
  opts: LookupOptions,
  cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
) {
  resolve(host, (err, addrs) => {
    if (err) return cb(err, "")
    if (addrs.length === 0 || addrs.some((a) => !isPublicIp(a.address))) {
      return cb(Object.assign(new UnsafeUrlError("That address can't be imported"), { code: "EUNSAFE" }), "")
    }
    if (opts.all) return cb(null, addrs)
    cb(null, addrs[0].address, addrs[0].family)
  })
}

interface FetchOpts {
  maxBytes: number
  timeoutMs?: number
  maxRedirects?: number
  accept?: string
}

/** One GET; resolves with the status, the Location header and (for 200) the capped body. */
function getOnce(url: URL, opts: FetchOpts, signal: AbortSignal): Promise<{ status: number; location?: string; body?: Buffer }> {
  return new Promise((done, fail) => {
    const req = https.request(
      url,
      { method: "GET", lookup: guardedLookup, signal, headers: { Accept: opts.accept ?? "*/*", "User-Agent": "Togethr calendar import" } },
      (res) => {
        const status = res.statusCode ?? 0
        if (status !== 200) {
          res.resume()
          return done({ status, location: typeof res.headers.location === "string" ? res.headers.location : undefined })
        }
        const declared = Number(res.headers["content-length"])
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy()
          return fail(new UnsafeUrlError("TOO_LARGE"))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on("data", (c: Buffer) => {
          size += c.length
          if (size > opts.maxBytes) {
            res.destroy()
            fail(new UnsafeUrlError("TOO_LARGE"))
            return
          }
          chunks.push(c)
        })
        res.on("end", () => done({ status, body: Buffer.concat(chunks) }))
        res.on("error", fail)
      }
    )
    req.on("error", fail)
    req.end()
  })
}

/**
 * GET a user-supplied https URL safely. Throws UnsafeUrlError with a
 * user-safe message ("TOO_LARGE" when over maxBytes); any other failure
 * becomes a generic UnsafeUrlError too.
 */
export async function fetchPublicUrl(raw: string, opts: FetchOpts): Promise<Buffer> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000)
  let url = checkFetchUrl(raw)
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    let r: Awaited<ReturnType<typeof getOnce>>
    try {
      r = await getOnce(url, opts, signal)
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw e
      throw new UnsafeUrlError("Couldn't download that calendar")
    }
    if (r.status === 200 && r.body) return r.body
    if ([301, 302, 303, 307, 308].includes(r.status) && r.location) {
      let next: string
      try {
        next = new URL(r.location, url).toString()
      } catch {
        break
      }
      url = checkFetchUrl(next)
      continue
    }
    break
  }
  throw new UnsafeUrlError("Couldn't download that calendar")
}
