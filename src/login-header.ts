/**
 * 从请求里读 `Tailscale-User-Login`。
 *
 * 两条认证路径共用这一份读取与规整：旧宿主（0.2.2-rc.x 及更早）改的是
 * `connection.browserAuth.isAuthenticated`，新宿主（0.2.3-alpha.1 起）注册的是
 * `connection.authentication` 的校验器。同一个请求必须得到同一个答案，否则"名单里的人能不能进"
 * 会取决于宿主版本，因此判断只写在这里一次。
 *
 * 判定规则见 {@link normalizeLogin} 与 {@link readLoginHeader}：整串相等、没有通配符，值不可用时
 * 一律当"不是名单里的人"，绝不猜。
 */

/** tailscale serve 放进去的登录名请求头。HTTP 头名大小写不敏感。 */
const LOGIN_HEADER = 'tailscale-user-login'

/** 请求里那个头的读取结果：没带、带了但不可用、带了一个可用的登录名。 */
export type LoginHeader =
  | { readonly state: 'absent' }
  | { readonly state: 'invalid' }
  | { readonly state: 'value'; readonly login: string }

/**
 * 把一个头值规整成可以比较的登录名。
 *
 * 转小写（登录名是邮箱，大小写不敏感）、去掉首尾空白。中间带空白或逗号的一律判为不可用：前者不是
 * 合法登录名，后者是重复头被 Node 拼起来的样子；放过去只会让"整串相等"变成一次模棱两可的比较。
 * 非 ASCII 的值 Tailscale 会做 RFC2047 编码，同样对不上任何名单，按不可用处理。
 * @param raw - 请求头里的原始字符串。
 * @returns 可用时给出规整后的登录名，否则标记为不可用。
 */
export function normalizeLogin(raw: string): LoginHeader {
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
 * @param request - 宿主传进来的请求事实（只用到 headers 这一面）。
 * @returns 读取结果。
 */
export function readLoginHeader(request: unknown): LoginHeader {
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
