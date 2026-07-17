#!/usr/bin/env node
import fs from 'node:fs'

const manifestPath = process.env.MANIFEST_PATH || 'fnos/hermes-studio/webui-versions.json'
const webUiVersion = process.env.WEBUI_VERSION
const runtimeVersions = parseJsonArray(process.env.RUNTIME_VERSIONS_JSON || '[]')

if (!webUiVersion) {
  throw new Error('WEBUI_VERSION is required')
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

manifest.schema = manifest.schema || 1
manifest.webui = sortVersions(unique([webUiVersion, ...(manifest.webui || [])]))
manifest.hermes = sortVersions(unique([...runtimeVersions, ...(manifest.hermes || [])]))

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

function parseJsonArray(value) {
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed)) {
    throw new Error('RUNTIME_VERSIONS_JSON must be a JSON array')
  }
  return parsed.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))]
}

function sortVersions(values) {
  return [...values].sort((left, right) => compareSemver(right, left))
}

function compareSemver(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return left.localeCompare(right)
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) {
    return [0, 0, 0]
  }
  return match.slice(1).map((part) => Number(part))
}
