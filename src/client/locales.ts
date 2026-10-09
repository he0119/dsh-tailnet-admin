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
  pageHostsLabel: '按「本机」处理的页面主机',
  pageHostsHint: '一行一条：.ts.net 命中它的子域（不命中裸域名），dsh.example.com 精确匹配，* 命中所有主机。留空并保存 = 这条判定不注入。',
  pageHostsInvalid: '这几条注入脚本命不中任何主机：不要写 *.ts.net、协议、路径、端口、空格，也不要以点结尾。要整段后缀请写 .ts.net，要全部请写 *。',
  pageHostsPlaceholder: '.ts.net',
  disableAuthLabel: '关闭浏览器会话校验',
  disableAuthHint: '打开后不再要求 ?token= 换来的 cookie；Host/Origin 栅栏不受影响，仍只认回环或 --trusted-host 声明过的地址。',
  disableAuthWarning: '打开它等于把这台机器的控制权交给任何能打开这个页面的人：读写文件、执行命令、动用已配置的 API key。确认 Tailscale ACL / 反代的访问控制之后再用。',
  overridden: '已覆盖',
  reset: '恢复默认',
  save: '保存',
  saving: '保存中…',
  saveFailed: '宿主没有接受这些值，草稿留着，改完再存一次。',
  readOnly: '这份设置写不进宿主文档：页面没有被当作「本机」时（pageHosts 还没命中这个主机名）改动只留在浏览器里。',
  unavailable: '这一份设置现在读不到：宿主没有把 tailnet-admin 那一段服务给这个页面。',
} as const

export const en: Record<keyof typeof zh, string> = {
  pageHostsLabel: 'Page hosts treated as this machine',
  pageHostsHint: 'One per line: .ts.net matches its subdomains (not the bare domain), dsh.example.com matches exactly, * matches everything. Save with the box empty to inject nothing.',
  pageHostsInvalid: 'These rules cannot match any host: no *.ts.net, scheme, path, port, spaces, or trailing dot. Write .ts.net for a whole suffix, or * for everything.',
  pageHostsPlaceholder: '.ts.net',
  disableAuthLabel: 'Skip the browser session check',
  disableAuthHint: 'Stops requiring the cookie a ?token= exchange produces. The Host/Origin fence is untouched: it still accepts only loopback or an authority declared with --trusted-host.',
  disableAuthWarning: 'Turning this on hands control of this machine to anyone who can open the page: reading and writing files, running commands, spending configured API keys. Make sure the Tailscale ACL or reverse proxy is what decides who reaches it.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The Host did not accept these values; the draft is kept so you can correct it.',
  readOnly: 'These settings are not written to the Host document: while the page is not treated as this machine (pageHosts does not match this hostname) they stay in this browser only.',
  unavailable: 'These settings cannot be read right now: the Host is not serving the tailnet-admin section to this page.',
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
