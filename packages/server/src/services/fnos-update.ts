import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

declare const __APP_VERSION__: string

const DEFAULT_METADATA_URL = 'https://github.com/MScorpioLee/hermes-studio/releases/latest/download/hermes-studio.latest.json'
const DEFAULT_TIMEOUT_MS = 10000
const CACHE_TTL_MS = 5 * 60 * 1000

type FnosReleaseMetadata = {
  version?: unknown
  fpk_version?: unknown
  release_tag?: unknown
  download_url?: unknown
  release_url?: unknown
  packaging_repo?: unknown
  update_source?: unknown
  service_port?: unknown
  gateway_prefix?: unknown
  updated_at?: unknown
  built_from?: unknown
  bundled_runtime?: unknown
}

type FetchResponseLike = {
  ok: boolean
  status?: number
  statusText?: string
  json: () => Promise<unknown>
}

type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>

export type FnosUpdateStatus = {
  status: 'ok' | 'unavailable'
  source: 'fnos-native'
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  metadataUrl: string
  checkedAt: string
  downloadUrl: string
  releaseUrl: string
  releaseTag: string
  servicePort: number | null
  gatewayPrefix: string
  updatedAt: string
  builtFrom: string
  bundledRuntime: unknown | null
  error?: string
}

export type CheckFnosUpdateOptions = {
  currentVersion?: string
  metadataUrl?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
  now?: () => Date
  useCache?: boolean
}

let cachedStatus: { metadataUrl: string; currentVersion: string; expiresAt: number; value: FnosUpdateStatus } | null = null

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readPackageVersion(): string {
  const candidatePaths = [
    resolve(__dirname, '../../../../package.json'),
    resolve(__dirname, '../../package.json'),
    resolve(process.cwd(), 'package.json'),
  ]

  for (const packagePath of candidatePaths) {
    if (!existsSync(packagePath)) continue
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: unknown }
      const version = stringValue(pkg.version)
      if (version) return version
    } catch {
      // Try the next candidate path.
    }
  }

  return ''
}

function getLocalVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : readPackageVersion()
}

function getMetadataUrl(): string {
  return (process.env.HERMES_FNOS_UPDATE_METADATA_URL || '').trim() || DEFAULT_METADATA_URL
}

export function comparePackageVersions(left: string, right: string): number {
  const normalize = (value: string) => value.trim().replace(/^v/i, '').split(/[.-]/)
  const leftParts = normalize(left)
  const rightParts = normalize(right)

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] || '0'
    const rightPart = rightParts[index] || '0'
    const leftNumber = Number.parseInt(leftPart, 10)
    const rightNumber = Number.parseInt(rightPart, 10)
    const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    const diff = bothNumeric
      ? leftNumber - rightNumber
      : leftPart.localeCompare(rightPart, undefined, { numeric: true })
    if (diff !== 0) return diff
  }

  return 0
}

function normalizeRepoUrl(value: string): string {
  return value.replace(/\.git$/i, '').replace(/\/+$/, '')
}

function inferReleaseUrl(metadata: FnosReleaseMetadata, downloadUrl: string): string {
  const explicit = stringValue(metadata.release_url)
  if (explicit) return explicit

  const releaseTag = stringValue(metadata.release_tag)
  const repo = normalizeRepoUrl(stringValue(metadata.packaging_repo))
  if (releaseTag && repo) return `${repo}/releases/tag/${encodeURIComponent(releaseTag)}`

  const match = downloadUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/download\/([^/]+)/i)
  if (match) return `${match[1]}/releases/tag/${encodeURIComponent(decodeURIComponent(match[2]))}`

  return ''
}

function buildUnavailableStatus(params: {
  currentVersion: string
  metadataUrl: string
  checkedAt: string
  error: string
}): FnosUpdateStatus {
  return {
    status: 'unavailable',
    source: 'fnos-native',
    currentVersion: params.currentVersion,
    latestVersion: '',
    updateAvailable: false,
    metadataUrl: params.metadataUrl,
    checkedAt: params.checkedAt,
    downloadUrl: '',
    releaseUrl: '',
    releaseTag: '',
    servicePort: null,
    gatewayPrefix: '',
    updatedAt: '',
    builtFrom: '',
    bundledRuntime: null,
    error: params.error,
  }
}

export async function checkFnosUpdateStatus(options: CheckFnosUpdateOptions = {}): Promise<FnosUpdateStatus> {
  const now = options.now?.() || new Date()
  const checkedAt = now.toISOString()
  const nowMs = now.getTime()
  const currentVersion = options.currentVersion ?? getLocalVersion()
  const metadataUrl = options.metadataUrl ?? getMetadataUrl()
  const useCache = options.useCache ?? !options.fetchImpl

  if (
    useCache &&
    cachedStatus &&
    cachedStatus.metadataUrl === metadataUrl &&
    cachedStatus.currentVersion === currentVersion &&
    cachedStatus.expiresAt > nowMs
  ) {
    return cachedStatus.value
  }

  try {
    const fetchImpl = options.fetchImpl || fetch
    const response = await fetchImpl(metadataUrl, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`metadata request failed: ${response.status || 0} ${response.statusText || ''}`.trim())
    }

    const metadata = await response.json() as FnosReleaseMetadata
    const latestVersion = stringValue(metadata.version) || stringValue(metadata.fpk_version)
    if (!latestVersion) {
      throw new Error('metadata is missing version')
    }

    const downloadUrl = stringValue(metadata.download_url)
    const releaseUrl = inferReleaseUrl(metadata, downloadUrl)
    const status: FnosUpdateStatus = {
      status: 'ok',
      source: 'fnos-native',
      currentVersion,
      latestVersion,
      updateAvailable: Boolean(currentVersion && comparePackageVersions(latestVersion, currentVersion) > 0),
      metadataUrl,
      checkedAt,
      downloadUrl,
      releaseUrl,
      releaseTag: stringValue(metadata.release_tag),
      servicePort: numberValue(metadata.service_port),
      gatewayPrefix: stringValue(metadata.gateway_prefix),
      updatedAt: stringValue(metadata.updated_at),
      builtFrom: stringValue(metadata.built_from),
      bundledRuntime: metadata.bundled_runtime ?? null,
    }

    if (useCache) {
      cachedStatus = {
        metadataUrl,
        currentVersion,
        expiresAt: nowMs + CACHE_TTL_MS,
        value: status,
      }
    }

    return status
  } catch (err) {
    const status = buildUnavailableStatus({
      currentVersion,
      metadataUrl,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    })
    if (useCache) {
      cachedStatus = {
        metadataUrl,
        currentVersion,
        expiresAt: nowMs + CACHE_TTL_MS,
        value: status,
      }
    }
    return status
  }
}
