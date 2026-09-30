import type { PluginConfig, ResolvedOptions } from './config.ts'

/** 环境变量名（README 的开关表与这里必须逐字一致）。 */
export const ENV_PAGE_HOSTS = 'DSH_TAILNET_ADMIN_PAGE_HOSTS'
export const ENV_DISABLE_AUTH = 'DSH_TAILNET_ADMIN_DISABLE_AUTH'

/**
 * 算作"开"的词表。
 *
 * 刻意**只认这几个**：写错的值（`ture`、`enable`）一律按"没开"处理。反向那种"只要不是 false 就算开"
 * 的解析会把一个手滑变成"关掉认证"，而这个开关的代价不是重跑一次就能挽回的。
 */
const TRUE_WORDS = new Set(['1', 'true', 'on', 'yes'])

/** 规整规则表：去空白、转小写、丢掉空项与重复项（顺序保留）。 */
export function normalizePageHosts(patterns: readonly string[] | undefined): string[] {
  const rules: string[] = []
  for (const raw of patterns ?? []) {
    const rule = String(raw).trim().toLowerCase()
    if (rule !== '' && !rules.includes(rule)) rules.push(rule)
  }
  return rules
}

/** 解析逗号分隔的页面主机表；环境变量未设置时返回 undefined（= 不覆盖配置）。 */
export function parsePageHostsEnv(value: string | undefined): string[] | undefined {
  return value === undefined ? undefined : normalizePageHosts(value.split(','))
}

/** 解析布尔开关；只认 TRUE_WORDS 里的写法，其余（含空串、缺省）一律 false。 */
export function parseDisableAuthEnv(value: string | undefined): boolean {
  return value !== undefined && TRUE_WORDS.has(value.trim().toLowerCase())
}

/**
 * 合并配置与环境变量：**环境变量优先**。
 *
 * 环境变量放在 systemd unit 这类运维位置、改 profile 重装时不会被动到；配置放在 profile 的 patch 里、
 * 跟着插件配置走。两者都支持，冲突时以环境变量为准。
 * @param config - loader 传入的插件配置（可能缺省）。
 * @param env - 进程环境（测试里传假对象）。
 * @returns 最终生效的开关。
 */
export function resolveOptions(
  config: PluginConfig | undefined,
  env: Readonly<Record<string, string | undefined>>,
): ResolvedOptions {
  const fromEnv = parsePageHostsEnv(env[ENV_PAGE_HOSTS])
  return {
    pageHosts: fromEnv ?? normalizePageHosts(config?.pageHosts),
    disableBrowserAuth: parseDisableAuthEnv(env[ENV_DISABLE_AUTH]) || config?.disableBrowserAuth === true,
  }
}
