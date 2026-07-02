import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }
const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-runtime-version-manager-'))
  tempDirs.push(dir)
  return dir
}

function createRuntimeRoot(root: string) {
  mkdirSync(join(root, 'python', 'bin'), { recursive: true })
  mkdirSync(join(root, 'node', 'bin'), { recursive: true })
  writeFileSync(join(root, 'python', 'bin', 'python3'), '')
  writeFileSync(join(root, 'python', 'bin', 'hermes'), '')
  writeFileSync(join(root, 'node', 'bin', 'node'), '')
}

describe('runtime version manager', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    process.env.HERMES_WEB_UI_HOME = tempDir()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ hermes: ['0.18.0', '0.17.0'], webui: ['0.6.23'] }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    vi.resetModules()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports the current packaged runtime when no downloaded runtime is active', async () => {
    const runtimeRoot = tempDir()
    createRuntimeRoot(runtimeRoot)
    process.env.HERMES_AGENT_RUNTIME_VERSION = '0.17.0'
    process.env.HERMES_AGENT_RUNTIME_DIR = runtimeRoot

    const { getRuntimeVersionStatus } = await import('../../packages/server/src/services/runtime-version-manager')
    const status = await getRuntimeVersionStatus()

    expect(status.hermes.activeVersion).toBe('0.17.0')
    expect(status.hermes.activeDirectory).toBe(runtimeRoot)
    expect(status.hermes.installed).toEqual([
      expect.objectContaining({
        version: '0.17.0',
        directory: runtimeRoot,
        active: true,
        manifestHermesRuntimeVersion: '0.17.0',
      }),
    ])
  })
})
