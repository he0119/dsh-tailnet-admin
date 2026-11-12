/**
 * 字段草稿的换算与校验。
 *
 * 单独一个 React-free 的模块，因为它是配置页上唯一有判断的地方：两个字段都是字符串数组，而官方设置
 * 表单按「草稿文本」组织，中间这层换算决定了"用户写完按保存"到底写进什么，以及**哪些写法当场挡住**。
 *
 * 为什么在这里挡：注入脚本的主机匹配只有三种写法（见 page-hosts.ts 的 `pageHostMatches`）——`*`、点开头
 * 的后缀、精确主机名；用户名单的匹配只有一种——转小写后整串相等。`*.ts.net` 这种主机写法在配置文件里
 * 也合法，但**永远命不中任何主机**；名单里写通配符或显示名同样永远不会命中。于是现象是"设置页还是
 * 不可用"或"名单里的人还是进不来"，跟没写一样的沉默。页面是唯一能在写之前说话的地方，因此把命不中的
 * 写法判成 invalid（挡下保存），而不是写进去再让宿主忽略它。
 *
 * 换算只做"文本 ↔ 值"，不改用户写的东西：大小写与前后空白由宿主在读取配置时规整（options.ts 的
 * `normalizePageHosts` / `normalizeAllowedUsers`），页面里显示的就是配置里存的那一份。
 *
 * @module dsh-tailnet-admin/client/rules
 */

import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * 一条主机规则是不是注入脚本真的能命中的写法。
 *
 * 与 `pageHostMatches` 一一对应：`*` 命中一切；`.` 开头是子域边界后缀（要求后面还有内容）；其余按精确
 * 主机名比较。因此下面这些都命不中，当场判为不可用：`*` 混在别处（`*.ts.net`）、协议或路径（`https://a`）、
 * 端口（`a:3080`）、空白、空串、只有点或以点结尾（`location.hostname` 从不带结尾的点）。
 *
 * 同时挡住 `..`：那种主机名不存在，写出来只会静默不命中。
 * @param rule - 已去空白的单条规则。
 * @returns 这条规则是否可能命中某个页面主机名。
 */
export function isUsablePageHost(rule: string): boolean {
  if (rule === '*') return true
  if (rule === '' || rule.includes('*') || rule.includes('..')) return false
  if (rule.endsWith('.')) return false
  if (/[\s/:?#@[\]\\]/u.test(rule)) return false
  return rule.replace(/^\./u, '') !== ''
}

/**
 * 一条登录名是不是名单能真的用上的写法。
 *
 * 匹配是「转小写后整串相等」，没有通配符，也没有显示名。因此：空白（登录名里不会有）、逗号（草稿的
 * 分隔符）、`*`（不是通配符）、非 ASCII（Tailscale 对这类值做 RFC2047 编码，整串对不上）都判为不可用。
 * 允许的可打印字符包括邮箱会用到的一切：字母、数字、`@ . + _ -`。
 * @param user - 已去空白的单条登录名。
 * @returns 这条登录名是否可能匹配某个用户。
 */
export function isUsableAllowedUser(user: string): boolean {
  if (user === '' || user.includes('*') || user.includes(',')) return false
  return /^[\x21-\x7e]+$/u.test(user)
}

/**
 * 把草稿文本切成规则表。
 *
 * 按行切，同时也认逗号——README 与 `--patch` 的示例里都是逗号分隔，从那儿抄一行过来不该被当成一条
 * 命不中的规则。空白与空项丢掉；一条都不剩时给空数组（= 显式不注入，见 {@link pageHostsField}）。
 * @param text - 草稿文本。
 * @returns 规整到"没有空项"的规则表。
 */
export function splitPageHostsDraft(text: string): string[] {
  return text
    .split(/[\n,]/u)
    .map((rule) => rule.trim())
    .filter((rule) => rule !== '')
}

/**
 * 把草稿文本切成用户名单。
 *
 * 与规则表同一套切法（换行或逗号、去空白、丢空项）。
 * @param text - 草稿文本。
 * @returns 规整到"没有空项"的登录名列表。
 */
export function splitAllowedUsersDraft(text: string): string[] {
  return text
    .split(/[\n,]/u)
    .map((user) => user.trim())
    .filter((user) => user !== '')
}

/**
 * 规则表字段的换算规格。
 *
 * - 值 → 文本：一行一条。
 * - 文本 → 写入：全是能命中的规则就整表写进用户层；一条都不剩就写一个**显式空表**（= 不注入）——
 *   注意这与"把这一项从用户层去掉"不同，后者会回落到 schema 默认的 `.ts.net`；只要有一条命不中就给
 *   `undefined`，官方表单据此判 invalid 并挡住保存。
 * @param field - 命名空间里的字段名。
 * @returns 该字段的换算规格。
 */
export function pageHostsField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (Array.isArray(value) ? value.map((item) => String(item)).join('\n') : ''),
    parse: (text) => {
      const rules = splitPageHostsDraft(text)
      if (rules.length === 0) return { kind: 'set', value: [] }
      return rules.every(isUsablePageHost) ? { kind: 'set', value: rules } : undefined
    },
  }
}

/**
 * 用户名单字段的换算规格。
 *
 * - 值 → 文本：一行一条。
 * - 文本 → 写入：全是能命中的登录名就整表写进用户层；一条都不剩就 `clear`（回落到默认空表 = 不碰认证）；
 *   只要有一条命不中就给 `undefined`，挡住保存。
 * @param field - 命名空间里的字段名。
 * @returns 该字段的换算规格。
 */
export function allowedUsersField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (Array.isArray(value) ? value.map((item) => String(item)).join('\n') : ''),
    parse: (text) => {
      const users = splitAllowedUsersDraft(text)
      if (users.length === 0) return { kind: 'clear' }
      return users.every(isUsableAllowedUser) ? { kind: 'set', value: users } : undefined
    },
  }
}
