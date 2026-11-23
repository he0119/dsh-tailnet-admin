/**
 * 连接鉴权注册。
 *
 * 宿主把「这个请求代表谁」的判断收进 `connection.authentication`：插件用 `register(provider)` 挂一个
 * 校验器，`admit` 按注册顺序问，第一个返回 Peer 的算数；都没认领就 401（校验器抛错时 503）。
 *
 * 两条必须记住的约束：
 *
 * - **只能"不认领"，不能"否决"。** 返回 `undefined` 只是让下一个校验器继续问；名单外的人如果自己
 *   有有效的登录 cookie，仍可能被令牌校验器放进来。名单是一条"自动放行"的捷径，不是一道门。
 * - **注册顺序有意义。** 带 API 凭据的请求应当在令牌校验器那里被认领（它认得凭据，会给出带
 *   RemoteAccess 的 Peer）。本插件在 profile 补丁里排在 web bundle 之后加载，因此注册在令牌之后；
 *   顺序反过来时，一个带 API 凭据、又带身份头的请求会被这里当成 owner。
 */

import { readLoginHeader } from './login-header.ts'

/** 宿主认的校验器形状：同步交出这个请求代表的 Peer，或 `undefined` 让下一个校验器继续问。 */
export interface AuthenticationProviderLike {
  authenticate(request: unknown): unknown
}

/** `connection.authentication` 里本模块用到的部分。 */
export interface ConnectionAuthenticationLike {
  /** 追加一个校验器；返回撤销函数，调用方的作用域销毁时也会撤销。 */
  register(provider: AuthenticationProviderLike): () => Promise<void>
}

/** `connection` 服务里本模块用到的部分。 */
export interface AdmissionConnection {
  /** 凭据校验器的注册表。 */
  readonly authentication?: ConnectionAuthenticationLike
  /** 建一个独立的进程内 Peer；principal 固定为 owner，与令牌插件给浏览器的那一个同级。 */
  createPeer?(options: { principal: { kind: 'owner' } }): unknown
}

/** 一次安装的输入。 */
export interface AdmissionOptions {
  /** 当前允许的 Tailscale 登录名（已转小写）；每次请求都会重新读，配置改了不必重装。 */
  allowedUsers(): readonly string[]
  /** 名单外的登录名第一次出现时回调一次；调用方用它把「该把谁加进名单」写进日志。 */
  onNotAllowed?(login: string): void
}

/** 一次安装的句柄。 */
export interface AdmissionHandle {
  /** 这次调用是否真的注册了校验器（false = 之前已注册过，只是加了引用计数）。 */
  readonly registered: boolean
  /** 释放这次安装；引用计数归零时撤销注册。可安全地重复调用。 */
  restore(): void
}

interface AdmissionEntry {
  refs: number
  allowedUsers: () => readonly string[]
  onNotAllowed?: (login: string) => void
  /** 已经报过「名单外」的登录名：一个用户只写一行日志，免得被反复请求刷屏。 */
  reported: Set<string>
  dispose: () => Promise<void>
}

const INSTALLS = new WeakMap<ConnectionAuthenticationLike, AdmissionEntry>()

/** 这个登录名是否在名单里；不在时记一次（每个登录名只回调一次）。名单每次现读。 */
function allows(entry: AdmissionEntry, login: string): boolean {
  if (entry.allowedUsers().includes(login)) return true
  if (!entry.reported.has(login)) {
    entry.reported.add(login)
    entry.onNotAllowed?.(login)
  }
  return false
}

/**
 * 注册「名单里的 Tailscale 用户直接接入」的校验器。
 * @param connection - 宿主的 connection 服务；缺少 authentication / createPeer 时不做任何事。
 * @param options - 当前名单与"没放行谁"的回调。
 * @returns 句柄；服务形状不符时返回 undefined。
 */
export function registerConnectionAuthentication(
  connection: AdmissionConnection | undefined,
  options: AdmissionOptions,
): AdmissionHandle | undefined {
  const authentication = connection?.authentication
  if (typeof authentication?.register !== 'function' || typeof connection?.createPeer !== 'function') {
    return undefined
  }

  const existing = INSTALLS.get(authentication)
  if (existing !== undefined) {
    // 重放时以后一次安装的配置为准：旧实例的 volatile 引用可能已经停止更新。
    existing.refs += 1
    existing.allowedUsers = options.allowedUsers
    existing.onNotAllowed = options.onNotAllowed
    return handle(authentication, false)
  }

  // 名单用户共用一个 owner Peer：省得每次请求建一个，也让所有名单用户共享同一份连接身份。
  const peer = connection.createPeer({ principal: { kind: 'owner' } })
  const entry: AdmissionEntry = {
    refs: 1,
    allowedUsers: options.allowedUsers,
    ...(options.onNotAllowed === undefined ? {} : { onNotAllowed: options.onNotAllowed }),
    reported: new Set<string>(),
    dispose: async () => {},
  }
  INSTALLS.set(authentication, entry)

  entry.dispose = authentication.register({
    authenticate(request: unknown): unknown {
      const header = readLoginHeader(request)
      if (header.state !== 'value') return undefined
      return allows(entry, header.login) ? peer : undefined
    },
  })

  return handle(authentication, true)
}

function handle(authentication: ConnectionAuthenticationLike, registered: boolean): AdmissionHandle {
  let released = false
  return {
    registered,
    restore(): void {
      if (released) return
      released = true
      const entry = INSTALLS.get(authentication)
      if (entry === undefined) return
      entry.refs -= 1
      if (entry.refs > 0) return
      INSTALLS.delete(authentication)
      // 撤销是异步的（作用域清理可能排队），这里不阻塞调用方；失败也只影响下一次鉴权。
      void entry.dispose().catch(() => {})
    },
  }
}
