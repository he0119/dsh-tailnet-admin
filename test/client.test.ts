/**
 * Web Client 端（源码 `src/client/`，被测的是打包产物 `lib/client.js`）的接线与那一页唯一有判断的地方。
 *
 * 两份断言，对着两件不同的事：
 *
 * - **规则表草稿**（源码层）：`pageHosts` 是数组而官方表单按草稿文本组织，中间那层换算决定了"按保存
 *   会写进去什么"，以及哪些写法当场挡住。这几条是纯函数，直接测源码。
 * - **打包产物**（vm 层）：客户端半侧不在本进程里跑，而是由宿主的模块加载器执行。id 不对、导出的面
 *   不对、require 了宿主没提供的模块、注册时机不对——这些在源码层面全都看不出来。于是这里按模块加载器
 *   的方式跑一遍：假的 `window.__ModuleLoader__` + 假 `require` 执行工厂，再用假 ctx 跑 `apply`，核对
 *   注册到的槽位、键、命名空间、注入面、字典与内联的样式表。
 *
 * 官方控件库**不跑**，只喂替身：vm 里没有模块表，也没有真的 React。替身钉住的是被测代码依赖的那个接缝
 * ——名字与形状；官方组件的观感不在本仓库的测试范围内。
 *
 * 产物不存在时整组跳过（源码开发不必先构建）。
 *
 * @module dsh-tailnet-admin/test/client
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { booleanField, isUsablePageHost, pageHostsField, splitPageHostsDraft } from '../src/client/rules.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'lib/client.js')

/** Web Client 端上报的模块 id 与配置槽位的键：都是包名。 */
const PACKAGE = '@he0119/dsh-tailnet-admin'
/** 平台基线里的官方控件库（本仓库里只有替身）。 */
const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'
/** 产物里允许出现的 require：平台基线模块。 */
const BASELINE = ['react', 'react/jsx-runtime', PRIMITIVES]
/** 配置页注册的槽位（插件列表里本插件那个包页）。 */
const CONFIG_SLOT = 'plugins.bundle.config'
/** 字典命名空间。 */
const NS = 'settings.tailnetAdmin'
/** 设置命名空间：profile 里那一行的 entry id，也是配置表单的键。 */
const SETTINGS_NS = 'tailnet-admin'

// ------------------------------------------------------------------ 规则表草稿（源码）

test('规则表：只有注入脚本真能命中的写法才算可用', () => {
  for (const rule of ['*', '.ts.net', 'dsh.example.com', 'localhost', '127.0.0.1', '.internal']) {
    assert.equal(isUsablePageHost(rule), true, `${rule} 应当算可用`)
  }
  for (const rule of ['', '*.ts.net', 'https://dsh.example.com', 'dsh.example.com:3080', 'a b', '.', '.ts.net.', 'a..b', 'x/y', 'a?b']) {
    assert.equal(isUsablePageHost(rule), false, `${rule} 命不中任何主机，应当算不可用`)
  }
})

test('规则表草稿：按行与逗号切，去空白、丢空项', () => {
  assert.deepEqual(splitPageHostsDraft('.ts.net\ndsh.example.com'), ['.ts.net', 'dsh.example.com'])
  assert.deepEqual(splitPageHostsDraft(' .ts.net , , my.lan\n\n'), ['.ts.net', 'my.lan'])
  assert.deepEqual(splitPageHostsDraft('   '), [])
})

test('规则表字段：值↔文本的换算，空文本 = 从用户层去掉这一项', () => {
  const field = pageHostsField('pageHosts')
  assert.equal(field.format(['.ts.net', 'dsh.example.com']), '.ts.net\ndsh.example.com')
  assert.equal(field.format(undefined), '')
  assert.deepEqual(field.parse('.ts.net\n\nmy.lan'), { kind: 'set', value: ['.ts.net', 'my.lan'] })
  assert.deepEqual(field.parse('  '), { kind: 'clear' })
  assert.equal(field.parse('*.ts.net'), undefined, '命不中的写法不产生写入：官方表单据此挡住保存')
  assert.equal(field.parse('.ts.net\n*.ts.net'), undefined, '只要有一条命不中，整次保存就不该发生')
})

