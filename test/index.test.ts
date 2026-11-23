/**
 * 插件行为：连接鉴权登记，以及"配置改了之后它怎么跟上"。
 *
 * 这里刻意用假宿主手动驱动（见 helpers.ts）：本插件的配置是 volatile 字段，宿主**不会**因此
 * 重挂插件，只会发一次 `loader/volatile-update`。因此这一份的重点不是"apply 时算了什么"，而是：
 *
 * - 空→不装、非空→注册、清空→撤销；
 * - 订阅挂在插件自己的 `ctx` 上（`loader/volatile-update` 是实例内事件，挂在子 fiber 上收不到）；
 * - 作用域销毁之后，注册回到原样（无论当时名单是不是空的）。
 *
 * @module dsh-tailnet-admin/test/index
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply } from '../src/index.ts'
import {
  asPluginConfig,
  createAdmissionConnection,
  createConfig,
  createFakeAuthentication,
  createFakeHost,
  loginRequest,
} from './helpers.ts'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

test('默认配置：不注册校验器', () => {
  const connection = createAdmissionConnection()
  const host = createFakeHost({ connection })
  apply(host.ctx, asPluginConfig(createConfig()))
  host.provideConnection()

  assert.equal(connection.authentication.providers.length, 0, '名单为空时不碰认证')
  assert.deepEqual(host.subscribed, ['loader/volatile-update'])
})

test('名单非空时只放行名单里的用户，作用域销毁后撤销注册', () => {
  const connection = createAdmissionConnection()
  const host = createFakeHost({ connection })
  apply(host.ctx, asPluginConfig(createConfig({ allowedUsers: [ALICE] })))
  host.provideConnection()

  assert.equal(connection.authentication.providers.length, 1, '挂了一个校验器')
  assert.equal(connection.peers.length, 1, '只建一个 owner Peer')
  const provider = connection.authentication.providers[0]
  assert.ok(provider !== undefined)
  assert.equal(provider.authenticate(loginRequest(ALICE)), connection.peers[0], '名单里的用户拿到 Peer')
  assert.equal(provider.authenticate(loginRequest(BOB)), undefined, '名单外只是不认领')
  assert.equal(provider.authenticate({ headers: {} }), undefined, '没带头不认领')
  assert.equal(host.restorers.length, 1, '注册了一个清理函数')

  host.dispose()
  assert.equal(connection.authentication.providers.length, 0, '销毁后撤销')
})

test('配置改了即时生效：空→不装、置非空→装、清空→撤、再装回来', () => {
  const connection = createAdmissionConnection()
  const config = createConfig()
  const host = createFakeHost({ connection })
  apply(host.ctx, asPluginConfig(config))
  host.provideConnection()
  assert.equal(connection.authentication.providers.length, 0, '默认空名单不注册')

  config.allowedUsers.set([ALICE])
  host.emitVolatile([['allowedUsers']])
  assert.equal(connection.authentication.providers.length, 1, '置为非空之后即时注册')
  const provider = connection.authentication.providers[0]
  assert.ok(provider !== undefined)
  assert.equal(provider.authenticate(loginRequest(ALICE)), connection.peers[0])
  assert.equal(provider.authenticate(loginRequest(BOB)), undefined)

  config.allowedUsers.set([])
  host.emitVolatile([['allowedUsers']])
  assert.equal(connection.authentication.providers.length, 0, '清空即撤销')
  assert.equal(connection.authentication.revoked, 1)

  config.allowedUsers.set([BOB])
  host.emitVolatile([['allowedUsers']])
  assert.equal(connection.authentication.providers.length, 1, '还能再装一次（引用计数没有泄漏）')
  const again = connection.authentication.providers[0]
  assert.ok(again !== undefined)
  assert.notEqual(again.authenticate(loginRequest(BOB)), undefined, '新名单生效')

  host.dispose()
  assert.equal(connection.authentication.providers.length, 0, '销毁后撤销')
})

test('开着的时候销毁作用域：注册撤掉，不会留下半开的边', () => {
  const connection = createAdmissionConnection()
  const host = createFakeHost({ connection })
  apply(host.ctx, asPluginConfig(createConfig({ allowedUsers: [ALICE] })))
  host.provideConnection()
  assert.equal(connection.authentication.providers.length, 1)

  host.dispose()
  assert.equal(connection.authentication.providers.length, 0)
})

test('服务重放（inject 回调跑两轮）只注册一次，销毁后撤销', () => {
  const connection = createAdmissionConnection()
  const host = createFakeHost({ connection })
  apply(host.ctx, asPluginConfig(createConfig({ allowedUsers: [ALICE] })))
  host.provideConnection()
  host.provideConnection()

  assert.equal(connection.authentication.providers.length, 1, '两轮 inject 只挂一个校验器')
  assert.equal(host.restorers.length, 2, '两轮各登记一个清理函数')

  host.dispose()
  assert.equal(connection.authentication.providers.length, 0, '两轮都清理后撤销')
})

test('订阅面：只在插件自己的 ctx 上挂 volatile 更新', () => {
  const host = createFakeHost()
  apply(host.ctx, asPluginConfig(createConfig()))
  assert.deepEqual(host.subscribed, ['loader/volatile-update'])
})

test('connection 形状不对时不注册，且之后名单打开也保持原样', () => {
  const config = createConfig()
  const host = createFakeHost({ connection: {} })
  apply(host.ctx, asPluginConfig(config))
  host.provideConnection()

  config.allowedUsers.set([ALICE])
  host.emitVolatile([['allowedUsers']])
  assert.equal(host.connection.authentication, undefined, '没有 authentication 就没有可注册的东西')
})

test('接口缺 createPeer：不注册', () => {
  const authentication = createFakeAuthentication()
  const host = createFakeHost({ connection: { authentication } })
  apply(host.ctx, asPluginConfig(createConfig({ allowedUsers: [ALICE] })))
  host.provideConnection()

  assert.equal(authentication.providers.length, 0, '缺 createPeer 时不注册')
})
