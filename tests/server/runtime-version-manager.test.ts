import { chmodSync, createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as tar from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ appHome: '' }))

vi.mock('../../packages/server/src/config', () => ({
  config: {
    get appHome() {
      return state.appHome
    },
  },
}))

vi.mock('../../packages/server/src/services/system-info', () => ({
  getHermesAgentVersion: () => 'v2026.8.1',
  getHermesWebUiVersion: () => '0.6.31',
}))

const originalEnv = { ...process.env }
const tempDirs: string[] = []

function tempDir(prefix = 'hermes-runtime-version-manager-'): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function createRuntimeRoot(root: string): void {
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
    delete process.env.HERMES_DESKTOP_RUNTIME_DIR
    state.appHome = tempDir('hermes-runtime-version-home-')
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
    vi.resetModules()
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('records a writable destination without changing the running Runtime', async () => {
    const currentRuntime = join(state.appHome, 'desktop-runtime', 'hermes', '0.18.0', 'test-platform')
    const activeVersionPath = join(state.appHome, 'desktop-runtime', 'active-version.json')
    const destination = tempDir('hermes-runtime-version-destination-')
    mkdirSync(join(state.appHome, 'desktop-runtime'), { recursive: true })
    writeFileSync(activeVersionPath, JSON.stringify({
      schema: 1,
      hermesRuntimeVersion: '0.18.0',
      runtimeDirectory: currentRuntime,
      platform: 'test-platform',
    }))

    const { scheduleRuntimeRootMigration } = await import('../../packages/server/src/services/runtime-version-manager')
    const active = scheduleRuntimeRootMigration(destination)
    const persisted = JSON.parse(readFileSync(activeVersionPath, 'utf-8'))

    expect(active.runtimeDirectory).toBe(currentRuntime)
    expect(active.pendingRuntimeRootDirectory).toBe(resolve(destination))
    expect(persisted.pendingRuntimeRootDirectory).toBe(resolve(destination))
    expect(persisted.runtimeRootDirectory).toBeUndefined()
  })

  it('reports the installed Hermes Agent version separately from the Runtime package version', async () => {
    const activeVersionPath = join(state.appHome, 'desktop-runtime', 'active-version.json')
    mkdirSync(join(state.appHome, 'desktop-runtime'), { recursive: true })
    writeFileSync(activeVersionPath, JSON.stringify({
      schema: 1,
      hermesRuntimeVersion: '0.19.1',
      runtimeDirectory: join(state.appHome, 'desktop-runtime', 'hermes', '0.19.1', 'test-platform'),
      platform: 'test-platform',
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schema: 1, hermes: ['0.19.1'], webui: ['0.6.31'] }),
    }))

    const { getRuntimeVersionStatus } = await import('../../packages/server/src/services/runtime-version-manager')
    const status = await getRuntimeVersionStatus()

    expect(status.hermes.activeVersion).toBe('0.19.1')
    expect(status.hermes.agentVersion).toBe('v2026.8.1')
  })

  it('reports the current packaged runtime when no downloaded runtime is active', async () => {
    const runtimeRoot = tempDir()
    createRuntimeRoot(runtimeRoot)
    process.env.HERMES_AGENT_RUNTIME_VERSION = '0.17.0'
    process.env.HERMES_AGENT_RUNTIME_DIR = runtimeRoot
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hermes: ['0.18.0', '0.17.0'], webui: ['0.6.31'] }),
    }))

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

  it('uses separate GitHub repositories for Web UI and Runtime downloads', async () => {
    process.env.HERMES_WEB_UI_DOWNLOAD_GITHUB_REPO = 'MScorpioLee/hermes-studio'
    process.env.HERMES_RUNTIME_DOWNLOAD_GITHUB_REPO = 'EKKOLearnAI/hermes-studio'

    const { buildVersionDownloadAssetUrl } = await import('../../packages/server/src/services/runtime-version-manager')

    expect(buildVersionDownloadAssetUrl(
      'hermes-web-ui-0.6.38.json',
      'v0.6.38',
      'github',
    )).toBe('https://github.com/MScorpioLee/hermes-studio/releases/download/v0.6.38/hermes-web-ui-0.6.38.json')
    expect(buildVersionDownloadAssetUrl(
      'hermes-runtime-linux-x64.json',
      'hermes-0.20.0-runtime',
      'github',
    )).toBe('https://github.com/EKKOLearnAI/hermes-studio/releases/download/hermes-0.20.0-runtime/hermes-runtime-linux-x64.json')
  })

  it('downloads schema 2 runtimes whose Python environment is under python/venv', async () => {
    const fixtureRoot = tempDir()
    const archive = join(tempDir(), 'runtime-schema-2.tar.gz')
    const assetName = 'runtime-schema-2.tar.gz'
    const platform = `${process.platform === 'darwin' ? 'mac' : process.platform}-${process.arch}`

    mkdirSync(join(fixtureRoot, 'python', 'venv', 'bin'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'python', '.git'), { recursive: true })
    mkdirSync(join(fixtureRoot, 'node', 'bin'), { recursive: true })
    for (const file of [
      join(fixtureRoot, 'python', 'venv', 'bin', 'python3'),
      join(fixtureRoot, 'python', 'venv', 'bin', 'hermes'),
      join(fixtureRoot, 'node', 'bin', 'node'),
    ]) {
      writeFileSync(file, '#!/bin/sh\n')
      chmodSync(file, 0o755)
    }
    writeFileSync(join(fixtureRoot, 'python', '.git', 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(fixtureRoot, 'python', 'pyproject.toml'), '[project]\nname = "hermes-agent"\n')
    const runtimeManifest = {
      schema: 2,
      platform,
      hermesAgentVersion: '0.20.0',
      hermesSource: {
        repository: 'https://github.com/NousResearch/hermes-agent.git',
        ref: 'v2026.8.3',
        commit: '3c27eb6234bf91b8ceee9e9071591b31e9b148cb',
        installMethod: 'git',
      },
    }
    writeFileSync(join(fixtureRoot, 'runtime-manifest.json'), JSON.stringify(runtimeManifest))
    await tar.c({ cwd: fixtureRoot, file: archive, gzip: true }, ['.'])

    const server = createServer((request, response) => {
      if (request.url === `/hermes-0.20.0-runtime/${assetName}`) {
        response.writeHead(200)
        createReadStream(archive).pipe(response)
        return
      }
      response.writeHead(404).end()
    })
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))

    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP')
      process.env.HERMES_WEB_UI_DOWNLOAD_BASE_URL = `http://127.0.0.1:${address.port}`
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith(`hermes-runtime-${platform}.json`)) {
          return new Response(JSON.stringify({ ...runtimeManifest, asset: { name: assetName } }), { status: 200 })
        }
        return new Response(JSON.stringify({ hermes: ['0.20.0'], webui: [] }), { status: 200 })
      }))

      const { downloadRuntimeVersion } = await import('../../packages/server/src/services/runtime-version-manager')
      const installed = await downloadRuntimeVersion('0.20.0', 'cf')

      expect(installed).toEqual(expect.objectContaining({
        version: '0.20.0',
        platform,
        manifestHermesRuntimeVersion: '0.20.0',
      }))
      expect(installed.directory).toBe(join(
        state.appHome,
        'desktop-runtime',
        'hermes',
        '0.20.0',
        platform,
      ))
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close(err => err ? rejectClose(err) : resolveClose()))
    }
  })

  it('rejects a destination nested inside the current Runtime storage root', async () => {
    const nestedDestination = join(state.appHome, 'desktop-runtime', 'nested')
    mkdirSync(nestedDestination, { recursive: true })

    const { scheduleRuntimeRootMigration } = await import('../../packages/server/src/services/runtime-version-manager')

    expect(() => scheduleRuntimeRootMigration(nestedDestination))
      .toThrow('cannot be inside the current Runtime storage directory')
  })

  it('uses the Runtime storage root for downloaded Web UI versions without scanning the legacy directory', async () => {
    const storageRoot = tempDir('hermes-runtime-version-storage-')
    const activeVersionPath = join(state.appHome, 'desktop-runtime', 'active-version.json')
    const webUiDirectory = join(storageRoot, 'webui', '0.6.31')
    const legacyWebUiDirectory = join(state.appHome, 'webui', '0.6.30')
    mkdirSync(webUiDirectory, { recursive: true })
    mkdirSync(legacyWebUiDirectory, { recursive: true })
    mkdirSync(join(state.appHome, 'desktop-runtime'), { recursive: true })
    writeFileSync(join(webUiDirectory, 'package.json'), JSON.stringify({ version: '0.6.31' }))
    writeFileSync(join(legacyWebUiDirectory, 'package.json'), JSON.stringify({ version: '0.6.30' }))
    writeFileSync(activeVersionPath, JSON.stringify({
      schema: 1,
      desktopAppVersion: '0.6.30',
      runtimeRootDirectory: storageRoot,
      platform: 'test-platform',
    }))

    const {
      activateDownloadedWebUiVersion,
      listInstalledWebUiVersions,
    } = await import('../../packages/server/src/services/runtime-version-manager')

    expect(listInstalledWebUiVersions()).toEqual([{
      version: '0.6.31',
      directory: webUiDirectory,
      active: false,
    }])
    const activated = activateDownloadedWebUiVersion('0.6.31')
    expect(activated.desktopAppVersion).toBe('0.6.30')
    expect(activated.webUiVersion).toBe('0.6.31')
    expect(activated.webUiDirectory).toBeUndefined()
    expect(() => activateDownloadedWebUiVersion('0.6.30'))
      .toThrow('Downloaded Web UI version not found')
  })
})
