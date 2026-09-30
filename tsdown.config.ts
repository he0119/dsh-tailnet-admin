/**
 * 构建配置：只剩 Host 端。
 *
 * 产物形状跟官方 Host 包一致 —— 源码打成一个 ESM `lib/index.js`，包依赖全部保持外部
 * （`deps.neverBundle`），声明按源码模块输出到 `lib/types/`。本插件没有 Web Client 端：
 * 它不做界面，只往启动 HTML 里注入一行脚本、再改一个宿主服务的判定函数，所以也没有
 * `lib/client.js` 与 `dsh.client` 那一套经典脚本契约。
 */
import { readFileSync } from 'node:fs'

import { defineConfig, type UserConfig } from 'tsdown'

const { name: PACKAGE } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { name: string }

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
  // 两端（host 与 types）共用 lib/，清理由 package.json 的 prebuild 统一做。
  clean: false,
  deps: { neverBundle: true },
  outputOptions: {
    entryFileNames: '[name].js',
  },
}

const types: UserConfig = {
  name: `${PACKAGE}/types`,
  // 逐模块出声明：`main` 指向的 lib/index.js 旁边要有 lib/types/index.d.ts。
  entry: ['src/**/*.ts'],
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

export default defineConfig([host, types])
