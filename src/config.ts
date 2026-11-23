import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/**
 * 插件配置。
 *
 * 只有一个字段：`allowedUsers`，默认空表，也就是**不碰认证**。认证边界不该在装上的一刻就改变
 * 这台机器的安全状态，所以"装了就生效"不是合适的默认值。
 *
 * 字段标了 `.volatile()`，这决定了配置从哪儿来、改了之后什么时候生效：
 *
 * - 设置服务（`dsh-settings`）只把 volatile 字段投影成表单，于是它们出现在侧边栏「插件」页里本插件
 *   那个包页的配置表单上；写入落进 profile 的 `cordis.patch.yml`（也可以直接编辑那份文件）。
 * - Loader 对"只有 volatile 字段变了"的更新**不重挂插件**：它把新值提交进运行中的引用，再向所属
 *   fiber 发一次 `loader/volatile-update`。所以配置是即时生效的，改完不必重启。
 *
 * 配置也**只有一个来源**：这份配置。环境变量那条路已经删掉，理由与代价见
 * `.agents/notes/implemented/architecture/2026-10-09-config-page-is-the-only-source.md`。
 */
export const Config = z.object({
  /**
   * 允许免掉浏览器会话校验的 Tailscale 登录名（例如 `alice@example.com`）。
   *
   * 精确匹配、不区分大小写；空表 = 不碰认证。名单外的访问不会被自动放行，但校验器只能"不认领"、
   * 不能否决：对方自己有有效的登录 cookie 时仍可能被放行。没带这个
   * 请求头的访问回落到原来的 token/cookie 校验。
   */
  allowedUsers: z.array(String).default([]).volatile(),
})

/**
 * 配置的宽松形态：loader 传进来的对象可能缺省这一项。
 *
 * 字段是 **volatile 引用**而不是裸值：值在插件运行期间会被就地更新（`.get()` 每次都读当前值）。
 * 在操作开始时读一次、把值捕获进这次操作，是这张类型面存在的唯一理由。
 */
export interface PluginConfig {
  allowedUsers?: Volatile<string[]>
}

/** 读一次配置得到的当前取值。 */
export interface ResolvedOptions {
  readonly allowedUsers: readonly string[]
}
