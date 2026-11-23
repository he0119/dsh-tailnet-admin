/**
 * 字段草稿的换算与校验。
 *
 * 单独一个 React-free 的模块，因为它是配置页上唯一有判断的地方：字段是字符串数组，而官方设置表单按
 * 「草稿文本」组织，中间这层换算决定了"用户写完按保存"到底写进什么，以及**哪些写法当场挡住**。
 *
 * 为什么在这里挡：用户名单的匹配只有一种——转小写后整串相等。名单里写通配符、逗号、显示名或非 ASCII
 * 都永远命不中；现象是"名单里的人还是进不来"，跟没写一样的沉默。页面是唯一能在写之前说话的地方，
 * 因此把命不中的写法判成 invalid（挡下保存），而不是写进去再让宿主忽略它。
 *
 * 换算只做"文本 ↔ 值"，不改用户写的东西：大小写与前后空白由宿主在读取配置时规整（options.ts 的
 * `normalizeAllowedUsers`），页面里显示的就是配置里存的那一份。
 *
 * @module dsh-tailnet-admin/client/rules
 */

import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

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
 * 把草稿文本切成用户名单。
 *
 * 按行切，同时也认逗号——README 与 `--patch` 的示例里都是逗号分隔，从那儿抄一行过来不该被当成一条
 * 命不中的规则。空白与空项丢掉；一条都不剩时给空数组（= 不碰认证，见 {@link allowedUsersField}）。
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
