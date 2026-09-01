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

describe('fnOS lifecycle scripts', { timeout: 15_000 }, () => {
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

  it('uses an upstream-style active Web UI version stored under desktop-runtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-fnos-active-webui-version-'))
    const varDir = join(dir, 'var')
    const webuiDir = join(varDir, 'hermes-web-ui', 'desktop-runtime', 'webui', '0.6.38')
    const activeVersionFile = join(varDir, 'hermes-web-ui', 'desktop-runtime', 'active-version.json')
    createWebUiDir(webuiDir, true)

    try {
      const output = execFileSync('bash', ['-lc', [
        'set -e',
        `source ${shellQuote(join(root, 'fnos', 'hermes-studio', 'cmd', 'common'))}`,
        `VAR_DIR=${shellQuote(varDir)}`,
        `ACTIVE_VERSION_FILE=${shellQuote(activeVersionFile)}`,
        `BUNDLED_NODE_BIN=${shellQuote(process.execPath)}`,
        'platform="$(runtime_platform_key)"',
        `printf '{"schema":1,"platform":"%s","webUiVersion":"0.6.38"}\\n' "$platform" > "$ACTIVE_VERSION_FILE"`,
        'SERVER_DIR="/bundled/server"',
        'apply_active_version_overrides',
        'printf "SERVER_DIR=%s\\n" "$SERVER_DIR"',
      ].join('; ')], { encoding: 'utf-8' })

      expect(output).toContain(`SERVER_DIR=${realpathSync(webuiDir)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses the python venv from a schema 2 downloaded runtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-fnos-runtime-'))
    const varDir = join(dir, 'var')
    const platform = process.platform === 'darwin' ? `mac-${process.arch}` : `${process.platform}-${process.arch}`
    const runtimeDir = join(varDir, 'hermes-web-ui', 'desktop-runtime', 'hermes', '0.20.0', platform)
    const pythonHome = join(runtimeDir, 'python', 'venv')
    const activeVersionFile = join(varDir, 'hermes-web-ui', 'desktop-runtime', 'active-version.json')
    mkdirSync(join(pythonHome, 'bin'), { recursive: true })
    mkdirSync(join(runtimeDir, 'node', 'bin'), { recursive: true })
    writeFileSync(join(pythonHome, 'bin', 'python3'), '')
    writeFileSync(join(pythonHome, 'bin', 'hermes'), '')
    writeFileSync(join(runtimeDir, 'node', 'bin', 'node'), '')
    writeFileSync(join(runtimeDir, 'runtime-manifest.json'), JSON.stringify({
      schema: 2,
      platform,
      hermesAgentVersion: '0.20.0',
    }))
    mkdirSync(join(varDir, 'hermes-web-ui', 'desktop-runtime'), { recursive: true })

    try {
      const output = execFileSync('bash', ['-lc', [
        'set -e',
        `source ${shellQuote(join(root, 'fnos', 'hermes-studio', 'cmd', 'common'))}`,
        `VAR_DIR=${shellQuote(varDir)}`,
        `ACTIVE_VERSION_FILE=${shellQuote(activeVersionFile)}`,
        `BUNDLED_NODE_BIN=${shellQuote(process.execPath)}`,
        `printf '{"schema":1,"platform":"%s","hermesRuntimeVersion":"0.20.0","runtimeDirectory":"%s"}\\n' ${shellQuote(platform)} ${shellQuote(runtimeDir)} > "$ACTIVE_VERSION_FILE"`,
        'apply_active_version_overrides',
        'printf "RUNTIME_VERSION=%s\\nRUNTIME_ROOT=%s\\nPYTHON_SOURCE_ROOT=%s\\nPYTHON_HOME=%s\\nPYTHON_BIN=%s\\nHERMES_BIN=%s\\n" "$RUNTIME_VERSION_VALUE" "$RUNTIME_ROOT" "$PYTHON_SOURCE_ROOT" "$PYTHON_HOME" "$PYTHON_BIN" "$HERMES_BIN_VALUE"',
      ].join('; ')], { encoding: 'utf-8' })

      expect(output).toContain('RUNTIME_VERSION=0.20.0')
      expect(output).toContain(`RUNTIME_ROOT=${realpathSync(runtimeDir)}`)
      expect(output).toContain(`PYTHON_SOURCE_ROOT=${realpathSync(join(runtimeDir, 'python'))}`)
      expect(output).toContain(`PYTHON_HOME=${realpathSync(pythonHome)}`)
      expect(output).toContain(`PYTHON_BIN=${realpathSync(join(pythonHome, 'bin', 'python3'))}`)
      expect(output).toContain(`HERMES_BIN=${realpathSync(join(pythonHome, 'bin', 'hermes'))}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses the python venv from a schema 2 bundled runtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-fnos-bundled-runtime-'))
    const appDir = join(dir, 'app')
    const pythonSourceRoot = join(appDir, 'runtime', 'python')
    const pythonHome = join(pythonSourceRoot, 'venv')
    mkdirSync(join(pythonHome, 'bin'), { recursive: true })
    mkdirSync(join(appDir, 'runtime', 'node', 'bin'), { recursive: true })
    writeFileSync(join(pythonHome, 'bin', 'python3'), '')
    writeFileSync(join(pythonHome, 'bin', 'hermes'), '')
    writeFileSync(join(appDir, 'runtime', 'node', 'bin', 'node'), '')

    try {
      const output = execFileSync('bash', ['-lc', [
        'set -e',
        `TRIM_APPDEST=${shellQuote(appDir)}`,
        `source ${shellQuote(join(root, 'fnos', 'hermes-studio', 'cmd', 'common'))}`,
        'printf "PYTHON_SOURCE_ROOT=%s\\nPYTHON_HOME=%s\\nPYTHON_BIN=%s\\nHERMES_BIN=%s\\n" "$PYTHON_SOURCE_ROOT" "$PYTHON_HOME" "$PYTHON_BIN" "$HERMES_BIN_VALUE"',
      ].join('; ')], { encoding: 'utf-8' })

      expect(output).toContain(`PYTHON_SOURCE_ROOT=${pythonSourceRoot}`)
      expect(output).toContain(`PYTHON_HOME=${pythonHome}`)
      expect(output).toContain(`PYTHON_BIN=${join(pythonHome, 'bin', 'python3')}`)
      expect(output).toContain(`HERMES_BIN=${join(pythonHome, 'bin', 'hermes')}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
