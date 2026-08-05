import { createReadStream, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
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

  it('uses separate GitHub repositories for Web UI and runtime downloads', async () => {
    process.env.HERMES_WEB_UI_DOWNLOAD_GITHUB_REPO = 'MScorpioLee/hermes-studio'
    process.env.HERMES_RUNTIME_DOWNLOAD_GITHUB_REPO = 'EKKOLearnAI/hermes-studio'

    const { buildVersionDownloadAssetUrl } = await import('../../packages/server/src/services/runtime-version-manager')

    expect(buildVersionDownloadAssetUrl(
      'hermes-web-ui-0.6.25.json',
      'v0.6.25',
      'github',
    )).toBe('https://github.com/MScorpioLee/hermes-studio/releases/download/v0.6.25/hermes-web-ui-0.6.25.json')

    expect(buildVersionDownloadAssetUrl(
      'hermes-runtime-linux-x64.json',
      'hermes-0.18.0-runtime',
      'github',
    )).toBe('https://github.com/EKKOLearnAI/hermes-studio/releases/download/hermes-0.18.0-runtime/hermes-runtime-linux-x64.json')
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
    writeFileSync(join(fixtureRoot, 'runtime-manifest.json'), JSON.stringify({
      schema: 2,
      platform,
      hermesAgentVersion: '0.20.0',
      hermesSource: {
        repository: 'https://github.com/NousResearch/hermes-agent.git',
        ref: 'v2026.8.3',
        commit: '3c27eb6234bf91b8ceee9e9071591b31e9b148cb',
        installMethod: 'git',
      },
    }))
    await tar.c({ cwd: fixtureRoot, file: archive, gzip: true }, ['.'])

    const server = createServer((request, response) => {
      if (request.url === `/hermes-0.20.0-runtime/${assetName}`) {
        response.writeHead(200)
        createReadStream(archive).pipe(response)
        return
      }
      response.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP')
      process.env.HERMES_WEB_UI_DOWNLOAD_BASE_URL = `http://127.0.0.1:${address.port}`
      vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith(`hermes-runtime-${platform}.json`)) {
          return new Response(JSON.stringify({
            schema: 2,
            platform,
            hermesAgentVersion: '0.20.0',
            asset: { name: assetName },
          }), { status: 200 })
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
        process.env.HERMES_WEB_UI_HOME!,
        'desktop-runtime',
        'hermes',
        '0.20.0',
        platform,
      ))
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }
  })
})
