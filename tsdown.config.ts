/**
 * 构建配置：Host 端 + Web Client 端。
 *
 * Host 端沿用官方 Host 包的产物形状 —— 源码打成一个 ESM `lib/index.js`，包依赖全部保持外部
 * （`deps.neverBundle`），声明按源码模块输出到 `lib/types/`。
 *
 * Web Client 端另外出一份 `lib/client.js`，遵守 DSH 客户端模块系统的经典脚本契约：它用
 * `window.__ModuleLoader__.load({ id, factory })` 报名，交给工厂一个同步的 `require`（解析平台模块表
 * 里的模块）。产物因此是 `format: 'cjs'` 外面套三行 —— banner 开 `factory`、intro 备好 `module` /
 * `exports`、footer 把 `module.exports` 交回去。官方那套 preset（`packages/client/tsdown.client.ts`）
 * 只随 monorepo 发布，仓库之外 import 不到，因此这里复刻最小的那一份。
 *
 * 两端约定：客户端只 require 平台基线模块（`react` / `react/jsx-runtime` 与官方控件库
 * `@deepseek-ai/dsh-client-ui-primitives`），其余（本插件自己的代码）全部内联。客户端模块系统只服务
 * `<包名>/client.js` 这一条经典脚本，没有旁挂 `.css` 的路由，所以样式表在这里编译成文本内联进产物。
 */
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

import { defineConfig, type TsdownPlugin, type UserConfig } from 'tsdown'

const { name: PACKAGE } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { name: string }

/** tsdown 以包根为 cwd 求值配置；虚拟模块 id 用包根相对路径，免得产物里留下构建机的绝对路径。 */
const ROOT = process.cwd()

/**
 * 模块表里由宿主提供、本插件直接 `require` 的模块：平台基线里的 `react` 与 `react/jsx-runtime`，加上
 * 官方控件库。它们必须保持外部依赖——同一份实例由模块表提供；其余一律内联。
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** `?inline` 的虚拟模块前缀；结尾不能是 `.css`，否则会撞上 tsdown 自己的 CSS 管线。 */
const CSS_INLINE_VIRTUAL = '\0dsh-tailnet-admin-css-inline:'
const CSS_INLINE_SUFFIX = '.mjs'

/**
 * 把 `x.css?inline` 编译成 `export default "<文本>"`。
 *
 * 官方 preset 里那三个 `dsh-css-*` 加载器做的是同一件事，外加 lightningcss 编译与 CSS Modules 的类名
 * 映射。本插件只有一份手写、没有类名变换的样式表，因此这里只保留「读文件 → 导出文本」：CSS 仍然内联
 * 进产物，源码留在真正的 `.css` 文件里，编辑器认它。
 * @returns 处理 `?inline` 导入的 rolldown 插件。
 */
function cssInline(): TsdownPlugin {
  return {
    name: 'dsh-tailnet-admin-css-inline',
    resolveId(source, importer) {
      if (!source.endsWith('.css?inline')) return null
      const specifier = source.slice(0, -'?inline'.length)
      const file = importer === undefined ? resolve(specifier) : resolve(dirname(importer), specifier)
      const name = relative(ROOT, file).split(sep).join('/')
      return CSS_INLINE_VIRTUAL + name + CSS_INLINE_SUFFIX
    },
    load(id) {
      if (!id.startsWith(CSS_INLINE_VIRTUAL)) return null
      const name = id.slice(CSS_INLINE_VIRTUAL.length, -CSS_INLINE_SUFFIX.length)
      const file = resolve(ROOT, name)
      // 注册成 watch 依赖：`--watch` 下改 CSS 也要重打。
      this.addWatchFile(file)
      return `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`
    },
  }
}

const host: UserConfig = {
  name: `${PACKAGE}/host`,
  entry: { index: 'src/index.ts' },
  tsconfig: 'tsconfig.json',
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2023',
  dts: false,
  sourcemap: false,
  fixedExtension: false,
  // 三份配置共用 lib/，清理由 package.json 的 prebuild 统一做。
  clean: false,
  deps: { neverBundle: true },
  outputOptions: {
    entryFileNames: '[name].js',
  },
}

const types: UserConfig = {
  name: `${PACKAGE}/types`,
  // 逐模块出声明：`main` 指向的 lib/index.js 旁边要有 lib/types/index.d.ts。
  // 排除 Web Client 端：它的声明要 React 与 DOM，而这一份是给 Node 侧消费者读的。
  entry: ['src/**/*.ts', '!src/client/**'],
  tsconfig: 'tsconfig.json',
  outDir: 'lib/types',
  root: 'src',
  unbundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2023',
  dts: {
    emitDtsOnly: true,
    sourcemap: false,
  },
  sourcemap: false,
  fixedExtension: false,
  clean: false,
  deps: {
    neverBundle: true,
    dts: { neverBundle: true },
  },
}

const client: UserConfig = {
  name: `${PACKAGE}/client`,
  entry: { client: 'src/client/index.ts' },
  // Host 端的 tsconfig.json 把 src/client 排除在外（它没有 DOM 也没有 JSX），
  // 因此这里必须显式指到 Web Client 端自己的那份，否则 JSX / lib 都会按 Host 端的算。
  tsconfig: 'tsconfig.client.json',
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  dts: false,
  sourcemap: true,
  fixedExtension: false,
  // Host 端的 lib/index.js 也在同一个目录里，默认的 clean 会把它一起删掉。
  clean: false,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (specifier) => !(CLIENT_EXTERNALS as readonly string[]).includes(specifier),
  },
  plugins: [cssInline()],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default defineConfig([host, types, client])
