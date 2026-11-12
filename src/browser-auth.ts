/**
 * 只让名单里的 Tailscale 用户免掉浏览器会话校验。
 *
 * 宿主的 `/api` 判定是两件事叠在一起：Host/Origin 栅栏（只认回环或 `--trusted-host` / `trustedHosts`
 * 声明过的 authority）加一层浏览器会话认证（`?token=` 换来的、按 authority 绑定的 cookie）。
 * 本模块**只动后一半**：把 `browserAuth.isAuthenticated` 换成「按 `Tailscale-User-Login` 请求头放行」，
 * 栅栏原样保留。`authenticateApi` 是同一层里给 API 凭据用的入口，存在时也按同一份名单处理。
 *
 * 为什么不是常量 true：那等于把页面交给任何能打开它的人。tailscale serve 会把请求者的登录名放进
 * `Tailscale-User-Login`，并在入站请求上先删掉同名的头，所以这里可以只放行名单里的登录名；名单外的
 * 请求直接拒绝，没带这个头的请求回落到宿主原来的 cookie 校验。
 *
 * 代价必须说清楚：这个判断只有在请求确实经过 tailscale serve 时才有意义。DSH 必须只监听回环地址；
 * 否则任何能直连这个端口的人都能自己写一个 `Tailscale-User-Login`。这条前提写在 README 的「安全边界」里，
 * 也在配置页的提示里。
 *
 * 幂等：宿主可能在同一个进程里重建/重放插件作用域，`apply` 会跑不止一次（实测启动日志里出现两轮）。
 * 用 WeakMap 记引用计数，重复安装只加计数、重复卸载只减计数，最后一轮卸载才真正还原原型上的方法。
 */

/** 只用到的两个方法：请求是否已通过浏览器认证，以及 API 凭据属于哪个 operator。 */
export interface BrowserAuthLike {
  isAuthenticated(request: unknown, secure?: boolean): boolean
  authenticateApi?(request: unknown, secure?: boolean): unknown
}

/** `connection` 服务里本模块用到的部分。 */
export interface ConnectionLike {
  browserAuth?: BrowserAuthLike
}

/** 一次安装的输入。 */
export interface RestrictOptions {
  /** 当前允许的 Tailscale 登录名（已转小写）；每次请求都会重新读，配置改了不必重装。 */
  allowedUsers(): readonly string[]
  /** 名单外的登录名第一次出现时回调一次；调用方用它把「该把谁加进名单」写进日志。 */
  onDenied?(login: string): void
}

/** 一次安装的句柄。 */
export interface AuthPatch {
  /** 这次调用是否真的做了替换（false = 之前已被本模块替换过，只是加了引用计数）。 */
  readonly patched: boolean
  /** 释放这次安装；引用计数归零时还原原方法。可安全地重复调用。 */
  restore(): void
}

interface PatchEntry {
  originalIsAuthenticated: BrowserAuthLike['isAuthenticated']
  originalAuthenticateApi: BrowserAuthLike['authenticateApi']
  refs: number
  allowedUsers: () => readonly string[]
  onDenied?: (login: string) => void
  /** 已经报过「名单外」的登录名：一个用户只写一行日志，免得被反复请求刷屏。 */
  denied: Set<string>
}

const PATCHES = new WeakMap<BrowserAuthLike, PatchEntry>()

/** tailscale serve 放进去的登录名请求头。HTTP 头名大小写不敏感。 */
const LOGIN_HEADER = 'tailscale-user-login'

/** 请求里那个头的读取结果：没带、带了但不可用、带了一个可用的登录名。 */
type LoginHeader =
  | { readonly state: 'absent' }
  | { readonly state: 'invalid' }
  | { readonly state: 'value'; readonly login: string }

/** 形状校验：不是"带 isAuthenticated 方法的对象"就不碰（fail-closed，宁可不动认证）。 */
function asBrowserAuth(value: unknown): BrowserAuthLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { isAuthenticated?: unknown }
  return typeof candidate.isAuthenticated === 'function' ? (candidate as BrowserAuthLike) : undefined
}

/**
 * 把一个头值规整成可以比较的登录名。
 *
 * 转小写（登录名是邮箱，大小写不敏感）、去掉首尾空白。中间带空白或逗号的一律判为不可用：前者不是
 * 合法登录名，后者是重复头被 Node 拼起来的样子；放过去只会让「整串相等」变成一次模棱两可的比较。
 * 非 ASCII 的值 Tailscale 会做 RFC2047 编码，同样对不上任何名单，按不可用处理。
 */
function normalizeLogin(raw: string): LoginHeader {
  const login = raw.trim().toLowerCase()
  if (login === '' || login.includes(',') || !/^[\x21-\x7e]+$/u.test(login)) return { state: 'invalid' }
  return { state: 'value', login }
}

/**
 * 从请求里读 `Tailscale-User-Login`。
 *
 * 宿主把这个参数的类型写成 `{ headers: Headers | Record<string, string | string[]> }`，两种都要认：
 * - `Headers`：`get()` 自己处理大小写；
 * - 普通对象（node:http 的 `req.headers`）：键已经小写，但为了别的载体也认原始写法。
 *
 * 数组（重复头）不猜哪一个是真的，按不可用处理。读取本身抛错也算不可用：认证边界上宁可拒绝。
 */
