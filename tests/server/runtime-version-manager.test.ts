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
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
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

function runtimePlatformKey(): string {
  const osLabel = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : process.platform
  return `${osLabel}-${process.arch}`
}

function createRuntime(root: string, version: string, options: { missingNode?: boolean } = {}): void {
  if (process.platform === 'win32') {
    mkdirSync(join(root, 'python', 'venv', 'Scripts'), { recursive: true })
    mkdirSync(join(root, 'git', 'cmd'), { recursive: true })
    writeFileSync(join(root, 'python', 'venv', 'Scripts', 'python.exe'), '')
    writeFileSync(join(root, 'python', 'venv', 'Scripts', 'hermes.cmd'), '')
    writeFileSync(join(root, 'git', 'cmd', 'git.exe'), '')
    if (!options.missingNode) {
      mkdirSync(join(root, 'node'), { recursive: true })
      writeFileSync(join(root, 'node', 'node.exe'), '')
    }
  } else {
    mkdirSync(join(root, 'python', 'venv', 'bin'), { recursive: true })
    const pythonBin = join(root, 'python', 'venv', 'bin', 'python3')
    const hermesBin = join(root, 'python', 'venv', 'bin', 'hermes')
    writeFileSync(pythonBin, '')
    writeFileSync(hermesBin, '')
    chmodSync(pythonBin, 0o755)
    chmodSync(hermesBin, 0o755)
    if (!options.missingNode) {
      mkdirSync(join(root, 'node', 'bin'), { recursive: true })
      const nodeBin = join(root, 'node', 'bin', 'node')
      writeFileSync(nodeBin, '')
      chmodSync(nodeBin, 0o755)
    }
  }
  writeFileSync(join(root, 'runtime-manifest.json'), JSON.stringify({
    schema: 1,
    platform: runtimePlatformKey(),
    hermesAgentVersion: version,
  }))
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
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
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

  it('uses the packaged version manifest when every remote source fails', async () => {
    const fallbackFile = join(tempDir(), 'versions.json')
    writeFileSync(fallbackFile, JSON.stringify({
      schema: 1,
      hermes: ['0.20.6'],
      webui: ['0.6.44'],
    }))
    process.env.HERMES_WEB_UI_VERSION_MANIFEST_URL = 'https://primary.test/versions.json'
    process.env.HERMES_WEB_UI_VERSION_MANIFEST_FALLBACK_FILE = fallbackFile
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')))

    const { getRuntimeVersionStatus } = await import('../../packages/server/src/services/runtime-version-manager')
    const status = await getRuntimeVersionStatus()

    expect(status.hermes.remoteVersions).toEqual(['0.20.6'])
    expect(status.webui.remoteVersions).toEqual(['0.6.44'])
    expect(status.remoteError).toBe('')
  })

  it('tries configured remote manifest fallbacks before using the packaged file', async () => {
    process.env.HERMES_WEB_UI_VERSION_MANIFEST_URL = 'https://primary.test/versions.json'
    process.env.HERMES_WEB_UI_VERSION_MANIFEST_FALLBACK_URLS = [
      'https://fallback-one.test/versions.json',
      'https://fallback-two.test/versions.json',
    ].join(',')
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        hermes: ['0.20.7'],
        webui: ['0.6.45'],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getRuntimeVersionStatus } = await import('../../packages/server/src/services/runtime-version-manager')
    const status = await getRuntimeVersionStatus()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'https://primary.test/versions.json',
      'https://fallback-one.test/versions.json',
      'https://fallback-two.test/versions.json',
    ])
    expect(status.hermes.remoteVersions).toEqual(['0.20.7'])
    expect(status.webui.remoteVersions).toEqual(['0.6.45'])
    expect(status.remoteError).toBe('')
  })

  it('starts fallback manifest requests without waiting for the primary timeout', async () => {
    process.env.HERMES_WEB_UI_VERSION_MANIFEST_URL = 'https://primary.test/versions.json'
    process.env.HERMES_WEB_UI_VERSION_MANIFEST_FALLBACK_URLS = 'https://fallback.test/versions.json'
    let rejectPrimary = (_reason?: unknown) => {}
    const primaryRequest = new Promise<Response>((_resolve, reject) => {
      rejectPrimary = reject
    })
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (String(input).includes('primary.test')) return primaryRequest
      return Promise.resolve(new Response(JSON.stringify({
        hermes: ['0.20.7'],
        webui: ['0.6.45'],
      }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { getRuntimeVersionStatus } = await import('../../packages/server/src/services/runtime-version-manager')
    const statusPromise = getRuntimeVersionStatus()
    let concurrencyError: unknown
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 200 })
    } catch (err) {
      concurrencyError = err
    }
    rejectPrimary(new Error('primary unavailable'))
    const status = await statusPromise

    if (concurrencyError) throw concurrencyError
    expect(status.hermes.remoteVersions).toEqual(['0.20.7'])
    expect(status.webui.remoteVersions).toEqual(['0.6.45'])
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
  it('does not list or activate an incomplete Runtime directory', async () => {
    const platform = runtimePlatformKey()
    const runtimeRoot = join(state.appHome, 'desktop-runtime', 'hermes')
    const validRuntime = join(runtimeRoot, '0.19.0', platform)
    const incompleteRuntime = join(runtimeRoot, '0.20.0', platform)
    const activeVersionPath = join(state.appHome, 'desktop-runtime', 'active-version.json')
    createRuntime(validRuntime, '0.19.0')
    createRuntime(incompleteRuntime, '0.20.0', { missingNode: true })
    writeFileSync(activeVersionPath, JSON.stringify({
      schema: 1,
      hermesRuntimeVersion: '0.19.0',
      runtimeDirectory: validRuntime,
      platform,
    }))

    const {
      activateInstalledRuntimeVersion,
      listInstalledRuntimeVersions,
    } = await import('../../packages/server/src/services/runtime-version-manager')

    expect(listInstalledRuntimeVersions().map(runtime => runtime.version)).toEqual(['0.19.0'])
    expect(() => activateInstalledRuntimeVersion('0.20.0'))
      .toThrow(/Runtime 0\.20\.0 cannot be activated:.*node/)
    expect(JSON.parse(readFileSync(activeVersionPath, 'utf-8')).runtimeDirectory).toBe(validRuntime)
  })

  it('clears the previous activation error after selecting a valid Runtime', async () => {
    const platform = runtimePlatformKey()
    const runtime = join(state.appHome, 'desktop-runtime', 'hermes', '0.20.0', platform)
    const activeVersionPath = join(state.appHome, 'desktop-runtime', 'active-version.json')
    createRuntime(runtime, '0.20.0')
    writeFileSync(activeVersionPath, JSON.stringify({
      schema: 1,
      hermesRuntimeVersion: '0.19.0',
      runtimeActivationError: 'previous Runtime failed',
      platform,
    }))

    const { activateInstalledRuntimeVersion } = await import('../../packages/server/src/services/runtime-version-manager')
    const active = activateInstalledRuntimeVersion('0.20.0')

    expect(active.runtimeDirectory).toBe(runtime)
    expect(active.runtimeActivationError).toBe('')
  })

  it('accepts hermes.exe after a Windows CLI update replaces hermes.cmd', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const platform = runtimePlatformKey()
    const runtime = join(state.appHome, 'desktop-runtime', 'hermes', '0.20.0', platform)
    createRuntime(runtime, '0.20.0')
    const scripts = join(runtime, 'python', 'venv', 'Scripts')
    rmSync(join(scripts, 'hermes.cmd'))
    writeFileSync(join(scripts, 'hermes.exe'), '')

    const {
      activateInstalledRuntimeVersion,
      listInstalledRuntimeVersions,
    } = await import('../../packages/server/src/services/runtime-version-manager')

    expect(listInstalledRuntimeVersions().map(item => item.version)).toContain('0.20.0')
    expect(activateInstalledRuntimeVersion('0.20.0').runtimeDirectory).toBe(runtime)
  })

})
