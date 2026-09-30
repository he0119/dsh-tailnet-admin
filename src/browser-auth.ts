/**
 * 关掉浏览器会话校验。
 *
 * 宿主的 `/api` 判定是两件事叠在一起：Host/Origin 栅栏（只认回环或 `--trusted-host` / `trustedHosts`
 * 声明过的 authority）加一层浏览器会话认证（`?token=` 换来的、按 authority 绑定的 cookie）。
 * 本模块**只动后一半**：把 `browserAuth.isAuthenticated` 换成常量 true，栅栏原样保留。
 *
 * 代价必须说清楚：这一改，能打开这个页面的人就等于拿到了这台机器的控制权（读写文件、执行命令、
 * 动用已配置的 API key）。所以它在配置里默认关闭，只在显式打开时才安装。
 *
 * 幂等：宿主可能在同一个进程里重建/重放插件作用域，`apply` 会跑不止一次（实测启动日志里出现两轮）。
 * 用 WeakMap 记引用计数，重复安装只加计数、重复卸载只减计数，最后一轮卸载才真正还原原型上的方法。
 */

/** 只用到的那个方法：请求是否已通过浏览器认证。 */
export interface BrowserAuthLike {
  isAuthenticated(request: unknown): boolean
}

/** `connection` 服务里本模块用到的部分。 */
export interface ConnectionLike {
  browserAuth?: BrowserAuthLike
}

/** 一次安装的句柄。 */
export interface AuthPatch {
  /** 这次调用是否真的做了替换（false = 之前已被本模块替换过，只是加了引用计数）。 */
  readonly patched: boolean
  /** 释放这次安装；引用计数归零时还原原方法。可安全地重复调用。 */
  restore(): void
}

interface PatchEntry {
  original: BrowserAuthLike['isAuthenticated']
  refs: number
}

const PATCHES = new WeakMap<BrowserAuthLike, PatchEntry>()

/** 形状校验：不是"带 isAuthenticated 方法的对象"就不碰（fail-closed，宁可不动认证）。 */
function asBrowserAuth(value: unknown): BrowserAuthLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { isAuthenticated?: unknown }
  return typeof candidate.isAuthenticated === 'function' ? (candidate as BrowserAuthLike) : undefined
}

/**
 * 安装（或复用）"认证恒通过"的替换。
 * @param connection - 宿主的 connection 服务；形状不对或缺失时不做任何事。
 * @returns 句柄；没替换成功时返回 undefined。
 */
export function disableBrowserAuth(connection: ConnectionLike | undefined): AuthPatch | undefined {
  const auth = asBrowserAuth(connection?.browserAuth)
  if (auth === undefined) return undefined

  const existing = PATCHES.get(auth)
  if (existing !== undefined) {
    existing.refs += 1
    return handle(auth, false)
  }

  // 不 bind：原方法是从原型上取下来的，还原时按同名字段写回去即可（调用方仍是 auth.isAuthenticated(...)，
  // this 不变）。绑过之后还原的是一个新函数，虽然行为等价，但会让"还原"看起来像改过。
  const original = auth.isAuthenticated
  PATCHES.set(auth, { original, refs: 1 })
  auth.isAuthenticated = () => true
  return handle(auth, true)
}

function handle(auth: BrowserAuthLike, patched: boolean): AuthPatch {
  let released = false
  return {
    patched,
    restore(): void {
      if (released) return
      released = true
      const entry = PATCHES.get(auth)
      if (entry === undefined) return
      entry.refs -= 1
      if (entry.refs > 0) return
      PATCHES.delete(auth)
      auth.isAuthenticated = entry.original
    },
  }
}
