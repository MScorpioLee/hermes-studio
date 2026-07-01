export function normalizePublicBasePath(value = process.env.HERMES_WEB_UI_PUBLIC_BASE_PATH || ''): string {
  let basePath = value.trim()
  if (!basePath || basePath === '/') return ''

  if (/^https?:\/\//i.test(basePath)) {
    try {
      basePath = new URL(basePath).pathname
    } catch {
      basePath = ''
    }
  }

  if (!basePath) return ''
  if (!basePath.startsWith('/')) basePath = `/${basePath}`
  basePath = basePath.replace(/\/+$/, '')
  return basePath === '/' ? '' : basePath
}

export function getPublicBasePath(): string {
  return normalizePublicBasePath()
}

export function getSocketIoPath(): string {
  const basePath = getPublicBasePath()
  return `${basePath}/socket.io`
}

export function stripPublicBasePathFromUrl(rawUrl: string, basePath = getPublicBasePath()): string {
  if (!basePath || !rawUrl) return rawUrl

  try {
    const url = new URL(rawUrl, 'http://hermes.local')
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return rawUrl
    }

    const nextPath = url.pathname.slice(basePath.length) || '/'
    return `${nextPath}${url.search}`
  } catch {
    if (rawUrl === basePath) return '/'
    if (rawUrl.startsWith(`${basePath}/`)) {
      return rawUrl.slice(basePath.length) || '/'
    }
    return rawUrl
  }
}

export function aliasRootSocketIoUrl(rawUrl: string, basePath = getPublicBasePath()): string {
  const normalizedBasePath = normalizePublicBasePath(basePath)
  if (!normalizedBasePath || !rawUrl) return rawUrl

  const rootSocketIoPath = '/socket.io'
  try {
    const url = new URL(rawUrl, 'http://hermes.local')
    if (url.pathname !== rootSocketIoPath && !url.pathname.startsWith(`${rootSocketIoPath}/`)) {
      return rawUrl
    }

    const nextPath = `${normalizedBasePath}${url.pathname}`
    if (/^https?:\/\//i.test(rawUrl)) {
      url.pathname = nextPath
      return url.toString()
    }
    return `${nextPath}${url.search}`
  } catch {
    if (rawUrl === rootSocketIoPath) return `${normalizedBasePath}${rootSocketIoPath}`
    if (rawUrl.startsWith(`${rootSocketIoPath}/`)) return `${normalizedBasePath}${rawUrl}`
    return rawUrl
  }
}

type RootSocketIoAliasRequest = {
  url?: string
}

type RootSocketIoAliasServer = {
  prependListener: (event: 'request' | 'upgrade', listener: (req: RootSocketIoAliasRequest) => void) => unknown
}

export function installRootSocketIoAlias(httpServers: RootSocketIoAliasServer[], basePath = getPublicBasePath()): void {
  const normalizedBasePath = normalizePublicBasePath(basePath)
  if (!normalizedBasePath) return

  const rewriteUrl = (req: RootSocketIoAliasRequest) => {
    const originalUrl = String(req.url || '')
    const nextUrl = aliasRootSocketIoUrl(originalUrl, normalizedBasePath)
    if (nextUrl !== originalUrl) {
      req.url = nextUrl
    }
  }

  httpServers.forEach((httpServer) => {
    httpServer.prependListener('request', rewriteUrl)
    httpServer.prependListener('upgrade', rewriteUrl)
  })
}
