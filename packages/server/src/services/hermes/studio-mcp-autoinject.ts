import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../../config'
import { updateConfigYamlForProfile } from '../config-helpers'
import { logger } from '../logger'
import { listProfileNamesFromDisk } from './hermes-profile'

const LEGACY_SERVER_NAME = 'hermes-studio'
const SERVER_TARGETS = [
  { name: 'hermes-studio-api', toolset: 'api' },
  { name: 'hermes-studio-use', toolset: 'use' },
  { name: 'hermes-studio-device', toolset: 'device' },
] as const
const MANAGED_ENV_KEY = 'HERMES_WEB_UI_MANAGED_MCP'
const LEGACY_COMMANDS = new Set([
  'hermes-lan-peer-mcp',
  'hermes-devices-mcp',
  'hermes-studio-mcp',
])

export type BundledMcpInjectionStatus = 'injected' | 'updated' | 'unchanged' | 'skipped'

export interface BundledMcpInjectionTargetResult {
  profile: string
  status: BundledMcpInjectionStatus
  reason?: string
}

export interface BundledMcpInjectionResult {
  serverName: string
  serverNames: string[]
  command: string
  targets: BundledMcpInjectionTargetResult[]
}

function isEnabledEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function isDisabled(): boolean {
  return isEnabledEnv(process.env.HERMES_WEB_UI_DISABLE_MCP_AUTOINJECT)
}

function allowTransientAutoinject(): boolean {
  return isEnabledEnv(process.env.HERMES_WEB_UI_ALLOW_TRANSIENT_MCP_AUTOINJECT)
}

function normalizedPathPrefix(pathname: string): string {
  return pathname.replace(/\/+$/, '') + '/'
}

function isTransientAppHome(appHome: string): boolean {
  const normalized = normalizedPathPrefix(appHome)
  const transientRoots = [tmpdir(), '/tmp', '/private/tmp']
    .filter(Boolean)
    .map(root => normalizedPathPrefix(root))
  return transientRoots.some(root => normalized.startsWith(root))
}

function shouldSkipTransientAutoinject(): boolean {
  return isTransientAppHome(config.appHome) && !allowTransientAutoinject()
}

function isDesktopRuntime(): boolean {
  return String(process.env.HERMES_DESKTOP || '').trim().toLowerCase() === 'true'
}

function candidateBundledMcpScripts(): string[] {
  return [
    process.env.HERMES_WEB_UI_MCP_BIN,
    join(process.cwd(), 'bin/hermes-studio-mcp.mjs'),
    join(__dirname, '../../bin/hermes-studio-mcp.mjs'),
    join(__dirname, '../../../../../bin/hermes-studio-mcp.mjs'),
  ].filter((value): value is string => !!value)
}

function bundledMcpScriptPath(): string | null {
  return candidateBundledMcpScripts().find(candidate => existsSync(candidate)) || null
}

function managedCommandConfig(): Record<string, unknown> {
  if (isDesktopRuntime()) {
    return { command: 'hermes-studio-mcp' }
  }

  const bundledScript = bundledMcpScriptPath()
  if (bundledScript) {
    return { command: process.execPath, args: [bundledScript] }
  }

  logger.warn({ candidates: candidateBundledMcpScripts() }, '[mcp-autoinject] bundled MCP script not found; falling back to PATH command')
  return { command: 'hermes-studio-mcp' }
}

