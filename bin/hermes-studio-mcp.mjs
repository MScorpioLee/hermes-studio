#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = process.env.HERMES_WEB_UI_PORT || process.env.PORT || '8648'
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`
const SERVER_NAME = process.env.HERMES_MCP_SERVER_NAME || 'hermes-studio-mcp'
const TOOLSET_ARG_PREFIXES = ['--toolset=', '--mode=', '--mcp-toolset=']
const ALLOWED_PUBLIC_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'x-request-id',
])

const __dirname = dirname(fileURLToPath(import.meta.url))

function readPackageVersion() {
  const candidates = [
    resolve(__dirname, '../package.json'),
    resolve(__dirname, '../../package.json'),
    resolve(process.cwd(), 'package.json'),
  ]
  for (const packagePath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
      if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim()
    } catch {
      // Try the next candidate path.
    }
  }
  return '0.0.0'
}

const VERSION = readPackageVersion()

function printHelp() {
  process.stdout.write(`hermes-studio-mcp v${VERSION}

Hermes Web UI MCP stdio server.

Usage:
  hermes-studio-mcp
  hermes-studio-mcp --help
  hermes-studio-mcp --version
  hermes-studio-mcp --toolset=api
  hermes-studio-mcp --toolset=use
  hermes-studio-mcp --toolset=device

Environment:
  HERMES_WEB_UI_URL       Web UI base URL. Default: ${DEFAULT_BASE_URL}
  HERMES_WEB_UI_HOME      Web UI state directory. Default: ~/.hermes-web-ui
  HERMES_WEBUI_STATE_DIR  Fallback Web UI state directory.
  HERMES_WEB_UI_PROFILE   Default Hermes profile when a tool call omits profile.
  HERMES_WEB_UI_TOKEN     Optional explicit API token.
  AUTH_TOKEN              Optional explicit API token fallback.
  HERMES_MCP_SERVER_NAME  MCP server name. Suffixes like -api, -use, -device, or -设备 select a toolset.
  HERMES_MCP_TOOLSET      Explicit toolset: all, api, use, or device. Overrides server-name inference.

When run without options, this process waits for MCP JSON-RPC messages on stdin.
`)
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  printHelp()
  process.exit(0)
}

if (process.argv.includes('-v') || process.argv.includes('--version')) {
  process.stdout.write(`${SERVER_NAME} v${VERSION}\n`)
  process.exit(0)
}

function appHome() {
  return process.env.HERMES_WEB_UI_HOME ||
    process.env.HERMES_WEBUI_STATE_DIR ||
    join(homedir(), '.hermes-web-ui')
}

function normalizeProfileSegment(profile) {
  const raw = String(profile || '').trim()
  if (!raw) return ''
  const sanitized = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  if (sanitized === '.' || sanitized === '..' || sanitized.length > 128) return ''
  return sanitized
}

function readProfileToken(profile) {
  const segment = normalizeProfileSegment(profile)
  if (!segment) return ''
  try {
    return readFileSync(join(appHome(), 'profiles', segment, '.model-run-token'), 'utf8').trim()
  } catch {
    return ''
  }
}

function readToken(tokenOverride, allowTokenFile = true, profile = '') {
  const explicit = tokenOverride || process.env.HERMES_WEB_UI_TOKEN || process.env.AUTH_TOKEN
  if (explicit) return explicit.trim()
  if (!allowTokenFile) return ''
  const profileToken = readProfileToken(profile)
  if (profileToken) return profileToken
  try {
    return readFileSync(join(appHome(), '.token'), 'utf8').trim()
  } catch {
    return ''
  }
}

function defaultProfile() {
  return String(
    process.env.HERMES_WEB_UI_PROFILE ||
    process.env.HERMES_PROFILE ||
    process.env.PROFILE ||
    '',
  ).trim()
}

function cliToolsetArg() {
  for (const arg of process.argv.slice(2)) {
    for (const prefix of TOOLSET_ARG_PREFIXES) {
      if (arg.startsWith(prefix)) return arg.slice(prefix.length)
    }
  }
  return ''
}

function normalizeToolset(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  if (['all', 'full', 'default'].includes(raw)) return 'all'
  if (['api', 'api_docs', 'apidoc', 'openapi', 'docs'].some(token => raw === token || raw.endsWith(`-${token}`) || raw.includes(`_${token}`))) return 'api'
  if (['use'].some(token => raw === token || raw.endsWith(`-${token}`) || raw.includes(`_${token}`))) return 'use'
  if (['device', 'devices', 'lan', 'peer', 'terminal', '\u8bbe\u5907'].some(token => raw === token || raw.endsWith(`-${token}`) || raw.includes(`_${token}`) || raw.includes(token))) return 'device'
  return ''
}

const MCP_TOOLSET = normalizeToolset(process.env.HERMES_MCP_TOOLSET) ||
  normalizeToolset(cliToolsetArg()) ||
  normalizeToolset(SERVER_NAME) ||
  'all'

function authHint() {
  return `Web UI token was not accepted. Pass the current Hermes profile argument so this MCP server can read its temporary token, pass an explicit token argument, or set HERMES_WEB_UI_TOKEN.`
}

function baseUrl() {
  return (process.env.HERMES_WEB_UI_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
}

function jsonText(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

function errorText(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

async function request(path, options = {}) {
  const envelope = await requestEnvelope(path, options)
  if (envelope.status < 200 || envelope.status >= 300) {
    if (envelope.status === 401) {
      throw new Error(`${envelope.body?.error || 'Unauthorized'}. ${authHint()}`)
    }
    throw new Error(envelope.body?.error || envelope.bodyText || `HTTP ${envelope.status}`)
  }
  return envelope.body
}

function appendQuery(path, query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return path
  const parsed = new URL(path, 'http://hermes-web-ui.local')
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) parsed.searchParams.append(key, String(item))
      }
      continue
    }
    parsed.searchParams.set(key, String(value))
  }
  return `${parsed.pathname}${parsed.search}`
}

function normalizePublicHeaders(headers) {
  const normalized = {}
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return normalized
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (!ALLOWED_PUBLIC_REQUEST_HEADERS.has(lower) || value == null) continue
    normalized[lower] = Array.isArray(value) ? String(value.find(Boolean) || '') : String(value)
  }
  return normalized
}

async function requestEnvelope(path, options = {}) {
  const profile = typeof options.profile === 'string' && options.profile.trim()
    ? options.profile.trim()
    : defaultProfile()
  const token = readToken(options.token, options.allowTokenFile !== false, profile)
  const method = options.method || 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : options.body
  const headers = {
    ...normalizePublicHeaders(options.headers),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(profile ? { 'X-Hermes-Profile': profile } : {}),
  }
  const response = await fetch(`${baseUrl()}${appendQuery(path, options.query)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const responseHeaders = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  if (method === 'HEAD' || response.status === 204) {
    return { status: response.status, headers: responseHeaders, body: null }
  }
  const contentType = response.headers.get('content-type') || ''
  const bodyText = await response.text()
  let parsedBody = bodyText
  if (contentType.toLowerCase().includes('application/json')) {
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : null
    } catch {
      parsedBody = bodyText
    }
  }
  return { status: response.status, headers: responseHeaders, body: parsedBody, bodyText }
}

