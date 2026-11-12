/**
 * 身份名单替换：读头、放行、拒绝、回落，以及"宿主重放"时的引用计数。
 *
 * 这里的假认证自己就是原方法：`authenticated` 决定它原本会放行还是拒绝。几乎所有用例都在核同一句话
 * ——**带身份头的请求由名单说了算，没带的才轮到原方法**。
 *
 * @module dsh-tailnet-admin/test/browser-auth
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { restrictBrowserAuth } from '../src/browser-auth.ts'

/** 原方法返回固定答案，同时记下它被怎么调用。 */
function createAuth(authenticated = false) {
  const calls: { request: unknown; secure: boolean | undefined }[] = []
  return {
    calls,
    auth: {
      isAuthenticated(request: unknown, secure?: boolean): boolean {
        calls.push({ request, secure })
        return authenticated
      },
    },
  }
}

/** 名单选项：固定一份登录名，不关心"拒绝了谁"。 */
function allow(users: readonly string[]): { allowedUsers: () => readonly string[] } {
  return { allowedUsers: () => users }
}

const ALICE = 'alice@example.com'

test('形状不对就不碰：缺失、不是对象、没有方法', () => {
  assert.equal(restrictBrowserAuth(undefined, allow([ALICE])), undefined)
  assert.equal(restrictBrowserAuth({}, allow([ALICE])), undefined)
  assert.equal(restrictBrowserAuth({ browserAuth: undefined }, allow([ALICE])), undefined)
  assert.equal(restrictBrowserAuth({ browserAuth: { isAuthenticated: 'yes' } as never }, allow([ALICE])), undefined)
})

test('没带身份头时回落到原方法，request 与 secure 原样传下去', () => {
  const { auth, calls } = createAuth(false)
  const patch = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  assert.ok(patch !== undefined)

  const request = { headers: {} }
  assert.equal(auth.isAuthenticated(request, true), false, '原方法拒绝，这里也拒绝')
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { request, secure: true })
  patch.restore()
})

test('名单里的登录名放行：大小写、首尾空白不敏感，Headers 也认', () => {
  const { auth } = createAuth(false)
  const patch = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  assert.ok(patch !== undefined)

  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': 'Alice@Example.com' } }), true)
  assert.equal(auth.isAuthenticated({ headers: { 'Tailscale-User-Login': `  ${ALICE}  ` } }), true)
  assert.equal(auth.isAuthenticated({ headers: { 'TAILSCALE-USER-LOGIN': ALICE } }), true)
  assert.equal(auth.isAuthenticated({ headers: { tailscale_user_login: ALICE } }), true, '下划线变体按同一个头处理')
  assert.equal(
    auth.isAuthenticated({ headers: new Headers({ 'Tailscale-User-Login': ALICE }) }),
    true,
    'Fetch 的 Headers 是宿主的另一种载体',
  )
  patch.restore()
})

test('名单外的登录名直接拒绝，即使原方法本来会放行', () => {
  const { auth, calls } = createAuth(true)
  const patch = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  assert.ok(patch !== undefined)

  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': 'bob@example.com' } }), false)
  assert.equal(calls.length, 0, '名单外不该再走原方法：不然手里有旧 cookie 就能绕过去')
  patch.restore()
})

test('头存在但形状不对（数组、空串、空白、逗号、非 ASCII）一律拒绝', () => {
  const { auth } = createAuth(true)
  const patch = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  assert.ok(patch !== undefined)

  const bad: unknown[] = [
    [],
    ['alice@example.com'],
    '',
    '   ',
    'ali ce@example.com',
    'alice@example.com,bob@example.com',
    '张三@example.com',
  ]
  for (const value of bad) {
    assert.equal(
      auth.isAuthenticated({ headers: { 'tailscale-user-login': value } }),
      false,
      `${JSON.stringify(value)} 不该被当成一个可用的登录名`,
    )
  }
  assert.equal(
    auth.isAuthenticated({ headers: { 'tailscale-user-login': ALICE, 'Tailscale-User-Login': 'bob@example.com' } }),
    false,
    '同一个头出现多个变体时不猜哪一个是真的',
  )
  patch.restore()
})

test('名单每次请求现读：配置改了不必重装', () => {
  let users: readonly string[] = [ALICE]
  const { auth } = createAuth(false)
  const patch = restrictBrowserAuth({ browserAuth: auth }, { allowedUsers: () => users })
  assert.ok(patch !== undefined)

  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': ALICE } }), true)
  users = ['bob@example.com']
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': ALICE } }), false)
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': 'bob@example.com' } }), true)
  patch.restore()
})

