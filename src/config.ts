import z from '@deepseek-ai/schemastery'

/**
 * 插件配置。
 *
 * **两个开关默认都是"什么都不做"**：不注入页面脚本、不碰浏览器认证。把有副作用的开关留给使用者显式
 * 打开 —— 这是一个会动到认证边界的插件，"装了就生效"不是合适的默认值。配置写在 profile 的
 * `cordis.patch.yml` 里（见本包根目录那份的注释），也可以用环境变量给（环境变量优先，见 options.ts）。
 */
export const Config = z.object({
  /**
   * 哪些页面主机按「本机」处理。
   *
   * - `.ts.net`：后缀匹配（点开头即后缀）
   * - `dsh.example.com`：精确匹配
   * - `*`：所有主机（等于放弃这条判定的隔离作用）
   */
  pageHosts: z.array(String).default([]),
  /** 是否关闭浏览器会话校验（token/cookie）；**默认 false**：保留认证。 */
  disableBrowserAuth: z.boolean().default(false),
})

/** 配置的宽松形态：loader 传进来的对象可能缺省任意一项。 */
export interface PluginConfig {
  pageHosts?: readonly string[]
  disableBrowserAuth?: boolean
}

/** 环境变量覆盖配置之后的最终取值。 */
export interface ResolvedOptions {
  readonly pageHosts: readonly string[]
  readonly disableBrowserAuth: boolean
}
