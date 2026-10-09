/**
 * 配置页的草稿模型：把宿主递进来的这一节设置接到官方设置表单模型上。
 *
 * 这一层的分工（与官方「设置卡片」那一套一致）：
 *
 * - **读**：`configForms.get(SETTINGS_NS)` 给出这一节的快照（生效值 / 组合层 / 用户层 / revision）与
 *   唯一的写入口 `mutate`，它自己订阅宿主文档的变化。
 * - **草稿**：`SettingsFormModel` 拿字段规格（rules.ts）把值换算成草稿文本，并记住"哪些字段已覆盖"、
 *   "这次保存会写什么"、"有没有不该保存的草稿"。
 * - **写**：只在保存那一刻发生，一次 `mutate` 带上 revision 围栏（别处改过就拒绝，而不是覆盖别人）。
 *
 * 页面只读模型投影出来的快照，不自己存一份值。
 *
 * @module dsh-tailnet-admin/client/form
 */

import { SettingsFormModel } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SettingsFieldState,
  SettingsFormActions,
  SettingsFormScope,
  SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

import { booleanField, pageHostsField } from './rules.ts'

/**
 * 设置命名空间。
 *
 * 它同时是两件事，且两者必须一致：profile 组合里这一行的 **entry id**（本包 cordis.patch.yml 的
 * `id: tailnet-admin`），以及 `cordis.patch.yml` 里写配置那一行的 `id`。宿主按 entry id 投影表单，
 * 所以写错这里的表现是"页面读不到这一节"。
 */
export const SETTINGS_NS = 'tailnet-admin'

/** 这一页编辑的两个字段（插件没有第三个配置项）。 */
export const FIELDS = Object.freeze(['pageHosts', 'disableBrowserAuth'] as const)

/** 这一段设置里这一页读写的形状。 */
export interface TailnetAdminSettings {
  pageHosts?: string[]
  disableBrowserAuth?: boolean
}

/** 页面渲染需要的投影：表单外壳状态 + 两个字段各自的草稿状态。 */
export interface TailnetAdminCardState extends SettingsFormShell {
  pageHosts: SettingsFieldState
  disableBrowserAuth: SettingsFieldState
}

/**
 * 快照来源：注册时交出去的 `hooks`，渲染器按它的名字造出 `useTailnetAdminCard` 选择器钩子。
 *
 * 只声明选择器钩子真正要用的两面（`getSnapshot` / `subscribe`），不把 `SnapshotStore` 的写面写进类型：
 * 页面拿到的确实是官方的 `SnapshotStore`（`SettingsFormModel.bind()` 的返回值），但页面只读它。
 */
export interface CardSource {
  getSnapshot(): TailnetAdminCardState
  subscribe(listener: () => void): () => void
}

/** 注入面：快照来源加表单动作。 */
export interface TailnetAdminCardFace extends SettingsFormActions {
  hooks: { tailnetAdminCard: CardSource }
}

/**
 * 服务缺席时的替身。
 *
 * `configForms` 在本插件的 `inject` 里（它是设置接缝，缺席时整页都不装），因此这只是"接缝被换掉"
 * 时的兜底：读快照永远给 `unavailable`，写入一律回绝——没有服务时没有任何东西能接受它，官方表单
 * 自己会画那句"读不到"。
 */
export const UNSERVED: SettingsFormScope<TailnetAdminSettings> = Object.freeze({
  getSnapshot: () => ({
    status: 'unavailable' as const,
    value: undefined,
    base: undefined,
    user: undefined,
    writable: false,
    revision: undefined,
  }),
  subscribe: () => () => {},
  mutate: async () => false,
})

/**
 * 建这一页的草稿模型。
 * @param scope - 设置命名空间的读写面（或 {@link UNSERVED}）。
 * @returns 模型；它自己订阅 `scope`，用完要 `dispose()`。
 */
export function createCardForm(
  scope: SettingsFormScope<TailnetAdminSettings>,
): SettingsFormModel<TailnetAdminSettings> {
  return new SettingsFormModel<TailnetAdminSettings>(scope, [
    pageHostsField(FIELDS[0]),
    booleanField(FIELDS[1]),
  ])
}

/**
 * 把模型的投影绑成注册时交出去的快照来源。
 * @param form - 草稿模型。
 * @returns 页面读的快照来源。
 */
export function bindCard(form: SettingsFormModel<TailnetAdminSettings>): CardSource {
  return form.bind(() => ({
    ...form.shell(),
    pageHosts: form.field(FIELDS[0]),
    disableBrowserAuth: form.field(FIELDS[1]),
  }))
}

/**
 * 组装注册时交给渲染器的注入面。
 * @param form - 草稿模型。
 * @param card - 绑定好的快照来源。
 * @returns 注册用的面。
 */
export function cardFace(
  form: SettingsFormModel<TailnetAdminSettings>,
  card: CardSource,
): TailnetAdminCardFace {
  const actions = form.actions()
  return {
    hooks: { tailnetAdminCard: card },
    edit: actions.edit,
    resetField: actions.resetField,
    discard: actions.discard,
    save: actions.save,
  }
}
