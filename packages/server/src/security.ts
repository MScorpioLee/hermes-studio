import type { Context, Middleware } from 'koa'
import type { IncomingMessage } from 'http'

interface CorsPolicy {
  allowAll: boolean
  allowedOrigins: Set<string>
}

function normalizeOrigin(origin: string | undefined | null): string | null {
  const value = String(origin || '').trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function normalizeHost(host: string | undefined | null): string {
  return String(host || '').trim().toLowerCase()
}

function hostnameFromHostHeader(host: string | undefined | null): string {
  const requestHost = normalizeHost(host)
  if (!requestHost) return ''
  try {
    return new URL(`http://${requestHost}`).hostname.toLowerCase()
  } catch {
    return requestHost.replace(/^\[/, '').replace(/\]$/, '').split(':')[0]?.toLowerCase() || ''
  }
}

function envFlagAllows(value: string | undefined | null): boolean | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return null
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

function parseIpv4Address(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map(part => Number(part))
  if (octets.some((octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index])) {
    return null
  }
  return octets
}

function isLanOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!normalized) return false
  if (normalized === 'localhost' || normalized.endsWith('.local')) return true

  const ipv4 = parseIpv4Address(normalized)
  if (ipv4) {
    const [a, b] = ipv4
    return a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
  }

  return normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
}

function parseCorsPolicy(corsOrigins: string | undefined): CorsPolicy {
  const value = String(corsOrigins || '').trim()
  if (!value) return { allowAll: false, allowedOrigins: new Set() }

  const tokens = value.split(/[\s,]+/).map(token => token.trim()).filter(Boolean)
  if (tokens.includes('*')) return { allowAll: true, allowedOrigins: new Set() }

  const allowedOrigins = new Set<string>()
  for (const token of tokens) {
    const normalized = normalizeOrigin(token)
    if (normalized) allowedOrigins.add(normalized)
  }
  return { allowAll: false, allowedOrigins }
}

function isSameHostOrigin(origin: string, host: string): boolean {
  const requestHost = normalizeHost(host)
  if (!requestHost) return false
  try {
    const parsed = new URL(origin)
    return parsed.host.toLowerCase() === requestHost
  } catch {
    return false
  }
}

function isSameHostnameOrigin(origin: string, host: string): boolean {
  if (!isFnosGatewayOriginCompatEnabled()) return false
  const requestHostname = hostnameFromHostHeader(host)
  if (!requestHostname) return false
  try {
    const parsed = new URL(origin)
    return parsed.hostname.toLowerCase() === requestHostname
  } catch {
    return false
  }
}

function isLocalAppDevelopmentOrigin(origin: string | undefined | null): boolean {
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  // App-Plus' native uni.connectSocket client sends this fixed Origin for
  // LAN WebSocket upgrades. Keep it scoped to Socket.IO/upgrade checks; the
  // regular HTTP CORS resolver intentionally does not call this helper.
  if (normalized === 'http://localhost') return true
  try {
    const url = new URL(normalized)
    const hostname = url.hostname.toLowerCase()
    return url.port === '5173' && (
      hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '[::1]'
      || hostname === '::1'
    )
  } catch {
    return false
  }
}

function isLanOriginCompatible(origin: string, host: string): boolean {
  if (!isFnosGatewayOriginCompatEnabled() || !isFnosLanOriginCompatEnabled()) return false
  try {
    const parsed = new URL(origin)
    if (!isLanOrLocalHostname(parsed.hostname)) return false
  } catch {
    return false
  }

  const requestHostname = hostnameFromHostHeader(host)
  return requestHostname ? isLanOrLocalHostname(requestHostname) : true
}

export function isOriginAllowed(origin: string | undefined | null, host: string | undefined | null, corsOrigins = ''): boolean {
  const originValue = String(origin || '').trim()
  if (!originValue) return true

  const policy = parseCorsPolicy(corsOrigins)
  const normalizedOrigin = normalizeOrigin(originValue)
  if (!normalizedOrigin) return policy.allowAll

  if (policy.allowAll) return true
  if (policy.allowedOrigins.has(normalizedOrigin)) return true
  const requestHost = String(host || '')
  return isSameHostOrigin(normalizedOrigin, requestHost) ||
    isSameHostnameOrigin(normalizedOrigin, requestHost) ||
    isLanOriginCompatible(normalizedOrigin, requestHost)
}

export function createCorsOriginResolver(corsOrigins = '') {
  return async (ctx: Context): Promise<string> => {
    const origin = ctx.get('Origin')
    if (!origin) return ''
    if (!isOriginAllowed(origin, ctx.host, corsOrigins)) return ''
    return normalizeOrigin(origin) || ''
  }
}

export function createSocketIoCorsOrigin(corsOrigins = '') {
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void => {
    if (!origin) {
      callback(null, true)
      return
    }
    callback(null, isOriginAllowed(origin, '', corsOrigins) || isLocalAppDevelopmentOrigin(origin))
  }
}

export function shouldRejectUpgradeOrigin(req: IncomingMessage, corsOrigins = ''): boolean {
  const origin = req.headers.origin
  if (!origin) return false
  const selectedOrigin = Array.isArray(origin) ? origin[0] : origin
  return !isOriginAllowed(selectedOrigin, req.headers.host, corsOrigins)
    && !isLocalAppDevelopmentOrigin(selectedOrigin)
}

export function writeForbiddenOrigin(socket: { write: (chunk: string) => void; destroy: () => void }): void {
  socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
  socket.destroy()
}

function isHttpsRequest(ctx: Context): boolean {
  if (ctx.secure) return true
  const forwardedProto = ctx.get('x-forwarded-proto').split(',')[0]?.trim().toLowerCase()
  return forwardedProto === 'https'
}

function isEmbeddedGatewayMode(): boolean {
  const publicBasePath = String(process.env.HERMES_WEB_UI_PUBLIC_BASE_PATH || '').trim()
  return !!publicBasePath && publicBasePath !== '/'
}

function isFnosGatewayOriginCompatEnabled(): boolean {
  const explicit = envFlagAllows(process.env.HERMES_FNOS_GATEWAY_ORIGIN_COMPAT)
  if (explicit != null) return explicit
  return isEmbeddedGatewayMode()
}

function isFnosLanOriginCompatEnabled(): boolean {
  const explicit = envFlagAllows(process.env.HERMES_FNOS_LAN_ORIGIN_COMPAT)
  if (explicit != null) return explicit
  return true
}

function isGroupChatAgentLinkDocument(ctx: Context): boolean {
  return ctx.method === 'GET'
    && ctx.path === '/'
    && ctx.query.groupChatAgentLink === '1'
}

export function securityHeaders(): Middleware {
  return async (ctx, next) => {
    const allowSameOriginFrame = isEmbeddedGatewayMode()
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.set('X-Frame-Options', allowSameOriginFrame ? 'SAMEORIGIN' : 'DENY')
    ctx.set('Referrer-Policy', 'no-referrer')
    ctx.set(
      'Cross-Origin-Opener-Policy',
      isGroupChatAgentLinkDocument(ctx) ? 'unsafe-none' : 'same-origin-allow-popups',
    )
    ctx.set('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      allowSameOriginFrame ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "connect-src 'self' http: https: ws: wss:",
      "form-action 'self'",
    ].join('; '))

    if (isHttpsRequest(ctx)) {
      ctx.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }

    await next()
  }
}
