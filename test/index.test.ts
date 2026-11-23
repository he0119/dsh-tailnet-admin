/**
 * 插件行为：两个安装点，以及"配置改了之后它怎么跟上"。
 *
 * 这里刻意用假宿主手动驱动（见 helpers.ts）：本插件的两项配置都是 volatile 字段，宿主**不会**因此
 * 重挂插件，只会发一次 `loader/volatile-update`。因此这一份的重点不是"apply 时算了什么"，而是：
 *
 * - 注入行是在**每次渲染**时按当时的规则算的（改完配置，同一个订阅者下一次渲染就该不一样）；
 * - 身份名单在事件到达时对齐：空→不装、非空→注册、清空→撤销；
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

test('默认配置：只把 .ts.net 当本机，不注册校验器', () => {
  const connection = createAdmissionConnection()
  const host = createFakeHost({ connection })
  apply(host.ctx, asPluginConfig(createConfig()))

  const rows = host.renderIndex()
  assert.equal(rows.length, 1, '默认的 .ts.net 应当有一行注入')
  assert.ok(rows[0]?.kind === 'script' && rows[0].text.includes('.ts.net'))

  host.provideConnection()
  assert.equal(connection.authentication.providers.length, 0, '名单为空时不碰认证')
})

test('pageHosts 命中时注入一行 head 脚本', () => {
  const host = createFakeHost()
  apply(host.ctx, asPluginConfig(createConfig({ pageHosts: ['.ts.net'] })))

  const rows = host.renderIndex()
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.ok(row !== undefined)
  assert.equal(row.kind, 'script')
  if (row.kind === 'script') {
    assert.equal(row.placement, 'head')
    assert.ok(row.text.includes('.ts.net'))
    assert.ok(row.text.includes('{ownsHost:true}'))
  }
})

test('渲染时读的是当前规则：改完配置，同一个订阅者下一次渲染就换了内容', () => {
  const config = createConfig()
  const host = createFakeHost()
  apply(host.ctx, asPluginConfig(config))

  const initial = host.renderIndex()
  assert.equal(initial.length, 1, '默认的 .ts.net 一开始就有一行')
  assert.ok(initial[0]?.kind === 'script' && initial[0].text.includes('.ts.net'))

  config.pageHosts.set(['dsh.example.com'])
  host.emitVolatile([['pageHosts']])
  const rows = host.renderIndex()
  assert.equal(rows.length, 1, 'volatile 更新之后，下一次渲染就换成新规则')
  assert.ok(rows[0]?.kind === 'script' && rows[0].text.includes('dsh.example.com'))

  config.pageHosts.set([])
  host.emitVolatile([['pageHosts']])
  assert.deepEqual(host.renderIndex(), [], '显式空表才回到不注入')
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

test('订阅面：只在插件自己的 ctx 上挂两个事件，connection 那层没有事件通道', () => {
  const host = createFakeHost()
  apply(host.ctx, asPluginConfig(createConfig()))
  assert.deepEqual(host.subscribed, ['webserver/index-inject', 'loader/volatile-update'])
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