test('拒绝了谁：每个登录名只回调一次', () => {
  const seen: string[] = []
  const { auth } = createAuth(false)
  const patch = restrictBrowserAuth({ browserAuth: auth }, {
    allowedUsers: () => [ALICE],
    onDenied: (login) => {
      seen.push(login)
    },
  })
  assert.ok(patch !== undefined)

  auth.isAuthenticated({ headers: { 'tailscale-user-login': 'bob@example.com' } })
  auth.isAuthenticated({ headers: { 'tailscale-user-login': 'Bob@Example.com' } })
  auth.isAuthenticated({ headers: { 'tailscale-user-login': 'carol@example.com' } })
  assert.deepEqual(seen, ['bob@example.com', 'carol@example.com'])
  patch.restore()
})

test('authenticateApi 也按同一份名单：名单外返回 undefined，名单内走原方法', () => {
  const calls: unknown[] = []
  const auth = {
    isAuthenticated(_request: unknown, _secure?: boolean): boolean {
      return false
    },
    authenticateApi(request: unknown): unknown {
      calls.push(request)
      return 'peer-1'
    },
  }
  const patch = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  assert.ok(patch !== undefined)

  assert.equal(auth.authenticateApi({ headers: { 'tailscale-user-login': 'bob@example.com' } }), undefined)
  assert.equal(calls.length, 0, '名单外不该再走原方法')
  assert.equal(auth.authenticateApi({ headers: { 'tailscale-user-login': ALICE } }), 'peer-1')
  assert.equal(calls.length, 1)
  assert.equal(auth.authenticateApi({ headers: {} }), 'peer-1', '没带头时回落到原方法')

  patch.restore()
  assert.equal(
    auth.authenticateApi({ headers: { 'tailscale-user-login': 'bob@example.com' } }),
    'peer-1',
    '还原之后不再拦',
  )
})

test('名单内但带着 API 凭据时，isAuthenticated 让位给 authenticateApi', () => {
  const auth = {
    isAuthenticated(_request: unknown, _secure?: boolean): boolean {
      return false
    },
    authenticateApi(request: unknown): unknown {
      const headers = (request as { headers: Record<string, string> }).headers
      return headers['x-api'] === 'yes' ? 'peer-1' : undefined
    },
  }
  const patch = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  assert.ok(patch !== undefined)

  const apiRequest = { headers: { 'tailscale-user-login': ALICE, 'x-api': 'yes' } }
  assert.equal(auth.isAuthenticated(apiRequest), false, 'API 请求不该被降级成 browserPeer')
  assert.equal(auth.authenticateApi(apiRequest), 'peer-1', '随后由 admit 走 API 分支')

  const browserRequest = { headers: { 'tailscale-user-login': ALICE } }
  assert.equal(auth.isAuthenticated(browserRequest), true, '普通浏览器请求照旧放行')
  patch.restore()
})

test('重放时以后一次安装的名单为准（替换函数不重装）', () => {
  let users: readonly string[] = [ALICE]
  const { auth } = createAuth(false)
  const first = restrictBrowserAuth({ browserAuth: auth }, { allowedUsers: () => users })
  assert.ok(first !== undefined && first.patched)
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': ALICE } }), true)

  const second = restrictBrowserAuth({ browserAuth: auth }, { allowedUsers: () => ['bob@example.com'] })
  assert.ok(second !== undefined)
  assert.equal(second.patched, false, '同一个对象只装一次')
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': ALICE } }), false, '旧名单不再生效')
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': 'bob@example.com' } }), true, '新名单生效')

  first.restore()
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': 'bob@example.com' } }), true, '还有一轮在用')
  second.restore()
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': 'bob@example.com' } }), false)
})

test('幂等：重复安装只加引用计数，最后一轮才真正还原', () => {
  const { auth } = createAuth(false)
  const first = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  const second = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  assert.ok(first !== undefined && second !== undefined)
  assert.equal(first.patched, true)
  assert.equal(second.patched, false, '第二次只是复用')

  first.restore()
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': ALICE } }), true, '还有一轮在用，名单仍应生效')

  second.restore()
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': ALICE } }), false, '引用计数归零才还原')
})

test('重复调用 restore 是安全的', () => {
  const { auth } = createAuth(false)
  const only = restrictBrowserAuth({ browserAuth: auth }, allow([ALICE]))
  assert.ok(only !== undefined)
  only.restore()
  only.restore()
  only.restore()
  assert.equal(auth.isAuthenticated({ headers: { 'tailscale-user-login': ALICE } }), false)
})
