/**
 * dsh-tailnet-admin —— 把 Tailnet / 反向代理页面当作「本机」来用。
 *
 * 两个动作各自独立，默认都不做：
 *
 * ① `pageHosts`：往启动 HTML 的 `<head>` 注入一行脚本，把命中的页面标记成
 *    `globalThis.__DSH_TRANSPORT__ = { ownsHost: true }`。客户端的 `isLoopback` 只看这个标志位或
 *    `location.hostname` 是否回环，因此这一行决定了设置页（模型目录、凭据、配置文件编辑器）在
 *    非回环地址上能不能用。
 *
 * ② `disableBrowserAuth`：把宿主 `connection.browserAuth.isAuthenticated` 换成常量 true。
 *    **Host/Origin 栅栏不在其中**——它仍然只认回环或 `--trusted-host` 声明过的 authority。
 *
 * 为什么②默认关闭：这一改，能打开这个页面的人就等于拿到了这台机器的控制权。理由与代价写在
 * docs/internals.md 的决策地图里，别在这里重复。
 *
 * 两个开关都是 volatile 字段（见 config.ts）：配置从侧边栏「插件」页的配置表单或 profile 的
 * `cordis.patch.yml` 来；Loader 提交新值后**只发一次 `loader/volatile-update`、不重挂插件**，因此
 * 两个安装点都不能在启动时"算一次"——注入脚本每次渲染 index.html 时按当时的规则重算一行，认证旁路
 * 在事件到达时对齐。改开关不必重启。
 */
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

import { type AuthPatch, type ConnectionLike, disableBrowserAuth } from './browser-auth.ts'
import { Config, type PluginConfig } from './config.ts'
import type { ConnectionContext, HostContext } from './host.ts'
import { resolveOptions } from './options.ts'
import { buildPageScript } from './page-hosts.ts'

export const name = 'dsh-tailnet-admin'

export { Config }

/** 日志前缀：宿主把插件的 stdout 直接写进 dsh 的启动日志，前缀是唯一能把几轮刷新分开的线索。 */
const LOG_PREFIX = '[dsh-tailnet-admin]'

function log(message: string): void {
  try {
    console.info(`${LOG_PREFIX} ${message}`)
  } catch {
    // 日志失败不影响插件本身：它只写 stdout，没有别的副作用。
  }
}

/** 规则表在日志里的一行写法；空表说成"（空）"，免得留一段空白看不出所以然。 */
function rulesText(rules: readonly string[]): string {
  return rules.length === 0 ? '（空）' : rules.join(', ')
}

/**
 * 安装注入行。
 *
 * 订阅只注册一次，**每次渲染 index.html 都重读一遍规则**：规则表会因为配置更新而变，而重挂插件
 * 换不来这一行（volatile 更新不重挂）。读取是一次字符串拼接，渲染本身很少发生，这点开销不值一提。
 */
function installPageScript(ctx: HostContext, config: PluginConfig | undefined): void {
  const initial = resolveOptions(config).pageHosts
  log(initial.length === 0
    ? 'pageHosts 为空：不注入页面脚本（非回环页面仍会报 settings are unavailable in this browser）'
    : `已注册页面脚本，命中主机：${rulesText(initial)}`)
  ctx.on('webserver/index-inject', (table) => {
    const script = buildPageScript(resolveOptions(config).pageHosts)
    if (script === undefined) return
    const row: IndexInjection = { kind: 'script', placement: 'head', text: script }
    table.push(row)
  })
}

/**
 * 安装认证旁路。
 *
 * 放在 `ctx.inject` 里而不是 `apply` 的第一行：`connection` 服务由另一个插件提供，加载顺序不保证；
 * inject 会在它可用时回调。回调可能被执行不止一次（服务重建会重放），因此真正的幂等由
 * browser-auth.ts 的引用计数负责，这里只是"每次回调都重新拿一次当前的服务"。
 *
 * `sync()` 是唯一的写入口，三处调用它：拿到 connection 时（此时可能已经该关）、配置更新时、
 * 以及作用域销毁时反过来还原。开关两边都幂等：开着时不重复安装，关掉时把这一次安装还回去。
 *
 * @param ctx - 插件自己的上下文（`loader/volatile-update` 只发给这一层）。
 * @param config - loader 传入的配置。
 */
function installAuthBypass(ctx: HostContext, config: PluginConfig | undefined): void {
  let connection: ConnectionLike | undefined
  let patch: AuthPatch | undefined

  const sync = (): void => {
    if (resolveOptions(config).disableBrowserAuth) {
      if (patch !== undefined) return
      const next = disableBrowserAuth(connection)
      if (next === undefined) {
        log('没拿到 connection.browserAuth（形状不符或服务缺失）：认证保持原样')
        return
      }
      patch = next
      log(next.patched
        ? '已关闭浏览器会话校验（Host/Origin 栅栏仍在）；在配置页里关掉 disableBrowserAuth 即可即时恢复'
        : '浏览器会话校验此前已由本插件关闭，这次只加了引用计数')
      return
    }
    if (patch === undefined) return
    patch.restore()
    patch = undefined
    log('已恢复浏览器会话校验')
  }

  ctx.inject(['connection'], (connectionCtx: ConnectionContext) => {
    connection = connectionCtx.connection
    sync()
    connectionCtx.effect?.(() => () => {
      patch?.restore()
      patch = undefined
      connection = undefined
    }, 'dsh-tailnet-admin: restore browser auth')
  })

  ctx.on('loader/volatile-update', () => {
    sync()
  })

  if (!resolveOptions(config).disableBrowserAuth) log('disableBrowserAuth 关着：不碰浏览器会话校验')
}

/**
 * 插件入口。
 * @param ctx - 宿主上下文。
 * @param config - profile patch / 配置页写入的配置（可能缺省）。
 */
export function apply(ctx: HostContext, config?: PluginConfig): void {
  installPageScript(ctx, config)
  installAuthBypass(ctx, config)
  ctx.on('loader/volatile-update', () => {
    const now = resolveOptions(config)
    log(`配置已更新：pageHosts=${rulesText(now.pageHosts)}，disableBrowserAuth=${String(now.disableBrowserAuth)}`)
  })
}
