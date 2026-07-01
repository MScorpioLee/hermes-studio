import { afterEach, describe, expect, it, vi } from 'vitest'

describe('fnOS update controller', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('../../packages/server/src/services/fnos-update')
  })

  it('returns the native fnOS update status', async () => {
    const status = {
      status: 'ok',
      source: 'fnos-native',
      currentVersion: '0.6.24',
      latestVersion: '0.6.25',
      updateAvailable: true,
    }
    const checkFnosUpdateStatus = vi.fn().mockResolvedValue(status)
    vi.doMock('../../packages/server/src/services/fnos-update', () => ({
      checkFnosUpdateStatus,
    }))

    const { fnosUpdateStatus } = await import('../../packages/server/src/controllers/fnos-update')
    const ctx = { status: 200, body: null as unknown }

    await fnosUpdateStatus(ctx)

    expect(checkFnosUpdateStatus).toHaveBeenCalledOnce()
    expect(ctx.status).toBe(200)
    expect(ctx.body).toBe(status)
  })
})
