/**
 * 配置页：插件列表里本插件那个包页上的设置。
 *
 * 只有两个控件，配方照着官方设置页来：外壳用官方 `SettingsForm`（读不到 / 只读的说明、保存按钮、
 * 保存失败的说明、离开页面丢掉草稿），两个字段自己画——`pageHosts` 是多行文本框（一行一条比单行逗号
 * 分隔好读），`disableBrowserAuth` 是开关（认证边界这种开关不该让人手打 `true`）。官方 `SettingsValueField`
 * 的私有类名抄不到，能抄的只有配方：字号、间距、描边、圆角都按它那份来（styles.css）。
 *
 * 官方表单**只在保存那一刻写**，因此"屏幕上是什么"就是"保存会写什么"。
 *
 * `disableBrowserAuth` 那一行是这一页唯一会让人付出代价的地方，提示与警告都常驻在控件下面，不做悬停
 * 才出现的那一套。
 *
 * @module dsh-tailnet-admin/client/Card
 */

import { Button, SettingsForm, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsFormActions, SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

import { FIELDS, type TailnetAdminCardState } from './form.ts'
import { fallbackTranslate, type Translate } from './locales.ts'

/** 表单字段名与草稿键是同一串字符串（rules.ts 的规格按它取字段）。 */
const [PAGE_HOSTS, DISABLE_BROWSER_AUTH] = FIELDS

/**
 * 渲染器递进来的 props：注册时 `inject` 返回的面（其中 `hooks.tailnetAdminCard` 已经变成
 * `useTailnetAdminCard` 选择器钩子），加上按 `locale: NS` 绑好的 `t`。
 *
 * `t` 在类型上可缺：渲染器一定会送，但首次渲染或测试里没有时也要能画——兜底是本插件自己那份中文，
 * 而不是空字符串。
 */
export interface TailnetAdminCardProps extends SettingsFormActions {
  readonly t?: Translate
  /** 表单投影的选择器钩子（由 `hooks.tailnetAdminCard` 而来）。 */
  readonly useTailnetAdminCard: <Selected>(select: (state: TailnetAdminCardState) => Selected) => Selected
}

/** 外壳那五句文案。 */
function formLabels(t: Translate): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

/**
 * 渲染这一页。
 * @param props - 注入面（快照钩子、表单动作）与字典。
 * @returns 配置页元素。
 */
export function TailnetAdminCard(props: TailnetAdminCardProps) {
  const t: Translate = typeof props.t === 'function' ? props.t : fallbackTranslate
  const state = props.useTailnetAdminCard((snapshot) => snapshot)
  // 读不到、不可写、保存中都不该再改草稿：两个控件吃同一个开关。
  const disabled = !state.available || !state.writable || state.saving

  /** 「已覆盖」徽章与恢复按钮：值来自用户层时才出现（与官方字段一致）。 */
  const overriddenControls = (field: string) => (
    <>
      <Tag tone="info">{t('overridden')}</Tag>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => {
          props.resetField(field)
        }}
      >
        {t('reset')}
      </Button>
    </>
  )

  return (
    <div data-dsh-tailnet-admin="">
      <SettingsForm
        labels={formLabels(t)}
        state={state}
        onSave={props.save}
        onDiscard={props.discard}
      >
        <div className="dta-field">
          <label className="dta-label" htmlFor="dta-page-hosts">{t('pageHostsLabel')}</label>
          <textarea
            id="dta-page-hosts"
            className="dta-input"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('pageHostsPlaceholder')}
            aria-invalid={state.pageHosts.invalid}
            disabled={disabled}
            value={state.pageHosts.text}
            onChange={(event) => {
              props.edit(PAGE_HOSTS, event.target.value)
            }}
          />
          <p
            className={state.pageHosts.invalid ? 'dta-invalid' : 'dta-hint'}
            role={state.pageHosts.invalid ? 'alert' : undefined}
          >
            {state.pageHosts.invalid ? t('pageHostsInvalid') : t('pageHostsHint')}
          </p>
          {state.pageHosts.overridden ? <div className="dta-meta">{overriddenControls(PAGE_HOSTS)}</div> : null}
        </div>

        <div className="dta-field">
          <div className="dta-head">
            <span className="dta-label">{t('disableAuthLabel')}</span>
            <div className="dta-meta">
              {state.disableBrowserAuth.overridden ? overriddenControls(DISABLE_BROWSER_AUTH) : null}
              <Switch
                checked={state.disableBrowserAuth.text === 'true'}
                label={t('disableAuthLabel')}
                disabled={disabled}
                onChange={(next) => {
                  props.edit(DISABLE_BROWSER_AUTH, next ? 'true' : 'false')
                }}
              />
            </div>
          </div>
          <p className="dta-warn">{t('disableAuthWarning')}</p>
          <p className="dta-hint">{t('disableAuthHint')}</p>
        </div>
      </SettingsForm>
    </div>
  )
}
