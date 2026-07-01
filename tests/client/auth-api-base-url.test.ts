// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/router', () => ({
  default: {
    currentRoute: { value: { name: 'login' } },
    replace: vi.fn(),
  },
}))

async function loadAuthApiWithBaseUrl(baseUrl: string) {
  vi.resetModules()
  vi.stubEnv('BASE_URL', baseUrl)
  return import('../../packages/client/src/api/auth')
}

async function loadApiClientWithBaseUrl(baseUrl: string) {
  vi.resetModules()
  vi.stubEnv('BASE_URL', baseUrl)
  return import('../../packages/client/src/api/client')
}

describe('auth API base URL handling', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    delete (window as any).hermesDesktop
  })

  it('uses the public base path for password login when embedded behind the fnOS gateway', async () => {
    ;(window as any).hermesDesktop = { isDesktop: true }
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ token: 'jwt-token' }),
    })

    const { loginWithPassword } = await loadAuthApiWithBaseUrl('/app/hermes-studio/')
    const token = await loginWithPassword('admin', '123456')

    expect(token).toBe('jwt-token')
    expect(mockFetch).toHaveBeenCalledWith('/app/hermes-studio/api/auth/login', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('uses the public base path for auth status when embedded behind the fnOS gateway', async () => {
    ;(window as any).hermesDesktop = { isDesktop: true }
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ hasPasswordLogin: true, hasUsers: true }),
    })

    const { fetchAuthStatus } = await loadAuthApiWithBaseUrl('/app/hermes-studio/')
    await fetchAuthStatus()

    expect(mockFetch).toHaveBeenCalledWith('/app/hermes-studio/api/auth/status')
  })

  it('ignores stale custom server URLs when packaged with a public base path', async () => {
    localStorage.setItem('hermes_server_url', 'http://192.168.10.14:6060')
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    })

    const { getBaseUrlValue, getSocketIoPathValue, request } = await loadApiClientWithBaseUrl('/app/hermes-studio/')
    await request('/api/hermes/sessions')

    expect(getBaseUrlValue()).toBe('/app/hermes-studio')
    expect(getSocketIoPathValue()).toBe('/app/hermes-studio/socket.io')
    expect(mockFetch).toHaveBeenCalledWith('/app/hermes-studio/api/hermes/sessions', expect.any(Object))
  })
})
