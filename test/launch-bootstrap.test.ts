/**
 * 桌面应用冷启动跳板：只认名单里的 Tailscale 用户 + 跨站顶层网页跳转，其余一律放行到下一环。
 *
 * 这里不拉真的 HTTP 服务器：决策只读 `IncomingMessage` 的几个头与 `ServerResponse` 的写出，
 * 用最小假件就能把每种形状钉住。真实的浏览器行为（meta refresh 之后是 same-origin）与整条链路
 * 由 docs/development.md 里的手动验证覆盖。
 *
 * @module dsh-tailnet-admin/test/launch-bootstrap
 */

import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { test } from 'node:test'

import { handleLaunchBootstrap } from '../src/launch-bootstrap.ts'
import { asPluginConfig, createConfig } from './helpers.ts'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

/** 跳板页写出的结果。 */
interface ResponseState {
  statusCode?: number
  headers: Record<string, string | number>
  body: string
}

/** 造一个够用的响应，并留下写出的状态。 */
function createResponse(): { response: ServerResponse; state: ResponseState } {
  const state: ResponseState = { headers: {}, body: '' }
  const response = {
    destroyed: false,
    get headersSent(): boolean {
      return state.statusCode !== undefined
    },
    writeHead(code: number, headers: Record<string, string | number>): unknown {
      state.statusCode = code
      state.headers = headers
      return response
    },
    end(chunk?: string): unknown {
      state.body = chunk ?? ''
      return response
    },
  }
  return { response: response as unknown as ServerResponse, state }
}

/** 造一个跨站顶层跳转形状的请求；`login` 不填就是没带身份头。 */
function createRequest(
  options: { login?: string; url?: string; method?: string; headers?: Record<string, string> } = {},
): IncomingMessage {
  const headers: Record<string, string> = {
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    ...(options.login === undefined ? {} : { 'tailscale-user-login': options.login }),
    ...options.headers,
  }
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers,
    destroyed: false,
    socket: { destroyed: false },
  } as unknown as IncomingMessage
}

/** 名单非空的配置。 */
function allowed(users: string[] = [ALICE]) {
  return asPluginConfig(createConfig({ allowedUsers: users }))
}

test('名单内的 Tailscale 用户从桌面图标冷启动：回一个同源重载的空页面', () => {
  const { response, state } = createResponse()
  const handled = handleLaunchBootstrap(createRequest({ login: ALICE }), response, allowed())

  assert.equal(handled, true)
  assert.equal(state.statusCode, 200)
  assert.equal(state.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(state.headers['cache-control'], 'no-store')
  assert.match(String(state.headers['content-security-policy']), /default-src 'none'/)
  assert.match(state.body, /http-equiv="refresh" content="0; url=\/"/)
  assert.match(state.body, /<a href="\/">继续打开 DSH<\/a>/)
})

test('重载地址保留路径与查询，并做 HTML 转义', () => {
  const { response, state } = createResponse()
  handleLaunchBootstrap(createRequest({ login: ALICE, url: '/workspace/a?x=1&y=2' }), response, allowed())

  assert.match(state.body, /url=\/workspace\/a\?x=1&amp;y=2/)
  assert.match(state.body, /href="\/workspace\/a\?x=1&amp;y=2"/)
})

test('名单外、没带头、名单为空：都不写响应', () => {
  for (const request of [
    createRequest({ login: BOB }),
    createRequest(),
    createRequest({ login: ALICE }),
  ]) {
    const { response, state } = createResponse()
    const config = request.headers['tailscale-user-login'] === ALICE
      ? asPluginConfig(createConfig())
      : allowed()
    assert.equal(handleLaunchBootstrap(request, response, config), false)
    assert.equal(state.statusCode, undefined)
    assert.equal(state.body, '')
  }
})

test('不是跨站顶层跳转：同源、子资源、接口、非 GET 都放行', () => {
  const cases: { name: string; request: IncomingMessage }[] = [
    { name: '同源', request: createRequest({ login: ALICE, headers: { 'sec-fetch-site': 'same-origin' } }) },
    { name: '子资源', request: createRequest({ login: ALICE, headers: { 'sec-fetch-dest': 'empty' } }) },
    { name: '非导航', request: createRequest({ login: ALICE, headers: { 'sec-fetch-mode': 'cors' } }) },
    { name: '非 GET', request: createRequest({ login: ALICE, method: 'POST' }) },
    { name: '接口路径', request: createRequest({ login: ALICE, url: '/api/settings' }) },
    { name: 'connect 路径', request: createRequest({ login: ALICE, url: '/connect' }) },
  ]
  for (const item of cases) {
    const { response, state } = createResponse()
    assert.equal(handleLaunchBootstrap(item.request, response, allowed()), false, item.name)
    assert.equal(state.statusCode, undefined, item.name)
  }
})

test('登录名按整串、不区分大小写比较', () => {
  const { response, state } = createResponse()
  assert.equal(handleLaunchBootstrap(createRequest({ login: '  Alice@Example.com ' }), response, allowed()), true)
  assert.equal(state.statusCode, 200)
})

test('名单每次现读：改了名单下一次请求就生效', () => {
  const config = createConfig({ allowedUsers: [] })
  const request = createRequest({ login: ALICE })
  const first = createResponse()
  assert.equal(handleLaunchBootstrap(request, first.response, asPluginConfig(config)), false)

  config.allowedUsers.set([ALICE])
  const second = createResponse()
  assert.equal(handleLaunchBootstrap(request, second.response, asPluginConfig(config)), true)
  assert.equal(second.state.statusCode, 200)
})

test('响应已经写出或连接已断：不再插手', () => {
  const request = createRequest({ login: ALICE })
  const done = createResponse()
  done.response.writeHead(200, {})
  assert.equal(handleLaunchBootstrap(request, done.response, allowed()), false)

  const broken = createResponse()
  ;(broken.response as { destroyed: boolean }).destroyed = true
  assert.equal(handleLaunchBootstrap(request, broken.response, allowed()), false)
})
