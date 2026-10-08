/**
 * 插件展示元信息的格式契约：插件列表里那一行的标题与描述从哪儿来。
 *
 * 宿主**不激活插件**就读这两个文件：`dsh-app-boot` 的 `readPluginMeta()` 先用 Node 的 ESM 解析器解析
 * `<包名>/locale/en.json`，解析不到就一个字典都不读（其余语言是把 `en.json` 所在目录 readdir 出来的），
 * 标题随即沿 `locale meta.title` → `package.json.name` → 完整 Cordis 插件名 逐级回退。于是「忘了导出」
 * 没有报错，只有现象：插件列表里那一行的标题静默变成 `@he0119/dsh-tailnet-admin`（设置页的清单还会剥掉
 * npm scope，显示成 `tailnet-admin`），而描述因为 `package.json.description` 本来就是中文，看着正常。
 *
 * 这里钉四件事，都是上面那条链上会静默失败的地方：
 *   1) `locale/en.json` 在——它是唯一的发现入口，缺了它中文标题也一起没有；
 *   2) 每个语言文件名都是一个语言 id（宿主拿文件名当语言键，形状不对它直接抛诊断）；
 *   3) 各语言的 `meta` 键集与 `en.json` 一致——字段缺失允许，但「中文少写一句描述」要在这里红；
 *   4) `package.json` 的 `exports` 与 `files` 真的把 `locale/*.json` 放出去了——少任何一条，上面的文件
 *      在安装后都解析不到，第 1~3 条却照样是绿的。第 4 条不查字面量，直接问 Node 的解析器要一次。
 *
 * @module dsh-tailnet-admin/test/locale
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LOCALE_DIR = join(ROOT, 'locale')

/** 宿主对语言文件名的判据（`dsh-app-boot` 的 `LANGUAGE_ID`），文件名就是语言键。 */
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u

/** 展示元信息里现在用的两个字段；两份语言文件必须各有一份。 */
const FIELDS = ['title', 'description'] as const

interface Dictionary {
  /** 文件名去掉 `.json`，也就是宿主读取时用的语言键。 */
  readonly language: string
  /** 相对仓库根，报错时指得清楚。 */
  readonly file: string
  /** 解析后的内容。 */
  readonly parsed: { readonly meta?: Record<string, unknown> }
  /** Node 的 ESM 解析器给出的路径；`exports` 没放行时是报错的文本，留给第 4 条断言说清楚。 */
  readonly resolved: string
}

/** `exports` 没放行时的解析结果不能当场抛出：前三条测的是文件本身，先让它们各自报到。 */
function resolveOrDiagnose(resource: string): string {
  try {
    return import.meta.resolve(resource)
  } catch (error) {
    return `<解析失败：${(error as { code?: string }).code ?? String(error)}>`
  }
}

/** `locale/` 下的语言文件，按文件名排序。 */
function dictionaries(): Dictionary[] {
  assert.ok(existsSync(LOCALE_DIR), '缺 locale/ 目录：宿主读不到任何展示元信息，标题会回退成包名')
  return readdirSync(LOCALE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const language = name.slice(0, -'.json'.length)
      return {
        language,
        file: `locale/${name}`,
        parsed: JSON.parse(readFileSync(join(LOCALE_DIR, name), 'utf8')) as Dictionary['parsed'],
        resolved: resolveOrDiagnose(`@he0119/dsh-tailnet-admin/locale/${name}`),
      }
    })
}

test('locale：en.json 是发现入口，每个语言文件名都是一个语言 id', () => {
  const entries = dictionaries()
  assert.ok(
    entries.some((entry) => entry.language === 'en'),
    '缺 locale/en.json：宿主只在解析到它时才去 readdir 同目录的其它语言，中文标题会跟着一起消失',
  )
  for (const entry of entries) {
    assert.match(entry.language, LANGUAGE_ID, `${entry.file}：文件名应当是语言 id，如 zh.json / zh-CN.json`)
  }
})

test('locale：meta.title 与 meta.description 是非空字符串，各语言键集一致', () => {
  const entries = dictionaries()
  const english = entries.find((entry) => entry.language === 'en')
  assert.ok(english !== undefined, '缺 locale/en.json，无从比对键集')
  const keysOf = (entry: Dictionary) => Object.keys(entry.parsed.meta ?? {}).sort()

  for (const entry of entries) {
    assert.equal(typeof entry.parsed.meta, 'object', `${entry.file}：缺 meta 对象`)
    for (const field of FIELDS) {
      const value = entry.parsed.meta?.[field]
      assert.equal(typeof value, 'string', `${entry.file}：meta.${field} 应当是字符串`)
      assert.notEqual(
        (value as string).trim(),
        '',
        `${entry.file}：meta.${field} 不能是空串——宿主把空串当非空字符串，会原样显示成空白`,
      )
    }
    assert.deepEqual(
      keysOf(entry),
      keysOf(english),
      `${entry.file}：meta 的键集要与 locale/en.json 一致（中英两份都要有标题和描述）`,
    )
  }
})

test('locale：package.json 真的把 locale/*.json 导出并发布，宿主解析得到', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    readonly exports?: Record<string, unknown>
    readonly files?: readonly string[]
  }

  for (const entry of dictionaries()) {
    assert.equal(
      entry.resolved,
      pathToFileURL(join(LOCALE_DIR, entry.file.slice('locale/'.length))).href,
      `${entry.file}：宿主按 <包名>/locale/<语言>.json 解析，拿到别的路径等于读不到`,
    )
  }
  assert.ok(
    existsSync(join(LOCALE_DIR, 'en.json')),
    'en.json 必须在：其余语言是 readdir 它所在目录出来的，宿主不会主动去找 zh.json',
  )
  assert.equal(
    pkg.exports?.['./locale/*.json'],
    './locale/*.json',
    'exports 里缺 "./locale/*.json"：宿主的 ESM 解析器拿到的是 ERR_PACKAGE_PATH_NOT_EXPORTED，' +
      '它会当成「这个包没有 locale 目录」静默回退成包名',
  )
  assert.ok(
    (pkg.files ?? []).some((entry) => entry === 'locale/*.json' || entry === 'locale'),
    'files 里缺 locale：本机测试读得到源码目录，装进 profile 之后那两个文件根本不在包里',
  )
})
