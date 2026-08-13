import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Vitest database isolation', () => {
  it('assigns each test worker a process-specific database directory', () => {
    const directory = process.env.HERMES_WEB_UI_TEST_DB_DIR || ''

    expect(basename(directory)).toMatch(/^vitest-worker-/)
    expect(basename(directory)).toContain(`-${process.pid}`)
  })
})