function readLoginHeader(request: unknown): LoginHeader {
  if (typeof request !== 'object' || request === null) return { state: 'absent' }
  const headers = (request as { headers?: unknown }).headers
  if (headers === null || headers === undefined) return { state: 'absent' }

  if (typeof (headers as { get?: unknown }).get === 'function') {
    let value: unknown
    try {
      value = (headers as { get(name: string): unknown }).get(LOGIN_HEADER)
    } catch {
      return { state: 'invalid' }
    }
    if (value === null || value === undefined) return { state: 'absent' }
    return typeof value === 'string' ? normalizeLogin(value) : { state: 'invalid' }
  }

  if (typeof headers !== 'object') return { state: 'absent' }
  const record = headers as Record<string, unknown>
  // 普通对象的键不保证是小写；`_` 与 `-` 也按同一个头处理（Tailscale 自己删入站头时就是这么比的）。
  // 同时命中多个变体说明有人在拼重复头，不猜哪一个是真的。
  let raw: unknown
  let matches = 0
  for (const key of Object.keys(record)) {
    if (key.toLowerCase().replaceAll('_', '-') !== LOGIN_HEADER) continue
    raw = record[key]
    matches += 1
  }
  if (matches === 0 || raw === undefined) return { state: 'absent' }
  if (matches > 1) return { state: 'invalid' }
  return typeof raw === 'string' ? normalizeLogin(raw) : { state: 'invalid' }
}

/**
 * 这个登录名是否在名单里；不在时记一次（每个登录名只回调一次）。
 *
 * 名单每次现读：Loader 就地提交 volatile 新值之后，同一个替换函数看到的就已经是新名单了，
 * 不需要卸载重装，引用计数也不会因为改配置而漂移。
 */
function allows(entry: PatchEntry, login: string): boolean {
  if (entry.allowedUsers().includes(login)) return true
  if (!entry.denied.has(login)) {
    entry.denied.add(login)
    entry.onDenied?.(login)
  }
  return false
}

/**
 * 安装（或复用）「只放行名单里的 Tailscale 用户」的替换。
 * @param connection - 宿主的 connection 服务；形状不对或缺失时不做任何事。
 * @param options - 当前名单与"拒绝了谁"的回调。
 * @returns 句柄；没替换成功时返回 undefined。
 */
export function restrictBrowserAuth(
  connection: ConnectionLike | undefined,
  options: RestrictOptions,
): AuthPatch | undefined {
  const auth = asBrowserAuth(connection?.browserAuth)
  if (auth === undefined) return undefined

  const existing = PATCHES.get(auth)
  if (existing !== undefined) {
    // 重放时以后一次安装的配置为准：旧实例的 volatile 引用可能已经停止更新，继续读它会让新配置
    // 落在空气里。两个实例都活着时"最后装的那份"是唯一确定的选择；替换函数不重装，引用计数不变。
    existing.refs += 1
    existing.allowedUsers = options.allowedUsers
    existing.onDenied = options.onDenied
    return handle(auth, false)
  }

  const entry: PatchEntry = {
    originalIsAuthenticated: auth.isAuthenticated,
    originalAuthenticateApi: typeof auth.authenticateApi === 'function' ? auth.authenticateApi : undefined,
    refs: 1,
    allowedUsers: options.allowedUsers,
    ...(options.onDenied === undefined ? {} : { onDenied: options.onDenied }),
    denied: new Set<string>(),
  }
  PATCHES.set(auth, entry)

  // 不 bind：还原时按同名字段写回去即可（调用方仍是 auth.isAuthenticated(...)，this 不变）。绑过之后
  // 还原的是一个新函数，虽然行为等价，但会让"还原"看起来像改过。
  auth.isAuthenticated = function (request: unknown, secure?: boolean): boolean {
    const header = readLoginHeader(request)
    if (header.state === 'absent') return entry.originalIsAuthenticated.call(auth, request, secure)
    if (header.state === 'invalid') return false
    if (!allows(entry, header.login)) return false
    // 名单里的人也分两种：浏览器会话与 API 凭据。后者的 cookie 版本不同，admit 会先问
    // isAuthenticated、再问 authenticateApi；如果这里对 API 请求也答 true，admit 就会把它降级成
    // 共享的 browserPeer，交互声明与 operator 身份一起丢掉。先问一次 authenticateApi：它认得这枚
    // 凭据就把这一层让出去，让 admit 走原来的 API 分支。
    if (entry.originalAuthenticateApi !== undefined
      && entry.originalAuthenticateApi.call(auth, request, secure) !== undefined) return false
    return true
  }

  // API 凭据走的是同一个判定的后半截（admit 先问 isAuthenticated，再问 authenticateApi）。名单外的
  // 用户如果手里还留着一枚 API cookie，只拦浏览器那半截等于没拦。宿主没这个方法时就不碰。
  if (entry.originalAuthenticateApi !== undefined) {
    const original = entry.originalAuthenticateApi
    auth.authenticateApi = function (request: unknown, secure?: boolean): unknown {
      const header = readLoginHeader(request)
      if (header.state === 'absent') return original.call(auth, request, secure)
      if (header.state === 'invalid') return undefined
      return allows(entry, header.login) ? original.call(auth, request, secure) : undefined
    }
  }

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
      auth.isAuthenticated = entry.originalIsAuthenticated
      if (entry.originalAuthenticateApi !== undefined) auth.authenticateApi = entry.originalAuthenticateApi
    },
  }
}
