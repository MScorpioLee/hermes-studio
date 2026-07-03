import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readFnOsScript(name: string): string {
  return readFileSync(join(root, 'fnos', 'hermes-studio', 'cmd', name), 'utf-8')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function createWebUiDir(rootDir: string, compatible: boolean) {
  mkdirSync(join(rootDir, 'bin'), { recursive: true })
  mkdirSync(join(rootDir, 'dist', 'server'), { recursive: true })
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    name: 'hermes-web-ui',
    version: '0.6.25',
    ...(compatible ? { hermesFnosCompatible: true } : {}),
  }))
  writeFileSync(join(rootDir, 'bin', 'hermes-web-ui.mjs'), '')
  writeFileSync(join(rootDir, 'dist', 'server', 'index.js'), '')
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

  it('rejects downloaded Web UI directories without the fnOS compatibility marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-fnos-webui-'))
    const webuiDir = join(dir, 'webui')
    createWebUiDir(webuiDir, false)

    try {
      const output = execFileSync('bash', ['-lc', [
        'set -e',
        `source ${shellQuote(join(root, 'fnos', 'hermes-studio', 'cmd', 'common'))}`,
        `BUNDLED_NODE_BIN=${shellQuote(process.execPath)}`,
        'type webui_dir_compatible >/dev/null',
        `if webui_dir_compatible ${shellQuote(webuiDir)}; then echo compatible; else echo incompatible; fi`,
      ].join('; ')], { encoding: 'utf-8' }).trim()

      expect(output).toBe('incompatible')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clears an incompatible active Web UI override and keeps the bundled server active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-fnos-active-webui-'))
    const varDir = join(dir, 'var')
    const webuiDir = join(varDir, 'hermes-web-ui', 'webui', '0.6.25')
    const activeVersionFile = join(varDir, 'hermes-web-ui', 'desktop-runtime', 'active-version.json')
    createWebUiDir(webuiDir, false)
    mkdirSync(join(varDir, 'hermes-web-ui', 'desktop-runtime'), { recursive: true })

    try {
      const output = execFileSync('bash', ['-lc', [
        'set -e',
        `source ${shellQuote(join(root, 'fnos', 'hermes-studio', 'cmd', 'common'))}`,
        `VAR_DIR=${shellQuote(varDir)}`,
        `ACTIVE_VERSION_FILE=${shellQuote(activeVersionFile)}`,
        `BUNDLED_NODE_BIN=${shellQuote(process.execPath)}`,
        'platform="$(runtime_platform_key)"',
        `printf '{"schema":1,"platform":"%s","webUiVersion":"0.6.25","webUiDirectory":"%s"}\\n' "$platform" ${shellQuote(webuiDir)} > "$ACTIVE_VERSION_FILE"`,
        'SERVER_DIR="/bundled/server"',
        'apply_active_version_overrides',
        'printf "SERVER_DIR=%s\\n" "$SERVER_DIR"',
        `${shellQuote(process.execPath)} -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); console.log("HAS_WEBUI=" + ("webUiDirectory" in data));' "$ACTIVE_VERSION_FILE"`,
      ].join('; ')], { encoding: 'utf-8' })

      expect(output).toContain('SERVER_DIR=/bundled/server')
      expect(output).toContain('HAS_WEBUI=false')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses a compatible active Web UI override when the marker is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-fnos-active-webui-'))
    const varDir = join(dir, 'var')
    const webuiDir = join(varDir, 'hermes-web-ui', 'webui', '0.6.25')
    const activeVersionFile = join(varDir, 'hermes-web-ui', 'desktop-runtime', 'active-version.json')
    createWebUiDir(webuiDir, true)
    mkdirSync(join(varDir, 'hermes-web-ui', 'desktop-runtime'), { recursive: true })

    try {
      const output = execFileSync('bash', ['-lc', [
        'set -e',
        `source ${shellQuote(join(root, 'fnos', 'hermes-studio', 'cmd', 'common'))}`,
        `VAR_DIR=${shellQuote(varDir)}`,
        `ACTIVE_VERSION_FILE=${shellQuote(activeVersionFile)}`,
        `BUNDLED_NODE_BIN=${shellQuote(process.execPath)}`,
        'platform="$(runtime_platform_key)"',
        `printf '{"schema":1,"platform":"%s","webUiVersion":"0.6.25","webUiDirectory":"%s"}\\n' "$platform" ${shellQuote(webuiDir)} > "$ACTIVE_VERSION_FILE"`,
        'SERVER_DIR="/bundled/server"',
        'apply_active_version_overrides',
        'printf "SERVER_DIR=%s\\n" "$SERVER_DIR"',
      ].join('; ')], { encoding: 'utf-8' })

      expect(output).toContain(`SERVER_DIR=${realpathSync(webuiDir)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
