/**
 * 插件行为：两个安装点，以及"配置改了之后它怎么跟上"。
 *
 * 这里刻意用假宿主手动驱动（见 helpers.ts）：本插件的两个开关都是 volatile 字段，宿主**不会**因此
 * 重挂插件，只会发一次 `loader/volatile-update`。因此这一份的重点不是"apply 时算了什么"，而是：
 *
 * - 注入行是在**每次渲染**时按当时的规则算的（改完配置，同一个订阅者下一次渲染就该不一样）；
 * - 认证旁路在事件到达时对齐：开→换、关→还回去，且重复开不叠加引用计数；
 * - 订阅挂在插件自己的 `ctx` 上（`loader/volatile-update` 是实例内事件，挂在子 fiber 上收不到）；
 * - 作用域销毁之后，认证回到原样（无论当时开关是哪一边）。
 *
 * @module dsh-tailnet-admin/test/index
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply } from '../src/index.ts'
import { asPluginConfig, createConfig, createFakeAuth, createFakeHost } from './helpers.ts'

test('默认配置什么都不做：不注入、不碰认证', () => {
  const host = createFakeHost()
  apply(host.ctx, asPluginConfig(createConfig()))

  assert.deepEqual(host.renderIndex(), [], '没有 pageHosts 就不该有注入行')

  const auth = createFakeAuth()
  host.connection.browserAuth = auth
  host.provideConnection()
  assert.equal(auth.isAuthenticated({}), false, '认证保持原样')
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

  assert.deepEqual(host.renderIndex(), [], '一开始是空表，不注入')

  config.pageHosts.set(['.ts.net'])
  host.emitVolatile([['pageHosts']])
  const rows = host.renderIndex()
  assert.equal(rows.length, 1, 'volatile 更新之后，下一次渲染就带上脚本')
  assert.ok(rows[0]?.kind === 'script' && rows[0].text.includes('.ts.net'))

  config.pageHosts.set([])
  host.emitVolatile([['pageHosts']])
  assert.deepEqual(host.renderIndex(), [], '清空之后又回到不注入')
})

test('disableBrowserAuth 打开时替换认证，作用域销毁后还原', () => {
  const auth = createFakeAuth()
  const host = createFakeHost({ connection: { browserAuth: auth } })
  apply(host.ctx, asPluginConfig(createConfig({ disableBrowserAuth: true })))

  host.provideConnection()
  assert.equal(auth.isAuthenticated({}), true, '替换已生效')
  assert.equal(host.restorers.length, 1, '注册了一个清理函数')

  host.dispose()
  assert.equal(auth.isAuthenticated({}), false, '销毁后还原')
})

test('配置改了即时生效：开→换，关→还回去，重复开不叠加引用计数', () => {
  const auth = createFakeAuth()
  const config = createConfig()
  const host = createFakeHost({ connection: { browserAuth: auth } })
  apply(host.ctx, asPluginConfig(config))
  host.provideConnection()
  assert.equal(auth.isAuthenticated({}), false, '一开始关着')

  config.disableBrowserAuth.set(true)
  host.emitVolatile([['disableBrowserAuth']])
  assert.equal(auth.isAuthenticated({}), true, '置为 true 之后即时换掉')

  host.emitVolatile([['disableBrowserAuth']])
  assert.equal(auth.isAuthenticated({}), true, '再次通知不该出问题')

  config.disableBrowserAuth.set(false)
  host.emitVolatile([['disableBrowserAuth']])
  assert.equal(auth.isAuthenticated({}), false, '置回 false 之后即时还原')

  config.disableBrowserAuth.set(true)
  host.emitVolatile([['disableBrowserAuth']])
  assert.equal(auth.isAuthenticated({}), true, '还能再开一次（引用计数没有泄漏）')

  host.dispose()
  assert.equal(auth.isAuthenticated({}), false, '销毁后仍然回到原方法')
})

test('开着的时候销毁作用域：认证也还原，不会留下半开的边', () => {
  const auth = createFakeAuth()
  const config = createConfig()
  const host = createFakeHost({ connection: { browserAuth: auth } })
  apply(host.ctx, asPluginConfig(config))
  host.provideConnection()

  config.disableBrowserAuth.set(true)
  host.emitVolatile([['disableBrowserAuth']])
  assert.equal(auth.isAuthenticated({}), true)

  host.dispose()
  assert.equal(auth.isAuthenticated({}), false)
})

test('服务重放（inject 回调跑两轮）不会让还原提前或失效', () => {
  const auth = createFakeAuth()
  const host = createFakeHost({ connection: { browserAuth: auth } })
  apply(host.ctx, asPluginConfig(createConfig({ disableBrowserAuth: true })))

  host.provideConnection()
  host.provideConnection()
  assert.equal(auth.isAuthenticated({}), true)
  assert.equal(host.restorers.length, 2)

  host.dispose()
  assert.equal(auth.isAuthenticated({}), false, '两轮都清理后回到原方法')
})

test('订阅面：只在插件自己的 ctx 上挂两个事件，connection 那层没有事件通道', () => {
  const host = createFakeHost()
  apply(host.ctx, asPluginConfig(createConfig()))
  assert.deepEqual(host.subscribed, ['webserver/index-inject', 'loader/volatile-update'])
})

test('connection 形状不对时不碰认证，且之后配置打开也保持原样', () => {
  const config = createConfig()
  const host = createFakeHost({ connection: {} })
  apply(host.ctx, asPluginConfig(config))
  host.provideConnection()

  config.disableBrowserAuth.set(true)
  host.emitVolatile([['disableBrowserAuth']])
  assert.equal(host.connection.browserAuth, undefined, '没有 browserAuth 就没有可替换的东西')
})
