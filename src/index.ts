/**
 * dsh-tailnet-admin —— 按 Tailscale 登录名放行已登录的浏览器。
 *
 * 向宿主的 `connection.authentication` 注册一个校验器，只放行名单里的 `Tailscale-User-Login`。没带身份头
 * 的访问仍回落到原来的 token/cookie 校验。**Host/Origin 栅栏不在其中**——它仍然只认回环或
 * `--trusted-host` 声明过的 authority。校验器只能"不认领"、不能"否决"，这一点写在 connection-auth.ts
 * 的开头。
 *
 * 为什么默认关闭：这一改，名单里的人打开页面就等于拿到了这台机器的控制权。而且这份名单只有在请求
 * 确实经过 tailscale serve、DSH 只监听回环地址时才可靠。理由与代价写在 docs/internals.md 的决策地图里，
 * 别在这里重复。
 *
 * 另外在 `webserver/request` 里给名单里的用户补一跳同源重载：安卓桌面应用冷启动的第一次跳转被浏览器
 * 标成跨站，新版栅栏会在认证之前回 403（见 launch-bootstrap.ts）。
 *
 * 配置是 volatile（见 config.ts）：从侧边栏「插件」页的配置表单或 profile 的 `cordis.patch.yml` 来；
 * Loader 提交新值后**只发一次 `loader/volatile-update`、不重挂插件**，因此名单在事件到达时对齐，
 * 校验器每次请求现读名单。改配置不必重启。
 */
import { Config, type PluginConfig } from './config.ts'
import { registerConnectionAuthentication } from './connection-auth.ts'
import type { ConnectionContext, HostConnection, HostContext } from './host.ts'
import { installLaunchBootstrap } from './launch-bootstrap.ts'
import { log } from './log.ts'
import { resolveOptions } from './options.ts'

export const name = 'dsh-tailnet-admin'

export { Config }

/** 字符串表在日志里的一行写法；空表说成"（空）"，免得留一段空白看不出所以然。 */
function listText(items: readonly string[]): string {
  return items.length === 0 ? '（空）' : items.join(', ')
}

/** 已经装上的连接鉴权注册；撤销时按注册时拿到的句柄还原。 */
interface Admission {
  restore(): void
}

/**
 * 安装按 Tailscale 身份放行的那一层。
 *
 * 放在 `ctx.inject` 里而不是 `apply` 的第一行：`connection` 与 `connection.authentication` 由别的
 * 插件提供，加载顺序不保证；inject 会在它们可用时回调。回调可能被执行不止一次（服务重建会重放），
 * 幂等由 connection-auth.ts 的引用计数负责，这里只是"每次回调都重新拿一次当前的服务"。
 *
 * 两个依赖都写进 inject：`connection.authentication` 是连接插件挂的嵌套服务，Cordis 4.2 起未声明的
 * 属性读取会直接抛 `cannot get property ... without inject`，不能只按属性链读。
 *
 * `sync()` 是唯一的写入口，两处调用它：拿到 connection 时（此时名单可能已经非空）与配置更新时；
 * 作用域销毁由 inject 回调里登记的清理函数直接还原。名单为空就是"不做事"：没有安装就什么都不用做，
 * 装过就还回去。
 *
 * @param ctx - 插件自己的上下文（`loader/volatile-update` 只发给这一层）。
 * @param config - loader 传入的配置。
 */
function installUserAllowlist(ctx: HostContext, config: PluginConfig | undefined): void {
  let connection: HostConnection | undefined
  let admission: Admission | undefined

  const sync = (): void => {
    const allowedUsers = resolveOptions(config).allowedUsers
    if (allowedUsers.length === 0) {
      if (admission === undefined) return
      admission.restore()
      admission = undefined
      log('已撤销连接鉴权注册')
      return
    }
    if (admission !== undefined || connection === undefined) return

    const handle = registerConnectionAuthentication(connection, {
      // 每次请求现读：名单改了不必卸载重装，引用计数也不会漂移。
      allowedUsers: () => resolveOptions(config).allowedUsers,
      onNotAllowed: (login) => {
        log(`没有自动放行不在 allowedUsers 里的 Tailscale 用户：${login}（要放行就把这个登录名加进 allowedUsers）`)
      },
    })
    if (handle === undefined) {
      log('没拿到 connection.authentication 或 createPeer（形状不符）：认证保持原样')
      return
    }
    admission = { restore: handle.restore }
    log(handle.registered
      ? `已注册连接鉴权：${listText(allowedUsers)} 里的用户直接接入；名单外不再主动拒绝（Host/Origin 栅栏仍在）；清空 allowedUsers 即可即时撤销`
      : '连接鉴权此前已由本插件注册过，这次只加了引用计数')
  }

  ctx.inject(['connection', 'connection.authentication'], (connectionCtx: ConnectionContext) => {
    connection = connectionCtx.connection
    sync()
    connectionCtx.effect?.(() => () => {
      admission?.restore()
      admission = undefined
      connection = undefined
    }, 'dsh-tailnet-admin: restore login admission')
  })

  ctx.on('loader/volatile-update', () => {
    sync()
  })

  if (resolveOptions(config).allowedUsers.length === 0) {
    log('allowedUsers 为空：不碰登录校验（仍要求先登录）')
  }
}

/**
 * 插件入口。
 * @param ctx - 宿主上下文。
 * @param config - profile patch / 配置页写入的配置（可能缺省）。
 */
export function apply(ctx: HostContext, config?: PluginConfig): void {
  installUserAllowlist(ctx, config)
  installLaunchBootstrap(ctx, config)
  ctx.on('loader/volatile-update', () => {
    log(`配置已更新：allowedUsers=${listText(resolveOptions(config).allowedUsers)}`)
  })
}
