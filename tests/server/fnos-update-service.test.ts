import { describe, expect, it, vi } from 'vitest'

describe('fnOS native update service', () => {
  it('reports an available fnOS package update from release metadata', async () => {
    const { checkFnosUpdateStatus } = await import('../../packages/server/src/services/fnos-update')
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        appname: 'hermes-studio',
        version: '0.6.23',
        fpk_version: '0.6.25',
        native_shell_version: '0.6.25',
        webui_version: '0.6.23',
        release_tag: 'fnos-v0.6.25',
        download_url: 'https://github.com/MScorpioLee/hermes-studio/releases/download/fnos-v0.6.25/hermes-studio.fpk',
        source_repo: 'https://github.com/EKKOLearnAI/hermes-studio',
        packaging_repo: 'https://github.com/MScorpioLee/hermes-studio',
        update_source: 'fnos-native',
        service_port: 6060,
        gateway_prefix: '/app/hermes-studio',
        bundled_runtime: { hermes_agent: '0.17.0' },
        layers: {
          native_shell: { version: '0.6.25' },
          webui: { version: '0.6.23' },
          hermes_agent_runtime: { version: '0.17.0' },
        },
        updated_at: '2026-07-01T02:00:00Z',
      }),
    }))

    const status = await checkFnosUpdateStatus({
      currentVersion: '0.6.24',
      metadataUrl: 'https://example.test/hermes-studio.latest.json',
      fetchImpl,
      now: () => new Date('2026-07-01T02:30:00Z'),
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/hermes-studio.latest.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(status).toMatchObject({
      status: 'ok',
      source: 'fnos-native',
      currentVersion: '0.6.24',
      latestVersion: '0.6.25',
      updateAvailable: true,
      metadataUrl: 'https://example.test/hermes-studio.latest.json',
      downloadUrl: 'https://github.com/MScorpioLee/hermes-studio/releases/download/fnos-v0.6.25/hermes-studio.fpk',
      releaseUrl: 'https://github.com/MScorpioLee/hermes-studio/releases/tag/fnos-v0.6.25',
      releaseTag: 'fnos-v0.6.25',
      servicePort: 6060,
      gatewayPrefix: '/app/hermes-studio',
      nativeShellVersion: '0.6.25',
      webuiVersion: '0.6.23',
      sourceRepo: 'https://github.com/EKKOLearnAI/hermes-studio',
      packagingRepo: 'https://github.com/MScorpioLee/hermes-studio',
      bundledRuntime: { hermes_agent: '0.17.0' },
      layers: {
        native_shell: { version: '0.6.25' },
        webui: { version: '0.6.23' },
        hermes_agent_runtime: { version: '0.17.0' },
      },
      checkedAt: '2026-07-01T02:30:00.000Z',
    })
  })

  it('returns an unavailable status when metadata lookup fails', async () => {
    const { checkFnosUpdateStatus } = await import('../../packages/server/src/services/fnos-update')

    const status = await checkFnosUpdateStatus({
      currentVersion: '0.6.24',
      metadataUrl: 'https://example.test/hermes-studio.latest.json',
      fetchImpl: vi.fn(async () => {
        throw new Error('network down')
      }),
      now: () => new Date('2026-07-01T02:30:00Z'),
    })

    expect(status).toMatchObject({
      status: 'unavailable',
      source: 'fnos-native',
      currentVersion: '0.6.24',
      latestVersion: '',
      updateAvailable: false,
      metadataUrl: 'https://example.test/hermes-studio.latest.json',
      checkedAt: '2026-07-01T02:30:00.000Z',
      error: 'network down',
    })
  })
})