test('布尔字段：草稿就是 true/false，空串回落，别的文本不产生写入', () => {
  const field = booleanField('disableBrowserAuth')
  assert.equal(field.format(true), 'true')
  assert.equal(field.format(false), 'false')
  assert.equal(field.format(undefined), '')
  assert.deepEqual(field.parse('true'), { kind: 'set', value: true })
  assert.deepEqual(field.parse('false'), { kind: 'set', value: false })
  assert.deepEqual(field.parse(''), { kind: 'clear' })
  assert.equal(field.parse('yes'), undefined)
})

// ------------------------------------------------------------------ 打包产物（vm）

/** 假文档：只实现 installStyles 用到的那三面。 */
interface FakeStyleTag {
  dataset: Record<string, string>
  textContent: string
  parentNode: { removeChild(node: unknown): void } | null
}

interface FakeDocument {
  querySelector(selector: string): unknown
  createElement(tag: string): FakeStyleTag
  readonly head: { appendChild(node: FakeStyleTag): void }
  readonly injected: FakeStyleTag[]
}

function createFakeDocument(): FakeDocument {
  const injected: FakeStyleTag[] = []
  const head = {
    appendChild(node: FakeStyleTag): void {
      injected.push(node)
      node.parentNode = { removeChild: () => { /* 只记状态，不做真事 */ } }
    },
  }
  return {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', parentNode: null }),
    head,
    injected,
  }
}

/** 官方 `SettingsFormModel` 的替身：只记下规格与投影，形状对齐接缝。 */
class FakeSettingsFormModel {
  /** 每次构造记一笔：用来核"两个字段的规格都交出去了"。 */
  static readonly constructed: { specs: readonly { field: string }[] }[] = []

  private readonly scope: { getSnapshot(): { status: string } }

  constructor(scope: { getSnapshot(): { status: string } }, specs: readonly { field: string }[]) {
    this.scope = scope
    FakeSettingsFormModel.constructed.push({ specs })
  }

  shell(): Record<string, unknown> {
    const { status } = this.scope.getSnapshot()
    return { available: status === 'ready', writable: status === 'ready', dirty: false, invalid: false, saving: false, failed: false }
  }

  field(name: string): Record<string, unknown> {
    return { id: name, text: '', overridden: false, invalid: false }
  }

  actions(): Record<string, unknown> {
    return { edit: () => {}, resetField: () => {}, discard: () => {}, save: () => {} }
  }

  bind(project: () => unknown): Record<string, unknown> {
    return { getSnapshot: project, subscribe: () => () => {} }
  }

  dispose(): void {}
}

/** 加载产物：注册的工厂、导出的面、它 require 过的模块。 */
interface LoadedBundle {
  readonly id: string
  readonly exported: Record<string, unknown>
  readonly requested: string[]
  readonly document: FakeDocument
}

function loadBundle(): LoadedBundle | undefined {
  if (!existsSync(BUNDLE)) return undefined
  const document = createFakeDocument()
  const entries: { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> }[] = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry: (typeof entries)[number]) => { entries.push(entry) } } },
    document,
    console,
  }
  vm.runInNewContext(readFileSync(BUNDLE, 'utf8'), sandbox)
  assert.equal(entries.length, 1, '产物应当只登记一个 factory')
  const entry = entries[0]
  assert.ok(entry !== undefined)

  const requested: string[] = []
  const modules: Record<string, unknown> = {
    react: { createElement: () => null, Fragment: null },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: null },
    [PRIMITIVES]: {
      SettingsForm: () => null,
      SettingsFormModel: FakeSettingsFormModel,
      Switch: () => null,
      Tag: () => null,
      Button: () => null,
    },
  }
  const exported = entry.factory((id: string) => {
    requested.push(id)
    const module = modules[id]
    if (module === undefined) throw new Error(`产物 require 了平台模块表里没有的模块：${id}`)
    return module
  })
  return { id: entry.id, exported, requested, document }
}

/** 假客户端上下文：槽位、字典、effect 与设置接缝，全部记下来。 */
interface FakeClient {
  readonly ctx: unknown
  readonly registrations: { slot: string; registration: Record<string, unknown>; component: unknown }[]
  readonly effects: { label: string | undefined; dispose: () => void }[]
  readonly dictionaries: Map<string, unknown>
  readonly namespaces: string[]
}

