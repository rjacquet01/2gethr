/**
 * Minimal, dependency-free Web Push sender.
 *
 * Implements just enough of RFC 8291 (message encryption) and RFC 8292
 * (VAPID) to deliver a push message to a standard browser PushSubscription
 * (the { endpoint, keys: { p256dh, auth } } object every browser produces
 * from `PushManager.subscribe()`), using only Node's built-in `crypto`
 * module and `fetch`. No npm dependency required.
 *
 * This intentionally does NOT go through Firebase Cloud Messaging: a raw
 * PushManager subscription is not an FCM registration token, and sending it
 * to FCM's HTTP v1 API gets rejected with a 404 "NotRegistered" error even
 * though the subscription itself is perfectly valid. Delivering it via the
 * actual W3C Push API / Web Push protocol (what this file does) is what the
 * browser and the service worker (public/sw.js) are already built to speak.
 */

import { createHash, createECDH, createCipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign as cryptoSign } from 'crypto'

export interface WebPushSubscription {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export interface WebPushResult {
  success: boolean
  statusCode?: number
  error?: string
  /** true when the push service says this subscription is gone for good (404/410) */
  gone?: boolean
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

export function generateVAPIDKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { d: string }

  const x = b64urlDecode(pubJwk.x)
  const y = b64urlDecode(pubJwk.y)
  const rawPublic = Buffer.concat([Buffer.from([0x04]), x, y])
  const rawPrivate = b64urlDecode(privJwk.d)

  return {
    publicKey: b64urlEncode(rawPublic),
    privateKey: b64urlEncode(rawPrivate),
  }
}

function ecPrivateKeyFromRaw(rawPrivateB64url: string, rawPublicB64url: string) {
  const d = b64urlDecode(rawPrivateB64url)
  const pub = b64urlDecode(rawPublicB64url)
  const x = pub.subarray(1, 33)
  const y = pub.subarray(33, 65)
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64urlEncode(d), x: b64urlEncode(x), y: b64urlEncode(y) },
    format: 'jwk',
  })
}

function getVapidAuthHeader(
  endpointOrigin: string,
  subject: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  expirationSeconds = 12 * 60 * 60
): string {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { aud: endpointOrigin, exp: now + expirationSeconds, sub: subject }

  const headerB64 = b64urlEncode(Buffer.from(JSON.stringify(header)))
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`

  const key = ecPrivateKeyFromRaw(vapidPrivateKey, vapidPublicKey)
  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  })

  const jwt = `${signingInput}.${b64urlEncode(signature)}`
  return `vapid t=${jwt}, k=${vapidPublicKey}`
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length))
}

/** RFC 8291 aes128gcm message encryption */
function encryptPayload(userPublicKeyB64url: string, userAuthB64url: string, plaintext: Buffer): Buffer {
  const uaPublic = b64urlDecode(userPublicKeyB64url)
  const authSecret = b64urlDecode(userAuthB64url)

  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const ecdhSecret = ecdh.computeSecret(uaPublic)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic])
  const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32)

  const salt = randomBytes(16)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12)

  const paddedPlaintext = Buffer.concat([plaintext, Buffer.from([0x02])])

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const ciphertext = Buffer.concat([cipher.update(paddedPlaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  const body = Buffer.concat([ciphertext, authTag])

  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096, 0)
  const idlen = Buffer.from([asPublic.length])
  const header = Buffer.concat([salt, rs, idlen, asPublic])

  return Buffer.concat([header, body])
}

export function isVapidConfigured(): boolean {
  return !!(process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
}

/**
 * Send a push message to a single browser subscription using the standard
 * Web Push protocol (VAPID + aes128gcm encryption).
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: Record<string, unknown>,
  options: { urgent?: boolean } = {}
): Promise<WebPushResult> {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@2gethr1.vercel.app'

  if (!vapidPublicKey || !vapidPrivateKey) {
    return { success: false, error: 'VAPID keys not configured' }
  }

  try {
    const endpointUrl = new URL(subscription.endpoint)
    const endpointOrigin = `${endpointUrl.protocol}//${endpointUrl.host}`

    const body = encryptPayload(
      subscription.keys.p256dh,
      subscription.keys.auth,
      Buffer.from(JSON.stringify(payload), 'utf8')
    )

    const authHeader = getVapidAuthHeader(endpointOrigin, subject, vapidPublicKey, vapidPrivateKey)

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
        // Urgency: high lets the push service wake a sleeping (Doze) phone
        // instead of batching the message for later. Emergencies only.
        ...(options.urgent ? { 'Urgency': 'high' } : {}),
        'Authorization': authHeader,
      },
      // Buffer is a Uint8Array under the hood, but Node's fetch/BodyInit
      // types don't accept it directly - hand it a plain Uint8Array view
      // over the same bytes instead.
      body: new Uint8Array(body),
    })

    if (response.ok) {
      return { success: true, statusCode: response.status }
    }

    const text = await response.text().catch(() => '')
    const gone = response.status === 404 || response.status === 410
    return {
      success: false,
      statusCode: response.status,
      error: text || `Push service responded with ${response.status}`,
      gone,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Re-exported for a one-off key-generation script; not used at runtime.
export const __internal = { b64urlEncode, b64urlDecode, createHash, createPublicKey }
