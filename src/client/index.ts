/**
 * `dsh-tailnet-admin` 的 Web Client 端：把两个开关做成「插件」页上本插件那个包页的配置表单。
 *
 * 注册进 `plugins.bundle.config`（键是包名 `@he0119/dsh-tailnet-admin`）：官方插件管理页把这一份贡献
 * 画在本插件那张包页的描述与行列表之间，于是"点开插件列表里的本插件就是配置页"，不用再多一层行详情。
 * 没有选 `plugins.row.config`（本插件只有一行，键会多出一个 `#tailnet-admin` 且要多点一次），也没有选
 * `settings.section`（那是设置导航里的一页，本插件的配置属于插件本身，不属于全局设置）。
 *
 * 页主对包级配置**只递 `view: 'page'`、不递 `form`**（递 `form` 的是行级与条目级），因此这一页的读写
 * 面是自己按设置命名空间向 `configForms` 要的；命名空间必须与 profile 里那一行的 entry id 一致
 * （见 form.ts 的 `SETTINGS_NS`）。
 *
 * 运行时只 require 平台基线里的模块（`react` / `react/jsx-runtime` 与
 * `@deepseek-ai/dsh-client-ui-primitives`）：下面那些 `import type {}` 只取服务声明与槽位契约，是
 * 类型面的 import，产物里一个 require 都不会多。产物 `lib/client.js` 由 `pnpm run build` 打出，是一段
 * 用 `window.__ModuleLoader__.load({ id, factory })` 报名的经典脚本。
 *
 * `apply` 必须保持同步：宿主 Cordis 会卸载 async apply 里 `await` 之后注册的 `ctx.effect`。
 *
 * @module dsh-tailnet-admin/client
 */

// 只取服务声明（cordis 的 Context 增强）与槽位契约，不产生运行时 require：这些都是服务提供方，
// 它们的 Web Client 模块由宿主的模块图按行装，不由本模块 require。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'

import { TailnetAdminCard } from './Card.tsx'
import { bindCard, cardFace, createCardForm, SETTINGS_NS, UNSERVED } from './form.ts'
import { en, NS, zh } from './locales.ts'
import { installStyles } from './styles.ts'

/** 客户端模块系统里的模块 id，等于包名；也是包级配置槽位的键。 */
export const PACKAGE = '@he0119/dsh-tailnet-admin'

/** 插件名（模块加载器按它对账）。 */
export const name = PACKAGE

/** 依赖的客户端服务：槽位、字典，以及设置接缝的配置表单。 */
export const inject = ['slots', 'locale', 'configForms']

/**
 * 客户端插件入口。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tailnet-admin: dictionaries')
  ctx.effect(() => installStyles(), 'dsh-tailnet-admin: stylesheet')

  // 设置接缝：`configForms` 已经在本插件的 `inject` 里，这里的兜底只为"接缝被换掉"时不至于整页装不上。
  const form = createCardForm(ctx.configForms === undefined ? UNSERVED : ctx.configForms.get(SETTINGS_NS))
  const card = bindCard(form)
  ctx.effect(() => () => {
    form.dispose()
  }, 'dsh-tailnet-admin: settings form')

  // `inject` 而不是直接 register：`plugins.bundle.config` 由插件管理页在运行时声明，那个声明完全可能
  // 晚于本插件 apply，直接注册会撞上"槽位尚未声明"。
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: PACKAGE,
    locale: NS,
    inject: () => cardFace(form, card),
  }, TailnetAdminCard))
}
