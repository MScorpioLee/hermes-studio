import { createServer } from 'http'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import pkg from '../../package.json'

function writeRpc(child: ChildProcessWithoutNullStreams, id: number, method: string, params?: unknown) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
}

function waitForRpc(responses: Map<number, any>, id: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (responses.has(id)) {
        clearInterval(timer)
        resolve(responses.get(id))
        return
      }
      if (Date.now() - started > 5000) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for MCP response ${id}`))
      }
    }, 10)
  })
}

describe('hermes-web-ui MCP server', () => {
  let child: ChildProcessWithoutNullStreams | null = null
  const homes: string[] = []

  afterEach(() => {
    child?.kill()
    child = null
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  })

  it('exposes a public Hermes Studio API requester tool', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hermes-studio-mcp-'))
    homes.push(home)
    mkdirSync(join(home, 'profiles', 'research'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'research', '.model-run-token'), 'profile-token\n')
    let chatRunHits = 0
    let deviceScanHits = 0
    let sessionListHits = 0

    const server = createServer((req, res) => {
      if (req.url === '/api/openapi.json') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          openapi: '3.0.3',
          tags: [
            { name: 'Chat Run', description: 'Chat run operations' },
            { name: 'Testing', description: 'Test helper operations' },
          ],
          paths: {
            '/api/test-public-requester': {
              post: {
                tags: ['Testing'],
                requestBody: {
                  required: false,
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                      },
                    },
                  },
                },
              },
            },
            '/api/chat-run/runs': {
              post: {
                tags: ['Chat Run'],
                requestBody: {
                  required: true,
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['input'],
                        properties: {
                          input: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          authorization: req.headers.authorization || '',
          profile: req.headers['x-hermes-profile'] || '',
        }))
        return
      }
      if (req.url?.startsWith('/api/test-public-requester')) {
        let raw = ''
        req.on('data', chunk => { raw += chunk })
        req.on('end', () => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({
            method: req.method,
            url: req.url,
            body: raw ? JSON.parse(raw) : null,
            profile: req.headers['x-hermes-profile'],
            authorization: req.headers.authorization,
          }))
        })
        return
      }
      if (req.url === '/api/devices/scan') {
        deviceScanHits += 1
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          scanning: false,
          devices: [{ id: 'peer-1', online: true }],
          profile: req.headers['x-hermes-profile'],
          authorization: req.headers.authorization,
        }))
        return
      }
      if (req.url?.startsWith('/api/hermes/sessions/count')) {
        sessionListHits += 1
        const url = new URL(req.url, 'http://127.0.0.1')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          count: 1,
          query: Object.fromEntries(url.searchParams.entries()),
          profile: req.headers['x-hermes-profile'],
          authorization: req.headers.authorization,
        }))
        return
      }
      if (req.method === 'DELETE' && req.url === '/api/hermes/sessions/session-1') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          ok: true,
          deleted: true,
          profile: req.headers['x-hermes-profile'],
          authorization: req.headers.authorization,
        }))
        return
      }
      if (req.method === 'POST' && req.url === '/api/hermes/sessions/session-1/rename') {
        let raw = ''
        req.on('data', chunk => { raw += String(chunk) })
        req.on('end', () => {
          const body = JSON.parse(raw || '{}')
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({
            ok: true,
            title: body.title,
            profile: req.headers['x-hermes-profile'],
            authorization: req.headers.authorization,
          }))
        })
        return
      }
      if (req.method === 'GET' && req.url === '/api/hermes/sessions/session-1/context') {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          session_id: 'session-1',
          messages: [{ role: 'user', content: 'hello' }],
          profile: req.headers['x-hermes-profile'],
          authorization: req.headers.authorization,
        }))
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/api/hermes/available-models')) {
        const url = new URL(req.url, 'http://127.0.0.1')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          default: 'gpt-test',
          default_provider: 'openai',
          groups: [
            {
              provider: 'openai',
              label: 'OpenAI',
              api_mode: 'chat_completions',
              models: Array.from({ length: 20 }, (_, index) => `gpt-model-${index + 1}`),
              model_meta: { 'gpt-model-1': { alias: 'GPT Model 1' } },
            },
            {
              provider: 'claude-oauth',
              label: 'Claude OAuth',
              models: ['claude-sonnet-4-6'],
            },
          ],
          profiles: [{ profile: url.searchParams.get('profile') || 'research', default: 'gpt-test', default_provider: 'openai' }],
          profile: req.headers['x-hermes-profile'],
          authorization: req.headers.authorization,
        }))
        return
      }
      if (req.method === 'POST' && req.url === '/api/hermes/sessions/session-1/model') {
        let raw = ''
        req.on('data', chunk => { raw += String(chunk) })
        req.on('end', () => {
          const body = JSON.parse(raw || '{}')
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({
            ok: true,
            model: body.model,
            provider: body.provider,
            profile: req.headers['x-hermes-profile'],
            authorization: req.headers.authorization,
          }))
        })
        return
      }
      if (req.method === 'PUT' && req.url === '/api/hermes/config/model') {
        let raw = ''
        req.on('data', chunk => { raw += String(chunk) })
        req.on('end', () => {
          const body = JSON.parse(raw || '{}')
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({
            success: true,
            default: body.default,
            provider: body.provider,
            profile: req.headers['x-hermes-profile'],
            authorization: req.headers.authorization,
          }))
        })
        return
      }
      if (req.method === 'POST' && req.url === '/api/hermes/config/providers') {
        let raw = ''
        req.on('data', chunk => { raw += String(chunk) })
        req.on('end', () => {
          const body = JSON.parse(raw || '{}')
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({
            success: true,
            provider: body,
            profile: req.headers['x-hermes-profile'],
            authorization: req.headers.authorization,
          }))
        })
        return
      }
      if (req.url?.startsWith('/api/hermes/sessions')) {
        sessionListHits += 1
        const url = new URL(req.url, 'http://127.0.0.1')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          sessions: [{ id: 'session-1', title: 'Research session' }],
          query: Object.fromEntries(url.searchParams.entries()),
          profile: req.headers['x-hermes-profile'],
          authorization: req.headers.authorization,
        }))
        return
      }
      if (req.url === '/api/chat-run/runs') {
        chatRunHits += 1
        let raw = ''
        req.on('data', chunk => { raw += chunk })
        req.on('end', () => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({
            ok: true,
            body: raw ? JSON.parse(raw) : null,
          }))
        })
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected TCP server address')

    const responses = new Map<number, any>()
    child = spawn(process.execPath, ['bin/hermes-studio-mcp.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERMES_WEB_UI_URL: `http://127.0.0.1:${address.port}`,
        HERMES_WEB_UI_HOME: home,
        HERMES_WEB_UI_PROFILE: 'research',
      },
    })
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line)
        responses.set(message.id, message)
      }
    })

    writeRpc(child, 1, 'initialize', {})
    writeRpc(child, 2, 'tools/list')
    writeRpc(child, 3, 'tools/call', {
      name: 'hermes_api_request',
      arguments: {
        method: 'POST',
        path: '/api/test-public-requester',
        query: { q: 'hello' },
        body: { ok: true },
      },
    })
    writeRpc(child, 4, 'resources/list')
    writeRpc(child, 5, 'tools/call', {
      name: 'hermes_api_request',
      arguments: {
        method: 'POST',
        path: '/api/chat-run/runs',
        body: {},
      },
    })
    writeRpc(child, 7, 'tools/call', {
      name: 'hermes_api_openapi_get',
      arguments: {
        path: '/api/chat-run/runs',
        method: 'POST',
      },
    })
    writeRpc(child, 9, 'tools/call', {
      name: 'hermes_api_openapi_get',
      arguments: {},
    })

    const initialized = await waitForRpc(responses, 1)
    expect(initialized.result.serverInfo).toMatchObject({
      name: 'hermes-studio-mcp',
      version: pkg.version,
    })
    expect(initialized.result.capabilities).toEqual({ tools: {} })

    const list = await waitForRpc(responses, 2)
    expect(list.result.tools.some((tool: any) => tool.name === 'hermes')).toBe(true)
    expect(list.result.tools.some((tool: any) => tool.name === 'hermes_api_request')).toBe(true)

    const response = await waitForRpc(responses, 3)
    const payload = JSON.parse(response.result.content[0].text)
    expect(payload.status).toBe(200)
    expect(payload.body).toMatchObject({
      method: 'POST',
      url: '/api/test-public-requester?q=hello',
      body: { ok: true },
      profile: 'research',
      authorization: 'Bearer profile-token',
    })
    writeRpc(child, 8, 'tools/call', {
      name: 'hermes_api_openapi_get',
      arguments: {
        path: '/api/test-public-requester',
        method: 'POST',
      },
    })

    const resource = await waitForRpc(responses, 4)
    expect(resource.error).toMatchObject({
      code: -32601,
      message: 'Method not found: resources/list',
    })

    const invalid = await waitForRpc(responses, 5)
    expect(invalid.result.isError).toBe(true)
    expect(invalid.result.content[0].text).toContain('missing required field body.input')
    expect(chatRunHits).toBe(0)

    const compactManual = await waitForRpc(responses, 7)
    const compactPayload = JSON.parse(compactManual.result.content[0].text)
    expect(compactPayload).toMatchObject({
      moduleCount: 2,
      operationCount: 1,
      operations: [{
        method: 'POST',
        path: '/api/chat-run/runs',
        requestBody: {
          fields: [
            { name: 'input', required: true, type: 'string' },
          ],
        },
      }],
    })
    expect(compactPayload.paths).toBeUndefined()

    const moduleManual = await waitForRpc(responses, 9)
    const modulePayload = JSON.parse(moduleManual.result.content[0].text)
    expect(modulePayload).toMatchObject({
      moduleCount: 2,
      operationCount: 2,
      operationsOmitted: true,
      modules: expect.arrayContaining([
        {
          tag: 'Chat Run',
          operationCount: 1,
          purpose: 'Start a chat or coding-agent run through the HTTP bridge and wait for the result.',
          keywords: expect.arrayContaining(['chat', 'run']),
          description: 'Chat run operations',
        },
        { tag: 'Testing', operationCount: 1, description: 'Test helper operations' },
      ]),
    })
    expect(modulePayload.operations).toBeUndefined()

    const optionalManual = await waitForRpc(responses, 8)
    const optionalPayload = JSON.parse(optionalManual.result.content[0].text)
    expect(optionalPayload.operations[0]).toMatchObject({
      method: 'POST',
      path: '/api/test-public-requester',
      requestBody: { required: false, fields: [] },
    })

    writeRpc(child, 6, 'tools/call', {
      name: 'hermes_api_request',
      arguments: {
        method: 'POST',
        path: '/api/chat-run/runs',
        body: { input: 'hello' },
      },
    })
    const valid = await waitForRpc(responses, 6)
    const validPayload = JSON.parse(valid.result.content[0].text)
    expect(validPayload.status).toBe(200)
    expect(validPayload.body.body).toEqual({ input: 'hello' })
    expect(chatRunHits).toBe(1)

    writeRpc(child, 10, 'tools/call', {
      name: 'hermes',
      arguments: {
        use: {
          method: 'POST',
          path: '/api/test-public-requester',
          query: { q: 'tiered' },
          body: { routed: true },
        },
      },
    })
    const routedApi = await waitForRpc(responses, 10)
    const routedApiPayload = JSON.parse(routedApi.result.content[0].text)
    expect(routedApiPayload.status).toBe(200)
    expect(routedApiPayload.body).toMatchObject({
      method: 'POST',
      url: '/api/test-public-requester?q=tiered',
      body: { routed: true },
      profile: 'research',
      authorization: 'Bearer profile-token',
    })

    writeRpc(child, 11, 'tools/call', {
      name: 'hermes',
      arguments: {
        device: { action: 'scan' },
      },
    })
    const routedDevice = await waitForRpc(responses, 11)
    const routedDevicePayload = JSON.parse(routedDevice.result.content[0].text)
    expect(routedDevicePayload).toMatchObject({
      scanning: false,
      devices: [{ id: 'peer-1', online: true }],
      profile: 'research',
      authorization: 'Bearer profile-token',
    })
    expect(deviceScanHits).toBe(1)

    writeRpc(child, 12, 'tools/call', {
      name: 'hermes_use_sessions_list',
      arguments: {
        profile: 'research',
        filter_profile: 'research',
        source: 'coding_agent',
        limit: 2,
      },
    })
    const sessionList = await waitForRpc(responses, 12)
    const sessionListPayload = JSON.parse(sessionList.result.content[0].text)
    expect(sessionListPayload).toMatchObject({
      status: 200,
      body: {
        sessions: [{ id: 'session-1', title: 'Research session' }],
        query: { profile: 'research', source: 'coding_agent', limit: '2' },
        profile: 'research',
        authorization: 'Bearer profile-token',
      },
    })
    expect(sessionListHits).toBe(1)

    writeRpc(child, 13, 'tools/call', {
      name: 'hermes_use_sessions_count',
      arguments: {
        profile: 'research',
        filter_profile: 'research',
        source: 'coding_agent',
      },
    })
    const sessionCount = await waitForRpc(responses, 13)
    const sessionCountPayload = JSON.parse(sessionCount.result.content[0].text)
    expect(sessionCountPayload).toMatchObject({
      status: 200,
      body: {
        count: 1,
        query: { profile: 'research', source: 'coding_agent' },
        profile: 'research',
        authorization: 'Bearer profile-token',
      },
    })
    expect(sessionListHits).toBe(2)

    writeRpc(child, 14, 'tools/call', {
      name: 'hermes_use_chat_run',
      arguments: {
        profile: 'research',
        run_profile: 'research',
        agent: 'hermes',
        session_id: 'session-1',
        input: 'Continue this session',
        include_events: true,
      },
    })
    const chatRun = await waitForRpc(responses, 14)
    const chatRunPayload = JSON.parse(chatRun.result.content[0].text)
    expect(chatRunPayload).toMatchObject({
      status: 200,
      body: {
        ok: true,
        body: {
          input: 'Continue this session',
          session_id: 'session-1',
          profile: 'research',
          include_events: true,
        },
      },
    })

    writeRpc(child, 15, 'tools/call', {
      name: 'hermes_use_chat_run',
      arguments: {
        profile: 'research',
        agent: 'codex',
        session_id: 'session-1',
        input: 'Ask Codex',
        mode: 'global',
        model: 'gpt-5-codex',
      },
    })
    const codingAgentRun = await waitForRpc(responses, 15)
    const codingAgentRunPayload = JSON.parse(codingAgentRun.result.content[0].text)
    expect(codingAgentRunPayload).toMatchObject({
      status: 200,
      body: {
        ok: true,
        body: {
          input: 'Ask Codex',
          session_id: 'session-1',
          source: 'coding_agent',
          coding_agent_id: 'codex',
          mode: 'global',
          model: 'gpt-5-codex',
        },
      },
    })

    writeRpc(child, 16, 'tools/call', {
      name: 'hermes_use_sessions_rename',
      arguments: {
        profile: 'research',
        id: 'session-1',
        title: 'Renamed session',
      },
    })
    const sessionRename = await waitForRpc(responses, 16)
    const sessionRenamePayload = JSON.parse(sessionRename.result.content[0].text)
    expect(sessionRenamePayload).toMatchObject({
      status: 200,
      body: {
        ok: true,
        title: 'Renamed session',
        profile: 'research',
        authorization: 'Bearer profile-token',
      },
    })

    writeRpc(child, 17, 'tools/call', {
      name: 'hermes_use_sessions_delete',
      arguments: {
        profile: 'research',
        id: 'session-1',
      },
    })
    const sessionDelete = await waitForRpc(responses, 17)
    const sessionDeletePayload = JSON.parse(sessionDelete.result.content[0].text)
    expect(sessionDeletePayload).toMatchObject({
      status: 200,
      body: {
        ok: true,
        deleted: true,
        profile: 'research',
        authorization: 'Bearer profile-token',
      },
    })

    writeRpc(child, 18, 'tools/call', {
      name: 'hermes_use_sessions_context',
      arguments: {
        profile: 'research',
        id: 'session-1',
      },
    })
    const sessionContext = await waitForRpc(responses, 18)
    const sessionContextPayload = JSON.parse(sessionContext.result.content[0].text)
    expect(sessionContextPayload).toMatchObject({
      status: 200,
      body: {
        session_id: 'session-1',
        messages: [{ role: 'user', content: 'hello' }],
        profile: 'research',
        authorization: 'Bearer profile-token',
      },
    })

    writeRpc(child, 19, 'tools/call', {
      name: 'hermes_use_available_models',
      arguments: {
        profile: 'research',
        model_profile: 'research',
      },
    })
    const availableModels = await waitForRpc(responses, 19)
    const availableModelsPayload = JSON.parse(availableModels.result.content[0].text)
    expect(availableModelsPayload).toMatchObject({
      status: 200,
      default: 'gpt-test',
      default_provider: 'openai',
      provider_count: 2,
      groups: [
        {
          provider: 'openai',
          label: 'OpenAI',
          api_mode: 'chat_completions',
          model_count: 20,
          models_preview: Array.from({ length: 10 }, (_, index) => `gpt-model-${index + 1}`),
          truncated: true,
        },
        {
          provider: 'claude-oauth',
          label: 'Claude OAuth',
          model_count: 1,
          models_preview: ['claude-sonnet-4-6'],
          truncated: false,
        },
      ],
      profiles: [{ profile: 'research', default: 'gpt-test', default_provider: 'openai' }],
      compact: true,
    })

    writeRpc(child, 23, 'tools/call', {
      name: 'hermes_use_model_provider_find',
      arguments: {
        profile: 'research',
        model_profile: 'research',
        model: 'claude-sonnet-4-6',
      },
    })
    const modelProvider = await waitForRpc(responses, 23)
    const modelProviderPayload = JSON.parse(modelProvider.result.content[0].text)
    expect(modelProviderPayload).toMatchObject({
      status: 200,
      model: 'claude-sonnet-4-6',
      provider: 'claude-oauth',
      provider_count: 1,
      matches: [
        {
          provider: 'claude-oauth',
          label: 'Claude OAuth',
          model: 'claude-sonnet-4-6',
        },
      ],
      profile: 'research',
      found: true,
    })
    expect(modelProviderPayload.groups).toBeUndefined()

    writeRpc(child, 20, 'tools/call', {
      name: 'hermes_use_sessions_model_set',
      arguments: {
        profile: 'research',
        id: 'session-1',
        model: 'gpt-test',
        provider: 'openai',
      },
    })
    const sessionModel = await waitForRpc(responses, 20)
    const sessionModelPayload = JSON.parse(sessionModel.result.content[0].text)
    expect(sessionModelPayload).toMatchObject({
      status: 200,
      body: {
        ok: true,
        model: 'gpt-test',
        provider: 'openai',
        profile: 'research',
        authorization: 'Bearer profile-token',
      },
    })

    writeRpc(child, 21, 'tools/call', {
      name: 'hermes_use_config_model_set',
      arguments: {
        profile: 'research',
        model: 'gpt-test',
        provider: 'openai',
      },
    })
    const configModel = await waitForRpc(responses, 21)
    const configModelPayload = JSON.parse(configModel.result.content[0].text)
    expect(configModelPayload).toMatchObject({
      status: 200,
      body: {
        success: true,
        default: 'gpt-test',
        provider: 'openai',
        profile: 'research',
        authorization: 'Bearer profile-token',
      },
    })

    writeRpc(child, 22, 'tools/call', {
      name: 'hermes_use_providers_create',
      arguments: {
        profile: 'research',
        name: 'Research Proxy',
        base_url: 'https://research.invalid/v1',
        api_key: 'research-key',
        model: 'research-model',
        providerKey: 'deepseek',
        context_length: 128000,
        api_mode: 'chat_completions',
      },
    })
    const providerCreate = await waitForRpc(responses, 22)
    const providerCreatePayload = JSON.parse(providerCreate.result.content[0].text)
    expect(providerCreatePayload).toMatchObject({
      status: 200,
      body: {
        success: true,
        provider: {
          name: 'Research Proxy',
          base_url: 'https://research.invalid/v1',
          api_key: 'research-key',
          model: 'research-model',
          providerKey: 'deepseek',
          context_length: 128000,
          api_mode: 'chat_completions',
        },
        profile: 'research',
        authorization: 'Bearer profile-token',
      },
    })

    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('filters tool exposure from the MCP server source name', async () => {
    const responses = new Map<number, any>()
    child = spawn(process.execPath, ['bin/hermes-studio-mcp.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERMES_MCP_SERVER_NAME: 'hermes-studio-api',
      },
    })
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line)
        responses.set(message.id, message)
      }
    })

    writeRpc(child, 1, 'initialize', {})
    writeRpc(child, 2, 'tools/list')
    writeRpc(child, 3, 'tools/call', {
      name: 'hermes_lan_devices_scan',
      arguments: {},
    })

    const initialized = await waitForRpc(responses, 1)
    expect(initialized.result.serverInfo.name).toBe('hermes-studio-api')

    const apiList = await waitForRpc(responses, 2)
    const apiToolNames = apiList.result.tools.map((tool: any) => tool.name)
    expect(apiToolNames).toContain('hermes_api_request')
    expect(apiToolNames).toContain('hermes_api_openapi_get')
    expect(apiToolNames).not.toContain('hermes')
    expect(apiToolNames).not.toContain('hermes_lan_devices_scan')

    const hiddenDeviceTool = await waitForRpc(responses, 3)
    expect(hiddenDeviceTool.result.isError).toBe(true)
    expect(hiddenDeviceTool.result.content[0].text).toContain('not available in api toolset')

    child.kill()
    child = null

    const useResponses = new Map<number, any>()
    child = spawn(process.execPath, ['bin/hermes-studio-mcp.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERMES_MCP_SERVER_NAME: 'hermes-studio-use',
      },
    })
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line)
        useResponses.set(message.id, message)
      }
    })

    writeRpc(child, 4, 'tools/list')
    const useList = await waitForRpc(useResponses, 4)
    const useToolNames = useList.result.tools.map((tool: any) => tool.name)
    expect(useToolNames).toEqual([
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
    ])

    child.kill()
    child = null

    const deviceResponses = new Map<number, any>()
    child = spawn(process.execPath, ['bin/hermes-studio-mcp.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERMES_MCP_SERVER_NAME: 'hermes-studio-device',
      },
    })
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line)
        deviceResponses.set(message.id, message)
      }
    })

    writeRpc(child, 5, 'tools/list')
    const deviceList = await waitForRpc(deviceResponses, 5)
    const deviceToolNames = deviceList.result.tools.map((tool: any) => tool.name)
    expect(deviceToolNames).toContain('hermes_lan_devices_scan')
    expect(deviceToolNames).not.toContain('hermes')
    expect(deviceToolNames).not.toContain('hermes_api_request')
  })

  it('reports the package version from the CLI', async () => {
    const child = spawn(process.execPath, ['bin/hermes-studio-mcp.mjs', '--version'], {
      cwd: process.cwd(),
      env: process.env,
    })
    let stdout = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))

    expect(code).toBe(0)
    expect(stdout.trim()).toBe(`hermes-studio-mcp v${pkg.version}`)
  })
})
