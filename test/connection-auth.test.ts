/**
 * 新宿主的连接鉴权注册：形状校验、放行、不认领、现读名单、重放时的引用计数。
 *
 * 这里的假 `connection.authentication` 把"宿主会怎么问"简化成"直接调校验器"：真正的 `admit`
 * 会先过 Host/Origin 栅栏、再按注册顺序问。顺序与栅栏都不在本模块的范围里（见 index.ts 的注释）。
 *
 * @module dsh-tailnet-admin/test/connection-auth
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { registerConnectionAuthentication } from '../src/connection-auth.ts'
import { createAdmissionConnection, createFakeAuthentication, loginRequest } from './helpers.ts'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

/** 名单选项：固定一份登录名，不关心"没放行谁"。 */
function allow(users: readonly string[]): { allowedUsers: () => readonly string[] } {
  return { allowedUsers: () => users }
}

test('形状不对就不注册：缺 connection、缺 authentication、缺 register、缺 createPeer', () => {
  assert.equal(registerConnectionAuthentication(undefined, allow([ALICE])), undefined)
  assert.equal(registerConnectionAuthentication({}, allow([ALICE])), undefined)
  assert.equal(registerConnectionAuthentication({ authentication: {} as never }, allow([ALICE])), undefined)
  assert.equal(
    registerConnectionAuthentication({ authentication: createFakeAuthentication() }, allow([ALICE])),
    undefined,
    '缺 createPeer 不注册',
  )
})

test('注册一个校验器，只建一个 owner Peer', () => {
  const connection = createAdmissionConnection()
  const { authentication, peers } = connection
  const handle = registerConnectionAuthentication(connection, allow([ALICE]))
  assert.ok(handle !== undefined)
  assert.equal(handle.registered, true)
  assert.equal(authentication.providers.length, 1)
  assert.equal(peers.length, 1)
  assert.deepEqual(peers[0]?.principal, { kind: 'owner' })

  const provider = authentication.providers[0]
  assert.ok(provider !== undefined)
  assert.equal(provider.authenticate(loginRequest(ALICE)), peers[0], '名单里的用户拿到同一个 Peer')
  assert.equal(provider.authenticate(loginRequest(BOB)), undefined, '名单外只是不认领')
  assert.equal(provider.authenticate({ headers: {} }), undefined, '没带头不认领')
  handle.restore()
})

test('大小写、首尾空白、Headers 都认；坏值一律不认领', () => {
  const connection = createAdmissionConnection()
  const { authentication, peers } = connection
  const handle = registerConnectionAuthentication(connection, allow([ALICE]))
  const provider = authentication.providers[0]
  assert.ok(handle !== undefined && provider !== undefined)
  const peer = peers[0]

  assert.equal(provider.authenticate({ headers: { 'tailscale-user-login': 'Alice@Example.com' } }), peer)
  assert.equal(provider.authenticate({ headers: { 'Tailscale-User-Login': `  ${ALICE}  ` } }), peer)
  assert.equal(provider.authenticate({ headers: { 'TAILSCALE-USER-LOGIN': ALICE } }), peer)
  assert.equal(provider.authenticate({ headers: { tailscale_user_login: ALICE } }), peer)
  assert.equal(
    provider.authenticate({ headers: new Headers({ 'Tailscale-User-Login': ALICE }) }),
    peer,
    'Fetch 的 Headers 是宿主的另一种载体',
  )

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
      provider.authenticate({ headers: { 'tailscale-user-login': value } }),
      undefined,
      `${JSON.stringify(value)} 不该被当成一个可用的登录名`,
    )
  }
  assert.equal(
    provider.authenticate({ headers: { 'tailscale-user-login': ALICE, 'Tailscale-User-Login': BOB } }),
    undefined,
    '同一个头出现多个变体时不猜哪一个是真的',
  )
  handle.restore()
})

test('名单每次请求现读：配置改了不必重装', () => {
  let users: readonly string[] = [ALICE]
  const connection = createAdmissionConnection()
  const { authentication, peers } = connection
  const handle = registerConnectionAuthentication(connection, { allowedUsers: () => users })
  const provider = authentication.providers[0]
  assert.ok(handle !== undefined && provider !== undefined)

  assert.equal(provider.authenticate(loginRequest(ALICE)), peers[0])
  users = [BOB]
  assert.equal(provider.authenticate(loginRequest(ALICE)), undefined)
  assert.equal(provider.authenticate(loginRequest(BOB)), peers[0])
  handle.restore()
})

test('没放行谁：每个登录名只回调一次', () => {
  const seen: string[] = []
  const connection = createAdmissionConnection()
  const { authentication } = connection
  const handle = registerConnectionAuthentication(connection, {
    allowedUsers: () => [ALICE],
    onNotAllowed: (login) => {
      seen.push(login)
    },
  })
  const provider = authentication.providers[0]
  assert.ok(handle !== undefined && provider !== undefined)

  provider.authenticate(loginRequest(BOB))
  provider.authenticate(loginRequest('Bob@Example.com'))
  provider.authenticate(loginRequest('carol@example.com'))
  assert.deepEqual(seen, [BOB, 'carol@example.com'])
  handle.restore()
})

test('重放时只注册一次，引用计数归零才撤销', () => {
  const connection = createAdmissionConnection()
  const { authentication } = connection
  const first = registerConnectionAuthentication(connection, { allowedUsers: () => [ALICE] })
  const second = registerConnectionAuthentication(connection, { allowedUsers: () => [BOB] })
  assert.ok(first !== undefined && second !== undefined)
  assert.equal(first.registered, true)
  assert.equal(second.registered, false, '同一个注册表只挂一次')
  assert.equal(authentication.providers.length, 1)

  const provider = authentication.providers[0]
  assert.ok(provider !== undefined)
  assert.equal(provider.authenticate(loginRequest(ALICE)), undefined, '以后一次安装的名单为准')
  assert.notEqual(provider.authenticate(loginRequest(BOB)), undefined, 'BOB 现在能拿到 Peer')

  first.restore()
  assert.equal(authentication.providers.length, 1, '还有一轮在用')
  second.restore()
  assert.equal(authentication.providers.length, 0, '引用计数归零才撤销')
  assert.equal(authentication.revoked, 1)

  second.restore()
  assert.equal(authentication.revoked, 1, '重复撤销是安全的')
})
