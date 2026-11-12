/**
 * 本插件的字典：两份语言、命名空间，以及没有注入 `t` 时用的兜底。
 *
 * 命名空间在这里声明（`LocaleNamespaceMap` 的那一处 merge）：`ctx.locale.register(NS, { zh, en })`
 * 因此按 `zh` 的键集校验两份字典——少一个键、多一个键都是编译错误，双语必须一次交齐；配置页注册时
 * 的 `locale: NS` 也才认得它。注意它与 `locale/*.json` 不是一回事：那两份文件是**插件列表里那一行**
 * 的标题与描述（宿主不激活插件就读它们，见 docs/internals.md），这里的是页面运行时读的文案。
 *
 * @module dsh-tailnet-admin/client/locales
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

/** 页面文案的命名空间。 */
export const NS = 'settings.tailnetAdmin'

export const zh = {
  configTitle: '配置',
  configNote: '改完点保存，立即生效，不用重启',
  pageHostsLabel: '设置页可用的域名',
  pageHostsHint: '默认 .ts.net，Tailnet 地址一般不用改；只有自定义域名或反向代理才需要加。留空保存 = 不启用。',
  pageHostsInvalid: '这些写法匹配不到任何域名。不要写 *.ts.net、协议、路径、端口；整段后缀写 .ts.net，全部写 *。',
  pageHostsPlaceholder: 'dsh.example.com',
  allowedUsersLabel: '不用 token 的 Tailscale 用户',
  allowedUsersHint: '一行一个 Tailscale 登录名，比如 alice@example.com（不是设备名）。只对经过 tailscale serve 的访问生效；留空 = 不启用。',
  allowedUsersInvalid: '这些写法匹配不到任何账号。写完整的 Tailscale 登录名，不要写显示名、空格、逗号或通配符。',
  allowedUsersPlaceholder: 'alice@example.com',
  allowedUsersWarning: '名单里的人打开页面就能操作这台机器：读写文件、执行命令、用你的 API key。只填信任的账号；DSH 必须只监听 127.0.0.1，否则登录名可以被伪造。',
  overridden: '已覆盖',
  reset: '恢复默认',
  save: '保存',
  saving: '保存中…',
  saveFailed: 'DSH 没有接受这些值，草稿还在，改完再保存一次。',
  readOnly: '这个页面现在只写进这个浏览器，改动不会进 DSH。先从本机地址打开一次，或直接改 profile 文件。',
  unavailable: '读不到这一节：DSH 没有把这一段配置交给页面。',
} as const

export const en: Record<keyof typeof zh, string> = {
  configTitle: 'Configuration',
  configNote: 'Save applies changes immediately; no restart needed',
  pageHostsLabel: 'Domains where settings work',
  pageHostsHint: 'Defaults to .ts.net, which covers most Tailnet addresses. Add a custom domain or reverse proxy only when needed. Save an empty box to turn this off.',
  pageHostsInvalid: 'These cannot match any host. No *.ts.net, scheme, path, port, or trailing dot; write .ts.net for a whole suffix, or * for everything.',
  pageHostsPlaceholder: 'dsh.example.com',
  allowedUsersLabel: 'Tailscale users without a token',
  allowedUsersHint: 'One Tailscale login per line, for example alice@example.com (not a device name). Only requests through tailscale serve are affected. Save an empty box to turn this off.',
  allowedUsersInvalid: 'These cannot match any user. Write the full Tailscale login name; no display names, spaces, commas, or wildcards.',
  allowedUsersPlaceholder: 'alice@example.com',
  allowedUsersWarning: 'Anyone on this list can control this machine once they open the page: read and write files, run commands, and use your API keys. Only add people you trust. DSH must listen on 127.0.0.1 only, or the login name can be forged.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'DSH did not accept these values; the draft is kept so you can correct it.',
  readOnly: 'This page can only save to this browser; changes do not reach DSH. Open DSH over a loopback address once, or edit the profile file directly.',
  unavailable: 'Cannot read this section: DSH is not serving it to this page.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件配置页的文案。 */
    'settings.tailnetAdmin': keyof typeof zh
  }
}

/** 注入面递进来的翻译函数（注册时声明了 `locale: NS`）。 */
export type Translate = TranslateNS<typeof NS>

/**
 * 没有注入 `t` 时的兜底：按中文直出。
 *
 * 只在测试与首次渲染里走到——渲染器按注册时的 `locale: NS` 送 `t`。这里刻意不静默换语言，兜底就是
 * 本插件自己那份中文；键不在本字典里（宿主的 `common` 词汇）时原样露出键名，而不是编一个词。
 * @param key - 字典键（或宿主 `common` 的键）。
 * @returns 该键的中文文案。
 */
export function fallbackTranslate(key: Parameters<Translate>[0]): string {
  return key in zh ? zh[key as keyof typeof zh] : key
}