function normalizeApiMethod(method) {
  const value = String(method || 'GET').trim().toUpperCase()
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(value) ? value : null
}

function normalizeApiPath(path) {
  const raw = String(path || '').trim()
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  if (raw === '/v1' || raw.startsWith('/v1/')) return null
  const parsed = new URL(raw, 'http://hermes-web-ui.local')
  const normalized = `${parsed.pathname}${parsed.search}`
  if (parsed.pathname === '/api/openapi.json') return normalized
  if (parsed.pathname === '/health') return normalized
  if (parsed.pathname.startsWith('/api/')) return normalized
  return null
}

let cachedOpenApiDocument = null

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function openApiDocument(options = {}) {
  if (cachedOpenApiDocument) return cachedOpenApiDocument
  cachedOpenApiDocument = await request('/api/openapi.json', options)
  return cachedOpenApiDocument
}

function pathWithoutQuery(path) {
  return new URL(path, 'http://hermes-web-ui.local').pathname
}

function pathTemplateRegex(template) {
  const escaped = String(template).split('/').map(part => {
    if (/^\{[^/{}]+\}$/.test(part)) return '[^/]+'
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('/')
  return new RegExp(`^${escaped}$`)
}

function findOpenApiOperation(openapi, method, path) {
  const paths = isRecord(openapi?.paths) ? openapi.paths : {}
  const pathname = pathWithoutQuery(path)
  const exact = paths[pathname]?.[method.toLowerCase()]
  if (exact) return { operation: exact, pathTemplate: pathname }
  for (const [template, methods] of Object.entries(paths)) {
    if (!pathTemplateRegex(template).test(pathname)) continue
    const operation = isRecord(methods) ? methods[method.toLowerCase()] : null
    if (operation) return { operation, pathTemplate: template }
  }
  return null
}

function queryObjectFromPath(path, query) {
  const parsed = new URL(path, 'http://hermes-web-ui.local')
  const values = {}
  for (const [key, value] of parsed.searchParams.entries()) {
    if (values[key] === undefined) values[key] = value
    else if (Array.isArray(values[key])) values[key].push(value)
    else values[key] = [values[key], value]
  }
  if (isRecord(query)) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) values[key] = value
    }
  }
  return values
}

function missingValue(value) {
  return value === undefined || value === null || value === ''
}

function validateRequiredObjectFields(schema, value, location) {
  if (!schema || !Array.isArray(schema.required) || schema.required.length === 0) return null
  if (!isRecord(value)) return `${location} must be an object with required fields: ${schema.required.join(', ')}`
  for (const field of schema.required) {
    if (missingValue(value[field])) return `missing required field ${location}.${field}`
  }
  return null
}

async function validateApiRequest(method, path, args) {
  if (pathWithoutQuery(path) === '/api/openapi.json' || pathWithoutQuery(path) === '/api/hermes/openapi.json') return null
  const openapi = await openApiDocument(withAuthArgs(args))
  const match = findOpenApiOperation(openapi, method, path)
  if (!match) return `Unknown endpoint in OpenAPI document: ${method} ${pathWithoutQuery(path)}`
  const { operation } = match
  const queryValues = queryObjectFromPath(path, args.query)
  for (const parameter of Array.isArray(operation.parameters) ? operation.parameters : []) {
    if (!parameter?.required) continue
    if (parameter.in === 'query' && missingValue(queryValues[parameter.name])) {
      return `missing required query parameter ${parameter.name}`
    }
    if (parameter.in === 'path') {
      // Path templates are already matched by the request path; no separate path arg exists.
      continue
    }
  }
  const requestBody = operation.requestBody
  if (!requestBody) return null
  const body = args.body
  if (requestBody.required && body === undefined) return `missing required request body for ${method} ${pathWithoutQuery(path)}`
  if (body === undefined) return null
  const schema = requestBody.content?.['application/json']?.schema
  return validateRequiredObjectFields(schema, body, 'body')
}

function schemaType(schema) {
  if (!isRecord(schema)) return undefined
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.oneOf)) return `oneOf(${schema.oneOf.map(schemaType).filter(Boolean).join('|')})`
  if (Array.isArray(schema.anyOf)) return `anyOf(${schema.anyOf.map(schemaType).filter(Boolean).join('|')})`
  if (schema.$ref) return String(schema.$ref).split('/').pop()
  return undefined
}

function compactParameters(parameters) {
  const path = []
  const query = []
  for (const parameter of Array.isArray(parameters) ? parameters : []) {
    if (!parameter?.name) continue
    const item = {
      name: parameter.name,
      required: parameter.required === true,
      type: schemaType(parameter.schema) || 'string',
      ...(Array.isArray(parameter.schema?.enum) ? { enum: parameter.schema.enum } : {}),
    }
    if (parameter.in === 'path') path.push(item)
    if (parameter.in === 'query') query.push(item)
  }
  return { path, query }
}

function compactBodyFields(requestBody) {
  const schema = requestBody?.content?.['application/json']?.schema
  if (!isRecord(schema?.properties)) return []
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return Object.entries(schema.properties).map(([name, property]) => {
    return {
      name,
      required: required.has(name),
      type: schemaType(property) || 'unknown',
      ...(Array.isArray(property?.enum) ? { enum: property.enum } : {}),
      ...(property?.description ? { description: String(property.description) } : {}),
    }
  })
}

