import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  aliasRootSocketIoUrl,
  installRootSocketIoAlias,
  stripPublicBasePathFromUrl,
} from '../../packages/server/src/services/public-base-path'

describe('public base path helpers', () => {
  it('strips the configured public base path before Koa routing', () => {
    expect(stripPublicBasePathFromUrl('/app/hermes-studio/api/health?x=1', '/app/hermes-studio')).toBe('/api/health?x=1')
    expect(stripPublicBasePathFromUrl('/api/health?x=1', '/app/hermes-studio')).toBe('/api/health?x=1')
  })

  it('aliases root Socket.IO traffic to the configured public base path', () => {
    expect(aliasRootSocketIoUrl('/socket.io/?EIO=4&transport=websocket', '/app/hermes-studio'))
      .toBe('/app/hermes-studio/socket.io/?EIO=4&transport=websocket')
    expect(aliasRootSocketIoUrl('/socket.io', '/app/hermes-studio')).toBe('/app/hermes-studio/socket.io')
    expect(aliasRootSocketIoUrl('/api/health', '/app/hermes-studio')).toBe('/api/health')
  })

  it('prepends root Socket.IO aliases before later request listeners run', () => {
    const listeners: Array<(req: { url?: string }) => void> = []
    const server = {
      prependListener: (_event: string, listener: (req: { url?: string }) => void) => {
        listeners.unshift(listener)
      },
    }

    listeners.push((req) => {
      expect(req.url).toBe('/app/hermes-studio/socket.io/?EIO=4&transport=websocket')
    })

    installRootSocketIoAlias([server], '/app/hermes-studio')

    const req = { url: '/socket.io/?EIO=4&transport=websocket' }
    for (const listener of listeners) listener(req)
  })

  it('installs the root Socket.IO alias after the Socket.IO server is attached', () => {
    const source = readFileSync('packages/server/src/index.ts', 'utf8')
    const socketIndex = source.indexOf('const groupChatServer = new GroupChatServer(servers)')
    const aliasIndex = source.indexOf('installRootSocketIoAlias(servers)')

    expect(socketIndex).toBeGreaterThan(-1)
    expect(aliasIndex).toBeGreaterThan(socketIndex)
  })
})
