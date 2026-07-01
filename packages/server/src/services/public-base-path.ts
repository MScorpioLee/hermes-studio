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
