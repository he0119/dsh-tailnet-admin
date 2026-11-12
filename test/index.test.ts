/**
 * 插件行为：两个安装点，以及"配置改了之后它怎么跟上"。
 *
 * 这里刻意用假宿主手动驱动（见 helpers.ts）：本插件的两项配置都是 volatile 字段，宿主**不会**因此
 * 重挂插件，只会发一次 `loader/volatile-update`。因此这一份的重点不是"apply 时算了什么"，而是：
 *
 * - 注入行是在**每次渲染**时按当时的规则算的（改完配置，同一个订阅者下一次渲染就该不一样）；
 * - 身份名单在事件到达时对齐：空→装、非空之间改名单→替换函数现读、清空→还回去；
 * - 订阅挂在插件自己的 `ctx` 上（`loader/volatile-update` 是实例内事件，挂在子 fiber 上收不到）；
 * - 作用域销毁之后，认证回到原样（无论当时名单是不是空的）。
 *
 * @module dsh-tailnet-admin/test/index
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply } from '../src/index.ts'
import { asPluginConfig, createConfig, createFakeAuth, createFakeHost, loginRequest } from './helpers.ts'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'

test('默认配置：只把 .ts.net 当本机，不碰认证', () => {
  const host = createFakeHost()
  apply(host.ctx, asPluginConfig(createConfig()))

  const rows = host.renderIndex()
  assert.equal(rows.length, 1, '默认的 .ts.net 应当有一行注入')
  assert.ok(rows[0]?.kind === 'script' && rows[0].text.includes('.ts.net'))

  const auth = createFakeAuth()
  host.connection.browserAuth = auth
  host.provideConnection()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), false, '名单为空时认证保持原样')
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

test('名单非空时只放行名单里的用户，作用域销毁后还原', () => {
  const auth = createFakeAuth()
  const host = createFakeHost({ connection: { browserAuth: auth } })
  apply(host.ctx, asPluginConfig(createConfig({ allowedUsers: [ALICE] })))

  host.provideConnection()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), true, '名单里的用户放行')
  assert.equal(auth.isAuthenticated(loginRequest(BOB)), false, '名单外拒绝')
  assert.equal(auth.isAuthenticated({ headers: {} }), false, '没带头回落原方法')
  assert.equal(host.restorers.length, 1, '注册了一个清理函数')

  host.dispose()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), false, '销毁后还原')
})

test('配置改了即时生效：空→装、改名单→现读、清空→还回去', () => {
  const auth = createFakeAuth()
  const config = createConfig()
  const host = createFakeHost({ connection: { browserAuth: auth } })
  apply(host.ctx, asPluginConfig(config))
  host.provideConnection()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), false, '一开始名单是空的')

  config.allowedUsers.set([ALICE])
  host.emitVolatile([['allowedUsers']])
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), true, '置为非空之后即时装名单')
  assert.equal(auth.isAuthenticated(loginRequest(BOB)), false)

  config.allowedUsers.set([BOB])
  host.emitVolatile([['allowedUsers']])
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), false, '换成另一份名单，请求时就该看到新值')
  assert.equal(auth.isAuthenticated(loginRequest(BOB)), true, '不必卸载重装，引用计数也不漂移')

  config.allowedUsers.set([])
  host.emitVolatile([['allowedUsers']])
  assert.equal(auth.isAuthenticated(loginRequest(BOB)), false, '清空之后即时还原')

  config.allowedUsers.set([ALICE])
  host.emitVolatile([['allowedUsers']])
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), true, '还能再装一次（引用计数没有泄漏）')

  host.dispose()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), false, '销毁后仍然回到原方法')
})

test('开着的时候销毁作用域：认证也还原，不会留下半开的边', () => {
  const auth = createFakeAuth()
  const host = createFakeHost({ connection: { browserAuth: auth } })
  apply(host.ctx, asPluginConfig(createConfig({ allowedUsers: [ALICE] })))
  host.provideConnection()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), true)

  host.dispose()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), false)
})

test('服务重放（inject 回调跑两轮）不会让还原提前或失效', () => {
  const auth = createFakeAuth()
  const host = createFakeHost({ connection: { browserAuth: auth } })
  apply(host.ctx, asPluginConfig(createConfig({ allowedUsers: [ALICE] })))

  host.provideConnection()
  host.provideConnection()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), true)
  assert.equal(host.restorers.length, 2)

  host.dispose()
  assert.equal(auth.isAuthenticated(loginRequest(ALICE)), false, '两轮都清理后回到原方法')
})

test('订阅面：只在插件自己的 ctx 上挂两个事件，connection 那层没有事件通道', () => {
  const host = createFakeHost()
  apply(host.ctx, asPluginConfig(createConfig()))
  assert.deepEqual(host.subscribed, ['webserver/index-inject', 'loader/volatile-update'])
})

test('connection 形状不对时不碰认证，且之后名单打开也保持原样', () => {
  const config = createConfig()
  const host = createFakeHost({ connection: {} })
  apply(host.ctx, asPluginConfig(config))
  host.provideConnection()

  config.allowedUsers.set([ALICE])
  host.emitVolatile([['allowedUsers']])
  assert.equal(host.connection.browserAuth, undefined, '没有 browserAuth 就没有可替换的东西')
})
