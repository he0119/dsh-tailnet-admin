import assert from 'node:assert/strict'
import { test } from 'node:test'

import { disableBrowserAuth } from '../src/browser-auth.ts'
import { createFakeAuth } from './helpers.ts'

test('形状不对就不碰：缺失、不是对象、没有方法', () => {
  assert.equal(disableBrowserAuth(undefined), undefined)
  assert.equal(disableBrowserAuth({}), undefined)
  assert.equal(disableBrowserAuth({ browserAuth: undefined }), undefined)
  assert.equal(disableBrowserAuth({ browserAuth: { isAuthenticated: 'yes' } as never }), undefined)
})

test('安装后认证恒通过，原方法在还原时回到原位', () => {
  const auth = createFakeAuth()
  const patch = disableBrowserAuth({ browserAuth: auth })
  assert.ok(patch !== undefined)
  assert.equal(patch.patched, true)

  assert.equal(auth.isAuthenticated({}), true, '替换后恒通过')
  patch.restore()
  assert.equal(auth.isAuthenticated({}), false, '还原后回到原方法')
  assert.equal(auth.calls, 1, '还原后走的是原实现（它自己记了一次调用）')
})

test('幂等：重复安装只加引用计数，最后一轮才真正还原', () => {
  const auth = createFakeAuth()
  const first = disableBrowserAuth({ browserAuth: auth })
  const second = disableBrowserAuth({ browserAuth: auth })
  assert.ok(first !== undefined && second !== undefined)
  assert.equal(first.patched, true)
  assert.equal(second.patched, false, '第二次只是复用')

  first.restore()
  assert.equal(auth.isAuthenticated({}), true, '还有一轮在用，认证仍应恒通过')

  second.restore()
  assert.equal(auth.isAuthenticated({}), false, '引用计数归零才还原')
})

test('重复调用 restore 是安全的', () => {
  const auth = createFakeAuth()
  const only = disableBrowserAuth({ browserAuth: auth })
  assert.ok(only !== undefined)
  only.restore()
  only.restore()
  only.restore()
  assert.equal(auth.isAuthenticated({}), false)
})
