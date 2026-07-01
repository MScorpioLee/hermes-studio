import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readFnOsScript(name: string): string {
  return readFileSync(join(root, 'fnos', 'hermes-studio', 'cmd', name), 'utf-8')
}

describe('fnOS lifecycle scripts', () => {
  it('keeps managed gateways across Web UI-only shutdown while wrapper stop still cleans runtime processes', () => {
    const main = readFnOsScript('main')
    const common = readFnOsScript('common')

    expect(main).toContain('export HERMES_WEB_UI_STOP_GATEWAYS_ON_SHUTDOWN=0')
    expect(common).toContain('request_webui_shutdown && wait_for_app_exit')
    expect(common).toContain('"${APP_DIR}/runtime/python"')
    expect(common).toContain('terminate_pids $pids')
    expect(common).toContain('mark_gateway_stopped')
  })
})