function managedConfig(profile: string, target: typeof SERVER_TARGETS[number]): Record<string, unknown> {
  const env: Record<string, string> = {
    HERMES_WEB_UI_URL: `http://127.0.0.1:${config.port}`,
    HERMES_WEB_UI_HOME: config.appHome,
    HERMES_WEBUI_STATE_DIR: config.appHome,
    HERMES_WEB_UI_PROFILE: profile,
    HERMES_MCP_SERVER_NAME: target.name,
    HERMES_MCP_TOOLSET: target.toolset,
    [MANAGED_ENV_KEY]: '1',
  }

  return {
    ...managedCommandConfig(),
    env,
    enabled: true,
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isManagedServer(server: unknown): boolean {
  if (!isRecord(server)) return false
  if (isRecord(server.env) && server.env[MANAGED_ENV_KEY] === '1') return true
  return typeof server.command === 'string' && LEGACY_COMMANDS.has(server.command)
}

function sameArgs(existing: Record<string, any>, desired: Record<string, unknown>): boolean {
  const desiredArgs = Array.isArray(desired.args) ? desired.args : undefined
  const existingArgs = Array.isArray(existing.args) ? existing.args : undefined
  if (!desiredArgs && !existingArgs) return true
  if (!desiredArgs || !existingArgs) return false
  return desiredArgs.length === existingArgs.length && desiredArgs.every((arg, index) => existingArgs[index] === arg)
}

function sameConfig(existing: Record<string, any>, desired: Record<string, unknown>): boolean {
  const desiredEnv = desired.env as Record<string, string>
  return existing.command === desired.command &&
    sameArgs(existing, desired) &&
    existing.enabled !== false &&
    isRecord(existing.env) &&
    existing.env.HERMES_WEB_UI_URL === desiredEnv.HERMES_WEB_UI_URL &&
    existing.env.HERMES_WEB_UI_HOME === desiredEnv.HERMES_WEB_UI_HOME &&
    existing.env.HERMES_WEBUI_STATE_DIR === desiredEnv.HERMES_WEBUI_STATE_DIR &&
    existing.env.HERMES_WEB_UI_PROFILE === desiredEnv.HERMES_WEB_UI_PROFILE &&
    existing.env.HERMES_MCP_SERVER_NAME === desiredEnv.HERMES_MCP_SERVER_NAME &&
    existing.env.HERMES_MCP_TOOLSET === desiredEnv.HERMES_MCP_TOOLSET &&
    existing.env.HERMES_WEB_UI_TOKEN === undefined &&
    existing.env[MANAGED_ENV_KEY] === desiredEnv[MANAGED_ENV_KEY]
}

async function injectIntoProfile(profile: string, desiredConfigs: Record<string, Record<string, unknown>>): Promise<BundledMcpInjectionTargetResult> {
  return await updateConfigYamlForProfile(profile, current => {
    const cfg = isRecord(current) ? current : {}
    if (!isRecord(cfg.mcp_servers)) cfg.mcp_servers = {}

    const legacy = cfg.mcp_servers[LEGACY_SERVER_NAME]
    if (isRecord(legacy) && isManagedServer(legacy) && legacy.enabled === false) {
      return {
        data: cfg,
        write: false,
        result: {
          profile,
          status: 'skipped',
          reason: `existing ${LEGACY_SERVER_NAME} MCP server is disabled by user`,
        } satisfies BundledMcpInjectionTargetResult,
      }
    }

    let injected = false
    let updated = false
    const skipped: string[] = []

    for (const [serverName, desired] of Object.entries(desiredConfigs)) {
      const existing = cfg.mcp_servers[serverName]
      if (!existing) {
        cfg.mcp_servers[serverName] = desired
        injected = true
        continue
      }

      if (!isManagedServer(existing)) {
        skipped.push(`${serverName}: unmanaged`)
        continue
      }

      if (isRecord(existing) && existing.enabled === false) {
        skipped.push(`${serverName}: disabled by user`)
        continue
      }

      if (sameConfig(existing, desired)) continue

      cfg.mcp_servers[serverName] = desired
      updated = true
    }

    if (legacy && isManagedServer(legacy)) {
      delete cfg.mcp_servers[LEGACY_SERVER_NAME]
      updated = true
    }

    if (!injected && !updated) {
      return {
        data: cfg,
        write: false,
        result: {
          profile,
          status: skipped.length ? 'skipped' : 'unchanged',
          ...(skipped.length ? { reason: skipped.join('; ') } : {}),
        } satisfies BundledMcpInjectionTargetResult,
      }
    }

    return {
      data: cfg,
      result: {
        profile,
        status: injected && !updated ? 'injected' : 'updated',
        ...(skipped.length ? { reason: skipped.join('; ') } : {}),
      } satisfies BundledMcpInjectionTargetResult,
    }
  }) as BundledMcpInjectionTargetResult
}

export async function injectBundledMcpServer(): Promise<BundledMcpInjectionResult> {
  const commandInfo = managedConfig('default', SERVER_TARGETS[0])
  const result: BundledMcpInjectionResult = {
    serverName: SERVER_TARGETS[0].name,
    serverNames: SERVER_TARGETS.map(target => target.name),
    command: String(commandInfo.command),
    targets: [],
  }

  if (isDisabled()) {
    logger.info('[mcp-autoinject] disabled by HERMES_WEB_UI_DISABLE_MCP_AUTOINJECT')
    return result
  }

  if (shouldSkipTransientAutoinject()) {
    logger.info({ appHome: config.appHome }, '[mcp-autoinject] skipped for transient Web UI home')
    return result
  }

  for (const profile of listProfileNamesFromDisk()) {
    const desired = Object.fromEntries(SERVER_TARGETS.map(target => [target.name, managedConfig(profile, target)]))
    result.targets.push(await injectIntoProfile(profile, desired))
  }

  const changed = result.targets.filter(target => target.status === 'injected' || target.status === 'updated')
  if (changed.length > 0) {
    logger.info({
      serverNames: result.serverNames,
      command: commandInfo.command,
      targets: changed,
    }, '[mcp-autoinject] synced bundled MCP server')
  }

  const skipped = result.targets.filter(target => target.status === 'skipped')
  if (skipped.length > 0) {
    logger.warn({ serverNames: result.serverNames, targets: skipped }, '[mcp-autoinject] skipped unmanaged MCP server entries')
  }

  return result
}