const moduleHints = {
  'API Docs': {
    purpose: 'Discover the Hermes Studio API catalog and generated OpenAPI metadata.',
    keywords: ['接口目录', '接口文档', 'API catalog', 'OpenAPI', 'route catalog'],
  },
  Auth: {
    purpose: 'Manage Web UI authentication state and tokens.',
    keywords: ['auth', 'login', 'token', 'session'],
  },
  'Chat Run': {
    purpose: 'Start a chat or coding-agent run through the HTTP bridge and wait for the result.',
    keywords: ['chat', 'run', 'execute', 'agent', 'model'],
  },
  'Coding Agents': {
    purpose: 'Install, configure, and run coding agents such as Codex or Claude Code.',
    keywords: ['codex', 'claude', 'coding agent', 'install', 'run'],
  },
  Config: {
    purpose: 'Read and update Hermes Web UI configuration.',
    keywords: ['config', 'settings', 'preferences'],
  },
  Devices: {
    purpose: 'Discover, pair, and operate LAN peer devices, terminals, commands, and file transfer.',
    keywords: ['device', 'lan', 'peer', 'terminal', 'file transfer'],
  },
  Files: {
    purpose: 'Browse and operate files exposed through the Hermes file browser.',
    keywords: ['files', 'browser', 'read', 'list', 'download'],
  },
  'Group Chat': {
    purpose: 'Manage multi-participant group chat rooms and messages.',
    keywords: ['group chat', 'room', 'participants', 'messages'],
  },
  Jobs: {
    purpose: 'Create, inspect, update, and run scheduled or background jobs.',
    keywords: ['jobs', 'schedule', 'cron', 'tasks', 'automation'],
  },
  Kanban: {
    purpose: 'Manage boards, columns, cards, and task workflow state.',
    keywords: ['kanban', 'board', 'task', 'card', 'workflow'],
  },
  MCP: {
    purpose: 'Manage MCP servers, tools, and Web UI MCP integration.',
    keywords: ['mcp', 'tools', 'server', 'integration'],
  },
  Media: {
    purpose: 'Generate or manage media assets.',
    keywords: ['media', 'image', 'generation', 'asset'],
  },
  Memory: {
    purpose: 'Read and manage agent memory files.',
    keywords: ['memory', 'agent memory', 'notes'],
  },
  Models: {
    purpose: 'Inspect and configure model ids available to Hermes.',
    keywords: ['models', 'model id', 'llm'],
  },
  Profiles: {
    purpose: 'Manage Hermes profiles and profile-scoped runtime state.',
    keywords: ['profile', 'workspace', 'account'],
  },
  Providers: {
    purpose: 'Manage model provider configuration and credentials metadata.',
    keywords: ['provider', 'model provider', 'api key', 'base url'],
  },
  Sessions: {
    purpose: 'List, inspect, create, update, and delete chat sessions.',
    keywords: ['sessions', 'conversation', 'chat history'],
  },
  Skills: {
    purpose: 'Browse and manage skills available to Hermes agents.',
    keywords: ['skills', 'agent skill', 'capability'],
  },
  Terminal: {
    purpose: 'Open interactive terminal sessions over WebSocket.',
    keywords: ['terminal', 'shell', 'websocket'],
  },
  'Write Gate': {
    purpose: 'Review and approve Hermes Agent write operations.',
    keywords: ['approval', 'write gate', 'review'],
  },
}

function compactOperation(path, method, operation) {
  const parameters = compactParameters(operation.parameters)
  const body = compactBodyFields(operation.requestBody)
  return {
    method: method.toUpperCase(),
    path,
    ...(operation.operationId ? { operationId: operation.operationId } : {}),
    ...(Array.isArray(operation.tags) && operation.tags.length ? { tags: operation.tags } : {}),
    ...(operation.summary ? { summary: operation.summary } : {}),
    ...(parameters.path.length ? { pathParams: parameters.path } : {}),
    ...(parameters.query.length ? { queryParams: parameters.query } : {}),
    ...(operation.requestBody ? {
      requestBody: {
        required: operation.requestBody.required === true,
        fields: body,
      },
    } : {}),
  }
}

function collectOpenApiModules(openapi) {
  const descriptions = new Map()
  for (const tag of Array.isArray(openapi?.tags) ? openapi.tags : []) {
    if (typeof tag?.name === 'string') descriptions.set(tag.name, String(tag.description || ''))
  }

  const counts = new Map()
  const paths = isRecord(openapi?.paths) ? openapi.paths : {}
  for (const methods of Object.values(paths)) {
    if (!isRecord(methods)) continue
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue
      const tags = Array.isArray(operation?.tags) && operation.tags.length ? operation.tags : ['Untagged']
      for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, operationCount]) => ({
      tag,
      operationCount,
      ...(moduleHints[tag]?.purpose ? { purpose: moduleHints[tag].purpose } : {}),
      ...(moduleHints[tag]?.keywords ? { keywords: moduleHints[tag].keywords } : {}),
      ...(descriptions.get(tag) ? { description: descriptions.get(tag) } : {}),
    }))
}

function compactOpenApiDocument(openapi, args = {}) {
  if (args.full === true) return openapi
  const filterPath = typeof args.path === 'string' && args.path.trim() ? pathWithoutQuery(args.path.trim()) : ''
  const filterMethod = typeof args.method === 'string' && args.method.trim()
    ? normalizeApiMethod(args.method)
    : null
  const filterTag = typeof args.tag === 'string' && args.tag.trim() ? args.tag.trim() : ''
  const filters = {
    ...(filterPath ? { path: filterPath } : {}),
    ...(filterMethod ? { method: filterMethod } : {}),
    ...(filterTag ? { tag: filterTag } : {}),
  }
  const hasFilters = Object.keys(filters).length > 0
  const modules = collectOpenApiModules(openapi)
  const operations = []
  const paths = isRecord(openapi?.paths) ? openapi.paths : {}
  for (const [path, methods] of Object.entries(paths)) {
    if (filterPath && path !== filterPath) continue
    if (!isRecord(methods)) continue
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue
      if (filterMethod && method !== filterMethod.toLowerCase()) continue
      if (filterTag && !(Array.isArray(operation?.tags) && operation.tags.includes(filterTag))) continue
      operations.push(compactOperation(path, method, operation))
    }
  }

  return {
    title: openapi?.info?.title || 'Hermes Studio API',
    version: openapi?.info?.version || '',
    usage: hasFilters
      ? 'Use the selected operation details to call hermes_api_request with method, path, query, and body. Auth and profile are handled by the MCP server.'
      : 'This catalog is large. First read module purpose and keywords to choose the right module, then call hermes_api_openapi_get again with tag, path, or method filters to fetch endpoint details on demand.',
    moduleCount: modules.length,
    modules,
    ...(Object.keys(filters).length ? { filters } : {}),
    operationCount: operations.length,
    ...(hasFilters ? { operations } : { operationsOmitted: true }),
  }
}

