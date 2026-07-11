import { arch, hostname, platform, release, type } from 'os'
import { generateKeyPairSync, sign } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadSystemInfoWithInjectedVersion(version?: string, hermesCliVersion = 'Hermes Agent v0.15.2\n') {
  vi.resetModules()
  const appHome = mkdtempSync(join(tmpdir(), 'hermes-system-info-test-'))
  if (version === undefined) {
    delete (globalThis as any).__APP_VERSION__
  } else {
    ;(globalThis as any).__APP_VERSION__ = version
  }

  vi.doMock('../../packages/server/src/services/hermes/hermes-cli', () => ({
    getVersion: vi.fn().mockResolvedValue(hermesCliVersion),
  }))

  vi.doMock('../../packages/server/src/config', () => ({
    config: {
      appHome,
      port: 8648,
      host: '0.0.0.0',
      uploadDir: join(appHome, 'upload'),
      dataDir: join(appHome, 'data'),
      corsOrigins: '',
    },
  }))

  const mod = await import('../../packages/server/src/services/system-info')
  return { ...mod, appHome }
}

describe('public system info', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    ;(globalThis as any).__APP_VERSION__ = 'test'
  })

  it('returns host, os, Hermes Agent, and Web UI versions', async () => {
    const { getPublicSystemInfo, appHome } = await loadSystemInfoWithInjectedVersion('9.9.9-test')

    try {
      await expect(getPublicSystemInfo()).resolves.toMatchObject({
        device_id: expect.any(String),
        device_public_key: expect.stringContaining('PUBLIC KEY'),
        computer_name: hostname(),
        os: {
          type: type(),
          platform: platform(),
          release: release(),
          arch: arch(),
        },
        hermes_agent_version: 'v0.15.2',
        hermes_web_ui_version: '9.9.9-test',
      })
    } finally {
      rmSync(appHome, { recursive: true, force: true })
    }
  })

  it('falls back to active runtime manifest when Hermes CLI version is unavailable', async () => {
    const { getPublicSystemInfo, appHome } = await loadSystemInfoWithInjectedVersion('9.9.9-test', '')

    try {
      const runtimeDir = join(appHome, 'desktop-runtime', 'hermes', '0.18.2', 'linux-x64')
      mkdirSync(runtimeDir, { recursive: true })
      writeFileSync(join(runtimeDir, 'runtime-manifest.json'), JSON.stringify({ hermesAgentVersion: '0.18.2' }))
      writeFileSync(join(appHome, 'desktop-runtime', 'active-version.json'), JSON.stringify({
        schema: 1,
        runtimeDirectory: runtimeDir,
      }))

      await expect(getPublicSystemInfo()).resolves.toMatchObject({
        hermes_agent_version: '0.18.2',
        hermes_web_ui_version: '9.9.9-test',
      })
    } finally {
      rmSync(appHome, { recursive: true, force: true })
    }
  })

  it('rejects signatures where the public key does not match the device id', async () => {
    const {
      appHome,
      createDeviceSigningPayload,
      deviceIdFromPublicKey,
      verifyDeviceSignature,
    } = await loadSystemInfoWithInjectedVersion('9.9.9-test')
    try {
      const first = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
      const second = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      })
      const timestamp = Date.now()
      const nonce = 'nonce-1'
      const deviceId = deviceIdFromPublicKey(first.publicKey)
      const signature = sign(null, Buffer.from(createDeviceSigningPayload({
        device_id: deviceId,
        nonce,
        timestamp,
      })), first.privateKey).toString('base64url')

      expect(verifyDeviceSignature({
        device_id: deviceId,
        device_public_key: first.publicKey,
        nonce,
        timestamp,
        signature,
      })).toBe(true)
      expect(verifyDeviceSignature({
        device_id: deviceId,
        device_public_key: second.publicKey,
        nonce,
        timestamp,
        signature,
      })).toBe(false)
      expect(verifyDeviceSignature({
        device_id: deviceId,
        device_public_key: first.publicKey.trim(),
        nonce,
        timestamp,
        signature,
      })).toBe(false)
    } finally {
      rmSync(appHome, { recursive: true, force: true })
    }
  })
})