function createFakeClient(options: { configForms?: boolean } = {}): FakeClient {
  const registrations: FakeClient['registrations'] = []
  const effects: FakeClient['effects'] = []
  const dictionaries = new Map<string, unknown>()
  const namespaces: string[] = []

  const scope = {
    getSnapshot: () => ({
      status: 'ready',
      value: { pageHosts: ['.ts.net'], disableBrowserAuth: false },
      base: undefined,
      user: { pageHosts: ['.ts.net'] },
      writable: true,
      revision: 7,
    }),
    subscribe: () => () => {},
    mutate: async () => true,
  }

  const ctx: Record<string, unknown> = {
    effect(callback: () => unknown, label?: string): void {
      const dispose = callback()
      effects.push({ label, dispose: typeof dispose === 'function' ? dispose as () => void : () => {} })
    },
    locale: {
      register(ns: string, dicts: unknown) {
        dictionaries.set(ns, dicts)
        return () => {}
      },
      bind: () => (key: string) => key,
    },
    slots: {
      inject(_slot: string, callback: () => unknown): unknown {
        return callback()
      },
      register(registration: Record<string, unknown>, component: unknown) {
        registrations.push({ slot: String(registration.name), registration, component })
        return () => {}
      },
    },
  }
  if (options.configForms !== false) {
    ctx.configForms = {
      get(ns: string) {
        namespaces.push(ns)
        return scope
      },
    }
  }
  return { ctx, registrations, effects, dictionaries, namespaces }
}

const loaded = loadBundle()
const skip = loaded === undefined ? 'lib/client.js 不存在，先跑 pnpm run build' : false

test('产物：经典脚本契约、模块 id 与导出的面', { skip }, () => {
  const bundle = readFileSync(BUNDLE, 'utf8')
  assert.ok(
    bundle.startsWith('window.__ModuleLoader__.load({'),
    '产物必须以经典脚本的报名头开始：宿主只服务这一种形状',
  )
  assert.ok(bundle.includes(`id: ${JSON.stringify(PACKAGE)}`), '报名头里的 id 要等于包名')
  assert.ok(bundle.includes('factory: (require) => {'), '报名头要交出以 require 为参数的工厂')
  assert.match(
    bundle.replace(/\/\/# sourceMappingURL=.*\n?$/u, ''),
    /return module\.exports;\s*\}\s*\}\);\s*$/u,
    '结尾要把 module.exports 交回去，工厂的返回值才是这个模块',
  )
  assert.equal(loaded?.id, PACKAGE)
  assert.equal(loaded?.exported.name, PACKAGE, '导出的 name 要等于包名（模块加载器按它对账）')
  // 从 vm 里取出来的数组原型不在本 realm，先摊平成这边的一层再比。
  assert.deepEqual([...(loaded?.exported.inject as string[])], ['slots', 'locale', 'configForms'])
})

test('产物：只 require 平台基线模块', { skip }, () => {
  const requested = loaded?.requested ?? []
  for (const id of requested) {
    assert.ok(BASELINE.includes(id), `${id} 不是平台基线模块：客户端模块表里没有旁挂依赖的路由`)
  }
  assert.ok(requested.includes(PRIMITIVES), '控件库要保持外部依赖（同一份实例由模块表提供）')
  assert.ok(!requested.some((id) => id.startsWith('@deepseek-ai/dsh-client-') && id !== PRIMITIVES))
})

test('产物：apply 注册官方插件页的配置槽位，键是包名', { skip }, () => {
  const client = createFakeClient()
  const apply = loaded?.exported.apply as ((ctx: unknown) => void) | undefined
  assert.equal(typeof apply, 'function', '产物要导出 apply')
  apply?.(client.ctx)

  assert.equal(client.registrations.length, 1)
  const entry = client.registrations[0]
  assert.equal(entry?.slot, CONFIG_SLOT, '配置页挂在「插件」页里本插件那个包页上')
  assert.equal(entry?.registration.key, PACKAGE, '包级配置槽位按包名找贡献')
  assert.equal(entry?.registration.locale, NS)
  assert.equal(typeof entry?.component, 'function')
  assert.deepEqual([...client.dictionaries.keys()], [NS], '字典要注册在注册时声明的命名空间上')
  assert.deepEqual(client.namespaces, [SETTINGS_NS], '表单按设置命名空间取：它必须等于 profile 里那一行的 id')
  assert.deepEqual(
    client.effects.map((effect) => effect.label),
    ['dsh-tailnet-admin: dictionaries', 'dsh-tailnet-admin: stylesheet', 'dsh-tailnet-admin: settings form'],
    'effect 的标签是排查时唯一的线索，改名要当破坏性变更',
  )
})

