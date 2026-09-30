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
 * docs/internals.md，别在这里重复。
 */
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

import { disableBrowserAuth, type ConnectionLike } from './browser-auth.ts'
import { Config, type PluginConfig } from './config.ts'
import type { ConnectionContext, HostContext } from './host.ts'
import { resolveOptions } from './options.ts'
import { buildPageScript } from './page-hosts.ts'

export const name = 'dsh-tailnet-admin'

export { Config }

/** 日志前缀：宿主把插件的 stdout 直接写进 dsh 的启动日志，前缀是唯一能把两轮刷新分开的线索。 */
const LOG_PREFIX = '[dsh-tailnet-admin]'

function log(message: string): void {
  try {
    console.info(`${LOG_PREFIX} ${message}`)
  } catch {
    // 日志失败不影响插件本身：它只写 stdout，没有别的副作用。
  }
}

/**
 * 组装注入行。
 *
 * 每次渲染 index.html 都会重新问一遍订阅方，因此这里持有一份组装好的脚本常量即可 —— 规则表在
 * `apply` 时已经定下，渲染期间不会变。
 */
function installPageScript(ctx: HostContext, pageHosts: readonly string[]): void {
  const script = buildPageScript(pageHosts)
  if (script === undefined) {
    log('pageHosts 为空：不注入页面脚本（非回环页面仍会报 settings are unavailable in this browser）')
    return
  }
  const row: IndexInjection = { kind: 'script', placement: 'head', text: script }
  ctx.on('webserver/index-inject', (table) => {
    table.push(row)
  })
  log(`已注册页面脚本，命中主机：${pageHosts.join(', ')}`)
}

/**
 * 安装认证旁路。
 *
 * 放在 `ctx.inject` 里而不是 `apply` 的第一行：`connection` 服务由另一个插件提供，加载顺序不保证；
 * inject 会在它可用时回调。回调可能被执行不止一次（服务重建会重放），因此真正的幂等由
 * browser-auth.ts 的引用计数负责，这里只是"每次回调都重新拿一次当前的服务"。
 */
function installAuthBypass(ctx: HostContext): void {
  ctx.inject(['connection'], (connectionCtx: ConnectionContext) => {
    const patch = disableBrowserAuth(connectionCtx.connection as ConnectionLike | undefined)
    if (patch === undefined) {
      log('没拿到 connection.browserAuth（形状不符或服务缺失）：认证保持原样')
      return
    }
    if (patch.patched) {
      log('已关闭浏览器会话校验（Host/Origin 栅栏仍在）；把 disableBrowserAuth 关掉并重启可恢复')
    } else {
      log('浏览器会话校验此前已由本插件关闭，这次只加了引用计数')
    }
    connectionCtx.effect?.(() => () => {
      patch.restore()
    }, 'dsh-tailnet-admin: restore browser auth')
  })
}

/**
 * 插件入口。
 * @param ctx - 宿主上下文。
 * @param config - profile patch 里给的配置（可缺省）。
 */
export function apply(ctx: HostContext, config?: PluginConfig): void {
  const options = resolveOptions(config, process.env)
  installPageScript(ctx, options.pageHosts)
  if (options.disableBrowserAuth) installAuthBypass(ctx)
}
