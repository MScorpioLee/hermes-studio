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

function readRootFile(...segments: string[]): string {
  return readFileSync(join(root, ...segments), 'utf-8')
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
    expect(runtime.bundled.hermesAgent).toBe('0.18.2')
    expect(runtime.dependencies.install_dep_apps).toEqual([])
    expect(runtime.dependencies.middleware).toEqual([])
  })

  it('does not declare fnOS shared data directories for internal app state', () => {
    const resource = readFnOsJson<{ 'data-share'?: { shares?: Array<{ name: string; permission?: unknown }> } }>('config', 'resource')

    expect(resource['data-share']?.shares || []).toEqual([])
  })

  it('keeps the native manifest version separate from the Web UI package version', () => {
    const manifest = parseManifest(readFnOsFile('manifest'))
    const pkg = readRootJson<{ version: string }>('package.json')

    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(manifest.version).toBe('0.6.41')
    expect(manifest.version).not.toBe(pkg.version)
    expect(readFnOsFile('cmd', 'main')).toContain('HERMES_FNOS_NATIVE_VERSION="0.6.41"')
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
    expect(readFnOsFile('wizard', 'uninstall')).toContain('删除前自动备份')
    expect(combined).not.toMatch(/"stepTitle":\s*"(Install|Upgrade|Config|Uninstall)"/)
    expect(combined).not.toContain('Please enter the Web UI port.')
  })

  it('backs up appdata before destructive uninstall cleanup', () => {
    const commonScript = readFnOsFile('cmd', 'common')
    const uninstallScript = readFnOsFile('cmd', 'uninstall_callback')

    expect(commonScript).toContain('backup_package_data_dir()')
    expect(commonScript).toContain('backup-before-uninstall')
    expect(commonScript).toContain('tar -czf "$backup_name" "$backup_base"')
    expect(uninstallScript).toContain('backup_package_data_dir || exit 1')
    expect(uninstallScript.indexOf('backup_package_data_dir || exit 1')).toBeLessThan(
      uninstallScript.indexOf('safe_clean_dir_contents "${TRIM_PKGVAR:-}"'),
    )
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

  it('enables fnOS version management for downloaded Web UI and runtime layers', () => {
    const commonScript = readFnOsFile('cmd', 'common')
    const mainScript = readFnOsFile('cmd', 'main')
    const buildScript = readRootFile('scripts', 'build-fnos-fpk.mjs')
    const sidebar = readRootFile('packages', 'client', 'src', 'components', 'layout', 'AppSidebar.vue')
    const pkg = readRootJson<{ hermesFnosCompatible?: boolean }>('package.json')

    expect(pkg.hermesFnosCompatible).toBe(true)
    expect(sidebar).toContain('versionManagementEnabled')
    expect(sidebar).toContain("VITE_HERMES_ENABLE_VERSION_MANAGEMENT === '1'")
    expect(buildScript).toContain("VITE_HERMES_ENABLE_VERSION_MANAGEMENT: '1'")
    expect(mainScript).toContain('HERMES_WEB_UI_ENABLE_VERSION_MANAGEMENT=1')
    expect(mainScript).toContain('HERMES_WEB_UI_UPDATE_MODE=version-managed')
    expect(mainScript).toContain('HERMES_WEB_UI_VERSION_MANIFEST_URL="https://raw.githubusercontent.com/MScorpioLee/hermes-studio/main/fnos/hermes-studio/webui-versions.json"')
    expect(mainScript).toContain('HERMES_WEB_UI_DOWNLOAD_GITHUB_REPO="MScorpioLee/hermes-studio"')
    expect(mainScript).toContain('HERMES_RUNTIME_DOWNLOAD_GITHUB_REPO="EKKOLearnAI/hermes-studio"')
    expect(mainScript).toContain('HERMES_FNOS_CMD_PATH="${SCRIPT_DIR}/main"')
    expect(mainScript).toContain('HERMES_FNOS_APP_DIR="$APP_DIR"')
    expect(mainScript).toContain('HERMES_FNOS_VAR_DIR="$VAR_DIR"')
    expect(mainScript).toContain('HERMES_AGENT_RUNTIME_VERSION="$RUNTIME_VERSION_VALUE"')
    expect(mainScript).toContain('HERMES_AGENT_RUNTIME_DIR="$RUNTIME_ROOT"')
    expect(mainScript).toContain('HERMES_AGENT_NODE_ROOT="$NODE_ROOT"')
    expect(mainScript).toContain('PATH="${NODE_ROOT}/bin:${PYTHON_HOME}/bin:${PATH}"')

    expect(commonScript).toContain('RUNTIME_VERSION_VALUE="0.18.2"')
    expect(commonScript).toContain('ACTIVE_VERSION_FILE="${VAR_DIR}/hermes-web-ui/desktop-runtime/active-version.json"')
    expect(commonScript).toContain('read_active_version_field')
    expect(commonScript).toContain('runtimeDirectory')
    expect(commonScript).toContain('webUiDirectory')
    expect(commonScript).toContain('runtime_dir_ready')
    expect(commonScript).toContain('webui_dir_ready')
    expect(commonScript).toContain('webui_dir_compatible')
    expect(commonScript).toContain('hermesFnosCompatible')
    expect(commonScript).toContain('apply_active_version_overrides')
    expect(buildScript).toContain('patchBundledHermesVersion')
  })

  it('materializes symlinks before handing the package to fnpack', () => {
    const buildScript = readRootFile('scripts', 'build-fnos-fpk.mjs')

    expect(buildScript).toContain('async function materializePackageSymlinks')
    expect(buildScript).toContain('await materializePackageSymlinks(stageDir)')
    expect(buildScript).toContain('readlink')
    expect(buildScript).toContain('realpath')
    expect(buildScript.indexOf('await materializePackageSymlinks(stageDir)')).toBeLessThan(
      buildScript.indexOf("run(fnpack, ['build', '--directory', stageDir]"),
    )
  })
})