function compactAvailableModels(envelope, args = {}) {
  const body = isRecord(envelope?.body) ? envelope.body : {}
  const providerFilter = String(args.provider || '').trim().toLowerCase()
  const compactGroup = (group) => {
    if (!isRecord(group)) return null
    const provider = String(group.provider || '').trim()
    if (!provider) return null
    if (providerFilter && provider.toLowerCase() !== providerFilter) return null
    const models = Array.isArray(group.models) ? group.models.map(item => String(item)).filter(Boolean) : []
    return {
      provider,
      ...(group.label ? { label: String(group.label) } : {}),
      ...(group.api_mode ? { api_mode: String(group.api_mode) } : {}),
      model_count: models.length,
      models_preview: models.slice(0, 10),
      truncated: models.length > 10,
    }
  }
  const groups = (Array.isArray(body.groups) ? body.groups : []).map(compactGroup).filter(Boolean)
  const profiles = (Array.isArray(body.profiles) ? body.profiles : [])
    .filter(isRecord)
    .map(profile => ({
      profile: String(profile.profile || '').trim(),
      default: String(profile.default || '').trim(),
      default_provider: String(profile.default_provider || '').trim(),
    }))
  return {
    status: envelope.status,
    default: String(body.default || '').trim(),
    default_provider: String(body.default_provider || '').trim(),
    provider_count: groups.length,
    groups,
    ...(profiles.length ? { profiles } : {}),
    compact: true,
    note: 'Compact output omits full model catalogs and metadata. Pass full=true or provider=<id> when more detail is needed.',
  }
}

function findModelProviders(envelope, args = {}) {
  const body = isRecord(envelope?.body) ? envelope.body : {}
  const model = String(args.model || '').trim()
  const matches = []
  for (const group of Array.isArray(body.groups) ? body.groups : []) {
    if (!isRecord(group)) continue
    const provider = String(group.provider || '').trim()
    if (!provider) continue
    const models = Array.isArray(group.models) ? group.models.map(item => String(item)).filter(Boolean) : []
    if (!models.includes(model)) continue
    matches.push({
      provider,
      ...(group.label ? { label: String(group.label) } : {}),
      ...(group.api_mode ? { api_mode: String(group.api_mode) } : {}),
      model,
    })
  }
  return {
    status: envelope.status,
    model,
    provider: matches[0]?.provider || '',
    provider_count: matches.length,
    matches,
    ...(args.model_profile ? { profile: String(args.model_profile) } : {}),
    found: matches.length > 0,
  }
}

const authArgumentProperties = {
  token: {
    type: 'string',
    description: 'Optional Hermes Web UI bearer token. Usually omit this and pass profile so the MCP server can read the temporary profile token.',
  },
  profile: {
    type: 'string',
    description: 'Hermes profile name for profile-scoped Web UI requests and temporary profile token lookup.',
  },
}

