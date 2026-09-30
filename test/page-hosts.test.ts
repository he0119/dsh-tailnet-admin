import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildPageScript, pageHostMatches } from '../src/page-hosts.ts'

test('精确匹配：只有完全相同的主机命中', () => {
  const rules = ['dsh.example.com']
  assert.equal(pageHostMatches('dsh.example.com', rules), true)
  assert.equal(pageHostMatches('Dsh.Example.COM', rules), true, '比较不分大小写')
  assert.equal(pageHostMatches('dsh.example.com.evil.net', rules), false)
  assert.equal(pageHostMatches('example.com', rules), false)
})

test('后缀匹配：点开头，命中子域而不是"以这些字符结尾"', () => {
  const rules = ['.ts.net']
  assert.equal(pageHostMatches('dsh.example.ts.net', rules), true)
  assert.equal(pageHostMatches('a.b.ts.net', rules), true)
  assert.equal(pageHostMatches('ts.net', rules), false, '规则里的点是子域边界，裸域名不算命中')
  assert.equal(pageHostMatches('evilts.net', rules), false, '不是任意字符结尾')
})

test('通配：`*` 命中一切', () => {
  assert.equal(pageHostMatches('anything.example', ['*']), true)
  assert.equal(pageHostMatches('anything.example', ['first.example', '*']), true)
})

test('空规则表与空主机名一律不命中', () => {
  assert.equal(pageHostMatches('dsh.example.com', []), false)
  assert.equal(pageHostMatches('', ['*']), false)
  assert.equal(pageHostMatches('   ', ['*']), false)
})

test('注入脚本：规则为空时不注入', () => {
  assert.equal(buildPageScript([]), undefined)
})

test('注入脚本：带上规则表，并在 __DSH_TRANSPORT__ 已存在时让路', () => {
  const script = buildPageScript(['.ts.net', 'dsh.example.com'])
  assert.ok(script !== undefined)
  assert.ok(script.includes('[".ts.net","dsh.example.com"]'), `规则表按给定顺序原样内联：${script}`)
  assert.ok(script.includes('if(!globalThis.__DSH_TRANSPORT__)'), '桌面壳注入过的标志位必须让路')
  assert.ok(script.includes('{ownsHost:true}'), '要设的就是这一个字段')
  assert.ok(script.includes('location.hostname.toLowerCase()'), '比较前先小写')
})

test('注入脚本：规则里的 `<` 转义，关闭不了 script 元素', () => {
  const script = buildPageScript(['evil</script><img src=x>'])
  assert.ok(script !== undefined)
  assert.ok(!script.includes('</script'), `脚本正文里不能出现 </script：${script}`)
  assert.ok(script.includes('\\u003c'), '尖括号应转义成 \\u003c')
})
