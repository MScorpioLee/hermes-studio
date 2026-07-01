import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const fnosRoot = join(root, 'fnos', 'hermes-studio')

function readFnOsFile(...segments: string[]): string {
  return readFileSync(join(fnosRoot, ...segments), 'utf-8')
}

function readFnOsJson<T>(...segments: string[]): T {
  return JSON.parse(readFnOsFile(...segments)) as T
}

function readRootJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(join(root, ...segments), 'utf-8')) as T
}

function parseManifest(text: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/)
    if (match) entries[match[1]] = match[2].trim()
  }
  return entries
}

describe('fnOS package metadata', () => {
  it('declares root runtime permissions without external app dependencies', () => {
    const privilege = readFnOsJson<{
      defaults: { 'run-as': string }
      username: string
      groupname: string
    }>('config', 'privilege')
    const runtime = readFnOsJson<{
      bundled: { node: string; python: string; hermesAgent: string }
      dependencies: { install_dep_apps: string[]; middleware: string[] }
    }>('config', 'runtime-metadata.json')

    expect(privilege.defaults['run-as']).toBe('root')
    expect(privilege.username).toBe('hermes-studio')
    expect(privilege.groupname).toBe('hermes-studio')
    expect(runtime.bundled.node).toBe('24.15.0')
    expect(runtime.bundled.python).toBe('3.12')
    expect(runtime.bundled.hermesAgent).toBe('0.17.0')
    expect(runtime.dependencies.install_dep_apps).toEqual([])
    expect(runtime.dependencies.middleware).toEqual([])
  })

  it('keeps the manifest template aligned with the package and fnOS gateway requirements', () => {
    const manifest = parseManifest(readFnOsFile('manifest'))
    const pkg = readRootJson<{ version: string }>('package.json')

    expect(manifest.version).toBe(pkg.version)
    expect(manifest.platform).toBe('x86')
    expect(manifest.os_min_version).toBe('1.1.3100')
    expect(manifest.install_dep_apps).toBe('')
    expect(manifest.desktop_uidir).toBe('ui')
    expect(manifest.desktop_applaunchname).toBe('hermes-studio.main')
    expect(manifest.changelog).toBe('https://github.com/MScorpioLee/hermes-studio/releases')
  })

  it('uses Chinese fnOS lifecycle wizards for install, upgrade, config, and uninstall', () => {
    const wizardNames = ['install', 'upgrade', 'config', 'uninstall'] as const
    const combined = wizardNames.map(name => readFnOsFile('wizard', name)).join('\n')

    for (const name of wizardNames) {
      const wizard = readFnOsJson<Array<{ stepTitle: string; items: Array<{ type: string; field?: string; label?: string }> }>>('wizard', name)
      expect(wizard.length).toBeGreaterThan(0)
      expect(wizard[0].stepTitle).toMatch(/设置|确认/)
    }

    expect(readFnOsFile('wizard', 'install')).toContain('"label": "Web UI 端口"')
    expect(readFnOsFile('wizard', 'upgrade')).toContain('更新前会停止旧的 Web UI、Hermes Agent 和 Bridge 进程')
    expect(readFnOsFile('wizard', 'config')).toContain('保存后会按新端口重启服务')
    expect(readFnOsFile('wizard', 'uninstall')).toContain('"label": "保留数据和配置"')
    expect(combined).not.toMatch(/"stepTitle":\s*"(Install|Upgrade|Config|Uninstall)"/)
    expect(combined).not.toContain('Please enter the Web UI port.')
  })

  it('registers a fnOS unified gateway entry backed by the packaged Unix socket', () => {
    const ui = readFnOsJson<{
      '.url': Record<string, {
        type: string
        protocol: string
        gatewaySocket: string
        gatewayPrefix: string
        url: string
        allUsers: boolean
      }>
    }>('app', 'ui', 'config')
    const entry = ui['.url']['hermes-studio.main']
    const mainScript = readFnOsFile('cmd', 'main')

    expect(entry.type).toBe('iframe')
    expect(entry.protocol).toBe('')
    expect(entry.gatewaySocket).toBe('hermes-studio.sock')
    expect(entry.gatewayPrefix).toBe('/app/hermes-studio')
    expect(entry.url).toBe('/app/hermes-studio/')
    expect(entry.allUsers).toBe(true)
    expect(mainScript).toContain('HERMES_WEB_UI_PUBLIC_BASE_PATH="/app/hermes-studio"')
    expect(mainScript).toContain('HERMES_WEB_UI_UNIX_SOCKET="${APP_DIR}/hermes-studio.sock"')
  })
})
