// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('../../packages/client/src/api/client', () => ({
  request: requestMock,
}))

describe('fnOS update client API', () => {
  it('fetches native fnOS update status through the local BFF route', async () => {
    requestMock.mockResolvedValue({ status: 'ok', updateAvailable: false })

    const { fetchFnosUpdateStatus } = await import('../../packages/client/src/api/hermes/system')
    const result = await fetchFnosUpdateStatus()

    expect(result).toEqual({ status: 'ok', updateAvailable: false })
    expect(requestMock).toHaveBeenCalledWith('/api/hermes/fnos/update')
  })
})