function inputSchema(properties = {}, required = []) {
  return {
    type: 'object',
    properties: { ...authArgumentProperties, ...properties },
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}

function withAuthArgs(args, options = {}) {
  return {
    ...options,
    token: args.token,
    profile: args.profile,
  }
}

const deviceActionToolNames = {
  list: 'hermes_lan_devices_list',
  scan: 'hermes_lan_devices_scan',
  connect: 'hermes_lan_peer_connect',
  connections: 'hermes_lan_peer_connections',
  disconnect: 'hermes_lan_peer_disconnect',
  terminal_create: 'hermes_lan_terminal_create',
  terminal_list: 'hermes_lan_terminal_list',
  terminal_input: 'hermes_lan_terminal_input',
  terminal_read: 'hermes_lan_terminal_read',
  terminal_resize: 'hermes_lan_terminal_resize',
  terminal_close: 'hermes_lan_terminal_close',
  command_exec: 'hermes_lan_command_exec',
  file_download: 'hermes_lan_file_download',
  file_upload: 'hermes_lan_file_upload',
}

function routedAuthArgs(args, payload) {
  return {
    ...(isRecord(payload) ? payload : {}),
    token: isRecord(payload) && payload.token ? payload.token : args.token,
    profile: isRecord(payload) && payload.profile ? payload.profile : args.profile,
  }
}

function hermesRouterGuide() {
  return {
    usage: 'Pass exactly one branch: device for LAN device operations, or use for Hermes Studio API/OpenAPI discovery and execution. Source-specific MCP servers expose api, use, or device toolsets separately.',
    branches: {
      device: {
        description: 'Operate LAN devices, peer connections, terminals, commands, and file transfer.',
        actionField: 'device.action',
        actions: Object.keys(deviceActionToolNames),
        examples: [
          { device: { action: 'scan' } },
          { device: { action: 'connect', device_id: 'device-id' } },
          { device: { action: 'command_exec', connection_id: 'connection-id', command: 'pwd', args: [] } },
        ],
      },
      use: {
        description: 'Discover API endpoints or execute a Hermes Studio API endpoint.',
        docs: 'Omit use.path to read the compact OpenAPI catalog. Add use.tag or use.method to filter endpoint metadata.',
        request: 'Set use.path to execute an endpoint. Pass use.method, use.query, use.body, and use.headers as needed.',
        directTools: [
          'hermes_use_sessions_list',
          'hermes_use_sessions_count',
          'hermes_use_chat_run',
          'hermes_use_sessions_delete',
          'hermes_use_sessions_rename',
          'hermes_use_sessions_context',
          'hermes_use_available_models',
          'hermes_use_model_provider_find',
          'hermes_use_sessions_model_set',
          'hermes_use_config_model_set',
          'hermes_use_providers_create',
        ],
        examples: [
          { tool: 'hermes_use_sessions_list', arguments: { limit: 20 } },
          { tool: 'hermes_use_sessions_count', arguments: {} },
          {
            tool: 'hermes_use_chat_run',
            arguments: {
              input: 'Hello',
              agent: 'hermes',
              session_id: 'optional-existing-session-id',
              run_profile: 'default',
              source: 'cli',
              mode: 'chat',
              model: 'optional-model-id',
              provider: 'optional-provider-id',
              workspace: '/optional/workspace/path',
              include_events: true,
              timeout_ms: 300000,
            },
          },
          { tool: 'hermes_use_sessions_context', arguments: { id: 'session-id' } },
          { tool: 'hermes_use_sessions_rename', arguments: { id: 'session-id', title: 'New title' } },
          { tool: 'hermes_use_available_models', arguments: { model_profile: 'default' } },
          { tool: 'hermes_use_model_provider_find', arguments: { model: 'model-id', model_profile: 'default' } },
          { tool: 'hermes_use_sessions_model_set', arguments: { id: 'session-id', model: 'model-id', provider: 'provider-id' } },
          { tool: 'hermes_use_config_model_set', arguments: { model: 'model-id', provider: 'provider-id' } },
          {
            tool: 'hermes_use_providers_create',
            arguments: {
              name: 'Provider Name',
              base_url: 'https://api.example.com/v1',
              api_key: 'optional-api-key',
              model: 'model-id',
              providerKey: 'optional-builtin-provider-key',
              context_length: 128000,
              api_mode: 'chat_completions',
            },
          },
        ],
      },
      'api': {
        description: 'Source-specific toolset for the current Hermes Studio API catalog and OpenAPI-validated API requests.',
        tools: ['hermes_api_openapi_get', 'hermes_api_request'],
      },
    },
  }
}

const tools = [
  {
    name: 'hermes',
    description: 'Tiered Hermes Studio router. Use the device branch for LAN/device operations. Use the use branch for API discovery or API execution. If no branch is provided, returns a compact usage guide.',
    inputSchema: inputSchema({
      device: {
        type: 'object',
        description: 'LAN device operation branch. Set action to list, scan, connect, connections, disconnect, terminal_create, terminal_list, terminal_input, terminal_read, terminal_resize, terminal_close, command_exec, file_download, or file_upload. Other fields match the legacy hermes_lan_* tool arguments.',
        properties: {
          action: {
            type: 'string',
            enum: Object.keys(deviceActionToolNames),
          },
          device_id: { type: 'string' },
          connection_id: { type: 'string' },
          terminal_id: { type: 'string' },
          data: { type: 'string' },
          shell: { type: 'string' },
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          cwd: { type: 'string' },
          cols: { type: 'number' },
          rows: { type: 'number' },
          remote_path: { type: 'string' },
          local_path: { type: 'string' },
          timeout_ms: { type: 'number' },
          token: authArgumentProperties.token,
          profile: authArgumentProperties.profile,
        },
        additionalProperties: false,
      },
      use: {
        type: 'object',
        description: 'Hermes Studio API branch. Without path, returns the compact OpenAPI catalog. With path, executes the endpoint after OpenAPI validation.',
        properties: {
          path: {
            type: 'string',
            description: 'Endpoint path for execution, for example /api/hermes/sessions?limit=20. Omit to read the OpenAPI catalog.',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
          },
          tag: { type: 'string' },
          full: { type: 'boolean' },
          body: {
            type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
          },
          query: {
            type: 'object',
            additionalProperties: true,
          },
          headers: {
            type: 'object',
            additionalProperties: {
              type: ['string', 'number', 'boolean', 'array'],
            },
          },
          token: authArgumentProperties.token,
          profile: authArgumentProperties.profile,
        },
        additionalProperties: false,
      },
    }),
  },
  {
    name: 'hermes_api_openapi_get',
    description: 'Return the Hermes Studio API catalog as compact JSON. When the user asks about API docs, endpoint docs, API catalog, 接口文档, or 接口列表, call this tool without filters first to get the outline/module index. Without filters, returns only module purpose, keywords, and operation counts because the full API catalog is large. For endpoint details, call again with tag, path, or method filters, then use hermes_api_request.',
    inputSchema: inputSchema({
      path: {
        type: 'string',
        description: 'Optional exact endpoint path filter for on-demand details, for example /api/chat-run/runs.',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
        description: 'Optional HTTP method filter. Usually combine with path or tag.',
      },
      tag: {
        type: 'string',
        description: 'Optional module/tag filter. Recommended flow: call without filters to list modules, then call with one module tag for details.',
      },
      full: {
        type: 'boolean',
        description: 'Return the raw full OpenAPI JSON. Defaults to false; prefer compact JSON output for agent use.',
      },
    }),
  },
  {
    name: 'hermes_api_request',
    description: 'Execute a Hermes Studio API operation by calling an endpoint path. Use hermes_api_openapi_get first to inspect method, parameters, requestBody, and responses.',
    inputSchema: inputSchema({
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
        description: 'HTTP method. Defaults to GET.',
      },
      path: {
        type: 'string',
        description: 'Relative Hermes Studio endpoint path from the OpenAPI catalog, for example /api/hermes/sessions?limit=20. Full URLs and // paths are rejected.',
      },
      body: {
        type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
        description: 'Optional JSON request body for POST/PUT/PATCH/DELETE. GET and HEAD ignore body.',
      },
      query: {
        type: 'object',
        description: 'Optional query parameters merged into path. Values are serialized as strings; arrays append repeated parameters.',
        additionalProperties: true,
      },
      headers: {
        type: 'object',
        description: 'Optional request headers. Allowed names: accept, accept-language, content-type, x-request-id. Authorization and X-Hermes-Profile are filled from token/profile.',
        additionalProperties: {
          type: ['string', 'number', 'boolean', 'array'],
        },
      },
    }, ['path']),
  },
  {
    name: 'hermes_use_sessions_list',
    description: 'List Hermes Studio chat sessions through GET /api/hermes/sessions.',
    inputSchema: inputSchema({
      filter_profile: {
        type: 'string',
        description: 'Optional session profile filter. This is sent as the API query parameter profile; the top-level profile argument still controls MCP token/profile context.',
      },
      source: {
        type: 'string',
        description: 'Optional session source filter, for example global_agent. Omit to list visible Hermes Studio session sources.',
      },
      limit: {
        type: 'number',
        description: 'Optional maximum number of sessions to return. The API defaults to 2000 when omitted or invalid.',
      },
    }),
  },
  {
    name: 'hermes_use_sessions_count',
    description: 'Return the number of Hermes Studio chat sessions through GET /api/hermes/sessions/count.',
    inputSchema: inputSchema({
      filter_profile: {
        type: 'string',
        description: 'Optional session profile filter. This is sent as the API query parameter profile; the top-level profile argument still controls MCP token/profile context.',
      },
      source: {
        type: 'string',
        description: 'Optional session source filter, for example global_agent. Omit to count visible Hermes Studio session sources.',
      },
    }),
  },
  {
    name: 'hermes_use_chat_run',
    description: 'Start a new Hermes Studio chat run or continue an existing session through POST /api/chat-run/runs.',
    inputSchema: inputSchema({
      input: {
        type: 'string',
        description: 'User input for the run. Required by the run API.',
      },
      agent: {
        type: 'string',
        enum: ['hermes', 'claude-code', 'codex'],
        description: 'Run agent. hermes uses normal chat-run behavior. claude-code and codex are sent through this same endpoint with source=coding_agent and coding_agent_id set.',
      },
      session_id: {
        type: 'string',
        description: 'Optional existing session id. Omit to let the run API create a new session id.',
      },
      run_profile: {
        type: 'string',
        description: 'Optional profile sent in the run body. The top-level profile argument still controls MCP token/profile context.',
      },
      source: {
        type: 'string',
        enum: ['cli', 'coding_agent', 'global_agent'],
        description: 'Optional run source. cli uses the Hermes CLI/bridge chat runtime, coding_agent routes to the coding-agent runtime, and global_agent stores/runs the session as a global-agent session. Omit this for the API default.',
      },
      mode: {
        type: 'string',
        enum: ['scoped', 'global'],
        description: 'Optional coding-agent mode for claude-code/codex.',
      },
      model: { type: 'string' },
      provider: { type: 'string' },
      workspace: { type: 'string' },
      baseUrl: { type: 'string' },
      apiKey: { type: 'string' },
      apiMode: {
        type: 'string',
        enum: ['chat_completions', 'codex_responses', 'anthropic_messages', 'bedrock_converse', 'codex_app_server'],
        description: 'Optional coding-agent API mode for claude-code/codex scoped runs.',
      },
      session_source: {
        type: 'string',
        enum: ['global_agent'],
        description: 'Optional session source override for global-agent sessions.',
      },
      include_events: {
        type: 'boolean',
        description: 'Whether to include recorded run events in the response.',
      },
      timeout_ms: {
        type: 'number',
        description: 'Optional run timeout in milliseconds.',
      },
    }, ['input']),
  },
  {
    name: 'hermes_use_sessions_delete',
    description: 'Delete a Hermes Studio chat session through DELETE /api/hermes/sessions/:id.',
    inputSchema: inputSchema({
      id: {
        type: 'string',
        description: 'Session id to delete.',
      },
    }, ['id']),
  },
  {
    name: 'hermes_use_sessions_rename',
    description: 'Update a Hermes Studio chat session title through POST /api/hermes/sessions/:id/rename.',
    inputSchema: inputSchema({
      id: {
        type: 'string',
        description: 'Session id to rename.',
      },
      title: {
        type: 'string',
        description: 'New session title.',
      },
    }, ['id', 'title']),
  },
  {
    name: 'hermes_use_sessions_context',
    description: 'Get a Hermes Studio chat session context through GET /api/hermes/sessions/:id/context.',
    inputSchema: inputSchema({
      id: {
        type: 'string',
        description: 'Session id to read context for.',
      },
    }, ['id']),
  },
  {
    name: 'hermes_use_available_models',
    description: 'Return available Hermes Studio models and the current profile default provider/model through GET /api/hermes/available-models. Defaults to compact output to avoid huge model catalogs; set full=true only when the complete catalog is required.',
    inputSchema: inputSchema({
      model_profile: {
        type: 'string',
        description: 'Optional profile query for available models. Defaults to the top-level profile argument or HERMES_WEB_UI_PROFILE.',
      },
      provider: {
        type: 'string',
        description: 'Optional provider filter. When set, compact output includes only matching provider groups.',
      },
      full: {
        type: 'boolean',
        description: 'Return the full available-models response. Defaults to false because model catalogs can be very large.',
      },
    }),
  },
  {
    name: 'hermes_use_model_provider_find',
    description: 'Find provider candidates for one model id from GET /api/hermes/available-models without returning the full model catalog.',
    inputSchema: inputSchema({
      model: {
        type: 'string',
        description: 'Exact model id to look up.',
      },
      model_profile: {
        type: 'string',
        description: 'Optional profile query for available models. Defaults to the top-level profile argument or HERMES_WEB_UI_PROFILE.',
      },
    }, ['model']),
  },
  {
    name: 'hermes_use_sessions_model_set',
    description: 'Switch the model/provider for one Hermes Studio chat session through POST /api/hermes/sessions/:id/model.',
    inputSchema: inputSchema({
      id: {
        type: 'string',
        description: 'Session id whose model should be changed.',
      },
      model: {
        type: 'string',
        description: 'Model id to use for this session.',
      },
      provider: {
        type: 'string',
        description: 'Optional provider id for the model.',
      },
    }, ['id', 'model']),
  },
  {
    name: 'hermes_use_config_model_set',
    description: 'Switch the current Hermes profile default provider/model through PUT /api/hermes/config/model.',
    inputSchema: inputSchema({
      model: {
        type: 'string',
        description: 'Model id to set as the current profile default.',
      },
      provider: {
        type: 'string',
        description: 'Optional provider id for the model.',
      },
    }, ['model']),
  },
  {
    name: 'hermes_use_providers_create',
    description: 'Add or update a Hermes Studio provider through POST /api/hermes/config/providers.',
    inputSchema: inputSchema({
      name: {
        type: 'string',
        description: 'Provider display name. Custom providers are stored using a normalized name.',
      },
      base_url: {
        type: 'string',
        description: 'Provider base URL.',
      },
      api_key: {
        type: 'string',
        description: 'Provider API key. Some OAuth or direct-config providers do not require this.',
      },
      model: {
        type: 'string',
        description: 'Default model id for this provider.',
      },
      providerKey: {
        type: 'string',
        description: 'Optional builtin provider key, for example deepseek, openrouter, xai-oauth, openai-codex, google-gemini-cli, or claude-oauth. Omit for a custom provider.',
      },
      context_length: {
        type: 'number',
        description: 'Optional context length for this model.',
      },
      api_mode: {
        type: 'string',
        enum: ['chat_completions', 'codex_responses', 'anthropic_messages', 'bedrock_converse', 'codex_app_server'],
        description: 'Optional API mode for custom providers.',
      },
    }, ['name', 'base_url', 'model']),
  },
  {
    name: 'hermes_lan_devices_list',
    description: 'List known LAN and remote devices from Hermes Web UI, including pairing and online status.',
    inputSchema: inputSchema(),
  },
  {
    name: 'hermes_lan_devices_scan',
    description: 'Refresh LAN device discovery cache and return known devices with pairing and online status.',
    inputSchema: inputSchema(),
  },
  {
    name: 'hermes_lan_peer_connect',
    description: 'Connect to a paired LAN device by device id.',
    inputSchema: inputSchema({ device_id: { type: 'string' } }, ['device_id']),
  },
  {
    name: 'hermes_lan_peer_connections',
    description: 'List active LAN peer socket connections.',
    inputSchema: inputSchema(),
  },
  {
    name: 'hermes_lan_peer_disconnect',
    description: 'Disconnect an active LAN peer socket connection.',
    inputSchema: inputSchema({ connection_id: { type: 'string' } }, ['connection_id']),
  },
  {
    name: 'hermes_lan_terminal_create',
    description: 'Create an interactive terminal on a connected LAN peer.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
      shell: { type: 'string' },
      cols: { type: 'number' },
      rows: { type: 'number' },
    }, ['connection_id']),
  },
  {
    name: 'hermes_lan_terminal_list',
    description: 'List interactive terminals tracked for a connected LAN peer, including IDs that can be read or closed.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
    }, ['connection_id']),
  },
  {
    name: 'hermes_lan_terminal_input',
    description: 'Write input to an interactive terminal on a connected LAN peer.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
      terminal_id: { type: 'string' },
      data: { type: 'string' },
    }, ['connection_id', 'terminal_id', 'data']),
  },
  {
    name: 'hermes_lan_terminal_read',
    description: 'Read buffered terminal output from an interactive terminal.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
      terminal_id: { type: 'string' },
    }, ['connection_id', 'terminal_id']),
  },
  {
    name: 'hermes_lan_terminal_resize',
    description: 'Resize an interactive terminal on a connected LAN peer.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
      terminal_id: { type: 'string' },
      cols: { type: 'number' },
      rows: { type: 'number' },
    }, ['connection_id', 'terminal_id', 'cols', 'rows']),
  },
  {
    name: 'hermes_lan_terminal_close',
    description: 'Close an interactive terminal on a connected LAN peer.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
      terminal_id: { type: 'string' },
    }, ['connection_id', 'terminal_id']),
  },
  {
    name: 'hermes_lan_command_exec',
    description: 'Run a command on a connected LAN peer using command plus args, without shell string execution.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
      command: { type: 'string' },
      args: { type: 'array', items: { type: 'string' } },
      cwd: { type: 'string' },
      timeout_ms: { type: 'number' },
    }, ['connection_id', 'command']),
  },
  {
    name: 'hermes_lan_file_download',
    description: 'Download a file from a connected LAN peer remote path to a local path on this machine.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
      remote_path: { type: 'string' },
      local_path: { type: 'string' },
      timeout_ms: { type: 'number' },
    }, ['connection_id', 'remote_path', 'local_path']),
  },
  {
    name: 'hermes_lan_file_upload',
    description: 'Upload a local file path from this machine to a connected LAN peer remote path.',
    inputSchema: inputSchema({
      connection_id: { type: 'string' },
      local_path: { type: 'string' },
      remote_path: { type: 'string' },
      timeout_ms: { type: 'number' },
    }, ['connection_id', 'local_path', 'remote_path']),
  },
]

