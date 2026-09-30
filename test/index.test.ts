import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply } from '../src/index.ts'
import { ENV_DISABLE_AUTH, ENV_PAGE_HOSTS } from '../src/options.ts'
import { createFakeAuth, createFakeHost, withEnv } from './helpers.ts'

test('默认配置什么都不做：不注入、不碰认证', () => {
  withEnv({ [ENV_PAGE_HOSTS]: undefined, [ENV_DISABLE_AUTH]: undefined }, () => {
    const host = createFakeHost()
    apply(host.ctx, {})

    assert.deepEqual(host.renderIndex(), [], '没有 pageHosts 就不该有注入行')

    const auth = createFakeAuth()
    host.connection.browserAuth = auth
    host.provideConnection()
    assert.equal(auth.isAuthenticated({}), false, '认证保持原样')
  })
})

test('pageHosts 命中时注入一行 head 脚本', () => {
  withEnv({ [ENV_PAGE_HOSTS]: undefined, [ENV_DISABLE_AUTH]: undefined }, () => {
    const host = createFakeHost()
    apply(host.ctx, { pageHosts: ['.ts.net'] })

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
})

test('环境变量覆盖配置：清空主机表就不注入', () => {
  withEnv({ [ENV_PAGE_HOSTS]: '', [ENV_DISABLE_AUTH]: undefined }, () => {
    const host = createFakeHost()
    apply(host.ctx, { pageHosts: ['.ts.net'] })
    assert.deepEqual(host.renderIndex(), [])
  })
})

test('disableBrowserAuth 打开时替换认证，作用域销毁后还原', () => {
  withEnv({ [ENV_PAGE_HOSTS]: undefined, [ENV_DISABLE_AUTH]: undefined }, () => {
    const auth = createFakeAuth()
    const host = createFakeHost({ connection: { browserAuth: auth } })
    apply(host.ctx, { disableBrowserAuth: true })

    host.provideConnection()
    assert.equal(auth.isAuthenticated({}), true, '替换已生效')
    assert.equal(host.restorers.length, 1, '注册了一个清理函数')

    host.dispose()
    assert.equal(auth.isAuthenticated({}), false, '销毁后还原')
  })
})

test('服务重放（inject 回调跑两轮）不会让还原提前或失效', () => {
  withEnv({ [ENV_PAGE_HOSTS]: undefined, [ENV_DISABLE_AUTH]: undefined }, () => {
    const auth = createFakeAuth()
    const host = createFakeHost({ connection: { browserAuth: auth } })
    apply(host.ctx, { disableBrowserAuth: true })

    host.provideConnection()
    host.provideConnection()
    assert.equal(auth.isAuthenticated({}), true)
    assert.equal(host.restorers.length, 2)

    host.dispose()
    assert.equal(auth.isAuthenticated({}), false, '两轮都清理后回到原方法')
  })
})

test('协议名写进配置时不认得：仍按"没开"处理', () => {
  withEnv({ [ENV_PAGE_HOSTS]: undefined, [ENV_DISABLE_AUTH]: 'ture' }, () => {
    const auth = createFakeAuth()
    const host = createFakeHost({ connection: { browserAuth: auth } })
    apply(host.ctx, {})
    host.provideConnection()
    assert.equal(auth.isAuthenticated({}), false)
  })
})
