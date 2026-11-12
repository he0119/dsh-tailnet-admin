import type { Volatile } from '@deepseek-ai/cordis'

import { DEFAULT_PAGE_HOSTS, type PluginConfig, type ResolvedOptions } from './config.ts'

/**
 * 读一个 volatile 配置引用。
 *
 * 为什么需要它：配置字段不是裸值，而是 Loader 就地提交的引用（见 config.ts），读值必须走 `.get()`。
 * 引用缺席（`apply` 收到 `{}`）时给 `undefined`，由调用方按"没配置"处理。
 * @param field - loader 传进来的配置字段。
 * @returns 当前值；字段缺席时 undefined。
 */
export function readVolatile<T>(field: Volatile<T> | undefined): T | undefined {
  const candidate = field as { get?: () => T } | undefined
  return typeof candidate?.get === 'function' ? candidate.get() : undefined
}

/**
 * 规整规则表：去空白、转小写、丢掉空项与重复项（顺序保留）。
 *
 * `undefined` 与空表的含义不同：字段缺席用默认的 `.ts.net`，显式空表就是"一行都不注入"
 * （用户在配置页里清空并保存走的是后者）。
 */
export function normalizePageHosts(patterns: readonly string[] | undefined): string[] {
  if (patterns === undefined) return [...DEFAULT_PAGE_HOSTS]
  const rules: string[] = []
  for (const raw of patterns) {
    const rule = String(raw).trim().toLowerCase()
    if (rule !== '' && !rules.includes(rule)) rules.push(rule)
  }
  return rules
}

/**
 * 规整用户名单：去空白、转小写、丢掉空项与重复项（顺序保留）。
 *
 * 只做"能不能比较"，不判断"是不是一个真的登录名"：写错的条目匹配不到任何人，效果与没写一样。
 * 页面那边会在保存前挡住明显写不中的形状（见 src/client/rules.ts）。
 */
export function normalizeAllowedUsers(users: readonly string[] | undefined): string[] {
  const allowed: string[] = []
  for (const raw of users ?? []) {
    const login = String(raw).trim().toLowerCase()
    if (login !== '' && !allowed.includes(login)) allowed.push(login)
  }
  return allowed
}

/**
 * 读一次配置，得到当前生效的两项配置。
 *
 * 每次读都重新取值（见 readVolatile），因此"什么时候读"就是"哪一刻的配置"：调用点拿着这个结果
 * 完成一次操作，中途配置再变也不会把这次操作撕成两半。
 * @param config - loader 传入的插件配置（可能缺省）。
 * @returns 当前生效的取值。
 */
export function resolveOptions(config: PluginConfig | undefined): ResolvedOptions {
  return {
    pageHosts: normalizePageHosts(readVolatile(config?.pageHosts)),
    allowedUsers: normalizeAllowedUsers(readVolatile(config?.allowedUsers)),
  }
}