function toolsetForToolName(name) {
  if (name === 'hermes') return 'all'
  if (name.startsWith('hermes_use_')) return 'use'
  if (name === 'hermes_api_openapi_get') return 'api'
  if (name === 'hermes_api_request') return 'api'
  if (name.startsWith('hermes_lan_')) return 'device'
  return 'all'
}

function activeTools() {
  if (MCP_TOOLSET === 'all') return tools
  return tools.filter(tool => toolsetForToolName(tool.name) === MCP_TOOLSET)
}

function activeToolNames() {
  return new Set(activeTools().map(tool => tool.name))
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'hermes': {
      const hasDevice = args.device !== undefined
      const hasUse = args.use !== undefined
      if (hasDevice && hasUse) return errorText('Pass only one hermes branch at a time: device or use.')
      if (MCP_TOOLSET === 'use' && hasDevice) return errorText('The use toolset only accepts the hermes use branch.')
      if (hasDevice) {
        if (!isRecord(args.device)) return errorText('hermes device branch must be an object with an action field.')
        const action = String(args.device.action || '').trim()
        const toolName = deviceActionToolNames[action]
        if (!toolName) return errorText(`Unknown device action: ${action || '(missing)'}. Allowed: ${Object.keys(deviceActionToolNames).join(', ')}.`)
        return callTool(toolName, routedAuthArgs(args, args.device))
      }
      if (hasUse) {
        if (!isRecord(args.use)) return errorText('hermes use branch must be an object.')
        const useArgs = routedAuthArgs(args, args.use)
        return callTool(useArgs.path ? 'hermes_api_request' : 'hermes_api_openapi_get', useArgs)
      }
      return jsonText(hermesRouterGuide())
    }
    case 'hermes_api_openapi_get':
      return jsonText(compactOpenApiDocument(await openApiDocument(withAuthArgs(args)), args))
    case 'hermes_api_request': {
      const method = normalizeApiMethod(args.method)
      const path = normalizeApiPath(args.path)
      if (!method) return errorText('Invalid method. Allowed: GET, POST, PUT, PATCH, DELETE, HEAD.')
      if (!path) return errorText('Invalid path. Use a relative /api/... or /health path from hermes_api_openapi_get; full URLs are not allowed.')
      const validationError = await validateApiRequest(method, path, args)
      if (validationError) return errorText(`Invalid API request for ${method} ${pathWithoutQuery(path)}: ${validationError}. Use hermes_api_openapi_get to inspect required parameters and requestBody.`)
      const options = withAuthArgs(args, {
        method,
        query: args.query,
        headers: args.headers,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: args.body }),
      })
      return jsonText(await requestEnvelope(path, options))
    }
    case 'hermes_use_sessions_list':
      return jsonText(await requestEnvelope('/api/hermes/sessions', withAuthArgs(args, {
        method: 'GET',
        query: {
          ...(args.filter_profile ? { profile: args.filter_profile } : {}),
          ...(args.source ? { source: args.source } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
        },
      })))
    case 'hermes_use_sessions_count':
      return jsonText(await requestEnvelope('/api/hermes/sessions/count', withAuthArgs(args, {
        method: 'GET',
        query: {
          ...(args.filter_profile ? { profile: args.filter_profile } : {}),
          ...(args.source ? { source: args.source } : {}),
        },
      })))
    case 'hermes_use_chat_run': {
      const agent = args.agent === 'claude-code' || args.agent === 'codex' ? args.agent : 'hermes'
      return jsonText(await requestEnvelope('/api/chat-run/runs', withAuthArgs(args, {
        method: 'POST',
        body: {
          input: args.input,
          ...(args.session_id ? { session_id: args.session_id } : {}),
          ...(args.run_profile ? { profile: args.run_profile } : {}),
          ...(agent === 'hermes' && args.source ? { source: args.source } : {}),
          ...(agent !== 'hermes' ? { source: 'coding_agent', coding_agent_id: agent } : {}),
          ...(args.mode ? { mode: args.mode } : {}),
          ...(args.model !== undefined ? { model: args.model } : {}),
          ...(args.provider !== undefined ? { provider: args.provider } : {}),
          ...(args.workspace !== undefined ? { workspace: args.workspace } : {}),
          ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
          ...(args.apiKey !== undefined ? { apiKey: args.apiKey } : {}),
          ...(args.apiMode !== undefined ? { apiMode: args.apiMode } : {}),
          ...(args.session_source !== undefined ? { session_source: args.session_source } : {}),
          ...(args.include_events !== undefined ? { include_events: args.include_events } : {}),
          ...(args.timeout_ms !== undefined ? { timeout_ms: args.timeout_ms } : {}),
        },
      })))
    }
    case 'hermes_use_sessions_delete':
      return jsonText(await requestEnvelope(`/api/hermes/sessions/${encodeURIComponent(args.id)}`, withAuthArgs(args, {
        method: 'DELETE',
      })))
    case 'hermes_use_sessions_rename':
      return jsonText(await requestEnvelope(`/api/hermes/sessions/${encodeURIComponent(args.id)}/rename`, withAuthArgs(args, {
        method: 'POST',
        body: { title: args.title },
      })))
    case 'hermes_use_sessions_context':
      return jsonText(await requestEnvelope(`/api/hermes/sessions/${encodeURIComponent(args.id)}/context`, withAuthArgs(args, {
        method: 'GET',
      })))
    case 'hermes_use_available_models': {
      const modelProfile = String(args.model_profile || args.profile || defaultProfile() || '').trim()
      const envelope = await requestEnvelope('/api/hermes/available-models', withAuthArgs(args, {
        method: 'GET',
        query: modelProfile ? { profile: modelProfile } : {},
      }))
      return jsonText(args.full === true ? envelope : compactAvailableModels(envelope, args))
    }
    case 'hermes_use_model_provider_find': {
      const modelProfile = String(args.model_profile || args.profile || defaultProfile() || '').trim()
      const envelope = await requestEnvelope('/api/hermes/available-models', withAuthArgs(args, {
        method: 'GET',
        query: modelProfile ? { profile: modelProfile } : {},
      }))
      return jsonText(findModelProviders(envelope, {
        ...args,
        ...(modelProfile ? { model_profile: modelProfile } : {}),
      }))
    }
    case 'hermes_use_sessions_model_set':
      return jsonText(await requestEnvelope(`/api/hermes/sessions/${encodeURIComponent(args.id)}/model`, withAuthArgs(args, {
        method: 'POST',
        body: {
          model: args.model,
          ...(args.provider !== undefined ? { provider: args.provider } : {}),
        },
      })))
    case 'hermes_use_config_model_set':
      return jsonText(await requestEnvelope('/api/hermes/config/model', withAuthArgs(args, {
        method: 'PUT',
        body: {
          default: args.model,
          ...(args.provider !== undefined ? { provider: args.provider } : {}),
        },
      })))
    case 'hermes_use_providers_create':
      return jsonText(await requestEnvelope('/api/hermes/config/providers', withAuthArgs(args, {
        method: 'POST',
        body: {
          name: args.name,
          base_url: args.base_url,
          ...(args.api_key !== undefined ? { api_key: args.api_key } : {}),
          model: args.model,
          ...(args.providerKey !== undefined ? { providerKey: args.providerKey } : {}),
          ...(args.context_length !== undefined ? { context_length: args.context_length } : {}),
          ...(args.api_mode !== undefined ? { api_mode: args.api_mode } : {}),
        },
      })))
    case 'hermes_lan_devices_list':
      return jsonText(await request('/api/devices', withAuthArgs(args)))
    case 'hermes_lan_devices_scan':
      return jsonText(await request('/api/devices/scan', withAuthArgs(args, { method: 'POST' })))
    case 'hermes_lan_peer_connect':
      return jsonText(await request(`/api/devices/${encodeURIComponent(args.device_id)}/connect`, withAuthArgs(args, { method: 'POST' })))
    case 'hermes_lan_peer_connections':
      return jsonText(await request('/api/devices/peer-connections', withAuthArgs(args)))
    case 'hermes_lan_peer_disconnect':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/disconnect`, withAuthArgs(args, { method: 'POST' })))
    case 'hermes_lan_terminal_create':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal`, withAuthArgs(args, {
        method: 'POST',
        body: { shell: args.shell, cols: args.cols, rows: args.rows },
      })))
    case 'hermes_lan_terminal_list':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminals`, withAuthArgs(args)))
    case 'hermes_lan_terminal_input':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal/${encodeURIComponent(args.terminal_id)}/input`, withAuthArgs(args, {
        method: 'POST',
        body: { data: args.data },
      })))
    case 'hermes_lan_terminal_read':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal/${encodeURIComponent(args.terminal_id)}/read`, withAuthArgs(args)))
    case 'hermes_lan_terminal_resize':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal/${encodeURIComponent(args.terminal_id)}/resize`, withAuthArgs(args, {
        method: 'POST',
        body: { cols: args.cols, rows: args.rows },
      })))
    case 'hermes_lan_terminal_close':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal/${encodeURIComponent(args.terminal_id)}/close`, withAuthArgs(args, { method: 'POST' })))
    case 'hermes_lan_command_exec':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/exec`, withAuthArgs(args, {
        method: 'POST',
        body: { command: args.command, args: args.args || [], cwd: args.cwd, timeout_ms: args.timeout_ms },
      })))
    case 'hermes_lan_file_download':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/download`, withAuthArgs(args, {
        method: 'POST',
        body: { remote_path: args.remote_path, local_path: args.local_path, timeout_ms: args.timeout_ms },
      })))
    case 'hermes_lan_file_upload':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/upload`, withAuthArgs(args, {
        method: 'POST',
        body: { local_path: args.local_path, remote_path: args.remote_path, timeout_ms: args.timeout_ms },
      })))
    default:
      return errorText(`Unknown tool: ${name}`)
  }
}

async function handle(message) {
  if (!message || message.id === undefined) return null

  try {
    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion || '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: VERSION },
          },
        }
      case 'tools/list':
        return { jsonrpc: '2.0', id: message.id, result: { tools: activeTools() } }
      case 'tools/call':
        if (!activeToolNames().has(message.params?.name)) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: errorText(`Tool ${message.params?.name || '(missing)'} is not available in ${MCP_TOOLSET} toolset.`),
          }
        }
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: await callTool(message.params?.name, message.params?.arguments || {}),
        }
      default:
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        }
    }
  } catch (err) {
    return { jsonrpc: '2.0', id: message.id, result: errorText(err?.message || String(err)) }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async line => {
  const text = line.trim()
  if (!text) return
  let message
  try {
    message = JSON.parse(text)
  } catch {
    return
  }
  const response = await handle(message)
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
})