test('产物：注入面给出快照钩子与四个表单动作，规格就是那两个字段', { skip }, () => {
  const client = createFakeClient()
  const apply = loaded?.exported.apply as ((ctx: unknown) => void) | undefined
  // 替身是模块级的：前面的用例也构造过模型，这里只想看这一次 apply 交出去的规格。
  FakeSettingsFormModel.constructed.length = 0
  apply?.(client.ctx)

  const injected = (client.registrations[0]?.registration.inject as () => Record<string, unknown>)()
  const hooks = injected.hooks as Record<string, { getSnapshot(): unknown; subscribe(): unknown }>
  const card = hooks.tailnetAdminCard
  assert.ok(card !== undefined, '快照来源要挂在 hooks.tailnetAdminCard 上（渲染器据此造 useTailnetAdminCard）')
  assert.equal(typeof card.getSnapshot, 'function')
  assert.equal(typeof card.subscribe, 'function')
  for (const action of ['edit', 'resetField', 'discard', 'save']) {
    assert.equal(typeof injected[action], 'function', `注入面缺 ${action}`)
  }

  assert.deepEqual(
    Array.from(FakeSettingsFormModel.constructed, (entry) => Array.from(entry.specs, (spec) => spec.field)),
    [['pageHosts', 'disableBrowserAuth']],
    '两个字段的换算规格都要交给官方表单模型',
  )
})

test('产物：字典两份语言的键集一致，且没有空文案', { skip }, () => {
  const client = createFakeClient()
  const apply = loaded?.exported.apply as ((ctx: unknown) => void) | undefined
  apply?.(client.ctx)

  const dicts = client.dictionaries.get(NS) as { zh: Record<string, string>; en: Record<string, string> }
  const zhKeys = Object.keys(dicts.zh).sort()
  const enKeys = Object.keys(dicts.en).sort()
  assert.ok(zhKeys.length > 0)
  assert.deepEqual(enKeys, zhKeys, '少一个键就是界面上一处露出键名的地方')
  for (const [key, value] of Object.entries({ ...dicts.zh, ...dicts.en })) {
    assert.notEqual(value.trim(), '', `${key} 的文案不能是空串`)
  }
})

test('产物：样式表内联进产物并按 effect 的生死注入与移除', { skip }, () => {
  const client = createFakeClient()
  const apply = loaded?.exported.apply as ((ctx: unknown) => void) | undefined
  // 假文档是模块级的：前面的用例也已经 apply 过，这里只看这一次注入的那一份。
  const document = loaded?.document
  if (document !== undefined) document.injected.length = 0
  apply?.(client.ctx)

  assert.equal(document?.injected.length, 1, '配置页的样式表要随 apply 注入一次')
  const tag = document?.injected[0]
  assert.equal(tag?.dataset.plugin, 'dsh-tailnet-admin')
  assert.equal(tag?.dataset.pluginCss, 'dsh-tailnet-admin/styles.css')
  assert.ok(tag?.textContent.includes('.dta-field'), '源码里的 CSS 要真的进了产物')

  const stylesheet = client.effects.find((effect) => effect.label === 'dsh-tailnet-admin: stylesheet')
  stylesheet?.dispose()
})

test('产物：拿不到 configForms 时仍然注册，页面自己说"读不到"', { skip }, () => {
  const client = createFakeClient({ configForms: false })
  const apply = loaded?.exported.apply as ((ctx: unknown) => void) | undefined
  apply?.(client.ctx)
  assert.equal(client.registrations.length, 1, '设置接缝缺席不该让整页装不上')
  assert.deepEqual(client.namespaces, [], '没有服务时不去问命名空间')
})

test('cordis.patch.yml 声明的那一行 id，就是配置页用的设置命名空间', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(
    patch,
    new RegExp(`^\\s*(?:-\\s*)?id:\\s*${SETTINGS_NS}\\s*$`, 'mu'),
    `cordis.patch.yml 里那一行的 id 必须是 ${SETTINGS_NS}：宿主按 entry id 投影表单，写错就"读不到这一节"`,
  )
  assert.match(patch, new RegExp(`name:\\s*'${PACKAGE}'`, 'u'))
})
