import { resolve } from 'node:path'
import { vi } from 'vitest'

if (!process.env.HERMES_WEB_UI_TEST_DB_DIR) {
  const poolId = process.env.VITEST_POOL_ID || process.env.VITEST_WORKER_ID || 'main'
  const safePoolId = poolId.replace(/[^a-zA-Z0-9._-]/g, '_')
  process.env.HERMES_WEB_UI_TEST_DB_DIR = resolve(
    process.cwd(),
    'packages/server/data/test-runtime',
    `vitest-worker-${safePoolId}-${process.pid}`,
  )
}

// Vite injects this at build time; unit tests need a stable fallback.
;(globalThis as any).__APP_VERSION__ = 'test'
// Client-only setup (window/localStorage only exist in jsdom)
if (typeof window !== 'undefined') {
  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  // Mock localStorage
  const store: Record<string, string> = {}
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value }),
      removeItem: vi.fn((key: string) => { delete store[key] }),
      clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k] }),
      get length() { return Object.keys(store).length },
      key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    },
  })
}
