import type { VolatileSnapshot } from '@deepseek-ai/cordis'

import type { PluginConfig } from '../src/config.ts'
import type { AuthenticationProviderLike, ConnectionAuthenticationLike } from '../src/connection-auth.ts'
import type { HostConnection, HostContext, HostServices, WebRequestListener } from '../src/host.ts'

/**
 * 只用得着三面的假宿主。
 *
 * 这里刻意不挂真的 Cordis：本插件与宿主之间只有三个接触面（事件订阅、`inject` 回调、effect 清理），
 * 把它们记下来手动触发，比拉起一个真的 Loader 更能说清"哪一步发生了什么"。端到端那一层由
 * docs/development.md 里那条"装进 profile 再看页面"的手动路径负责。
 */
export interface FakeHost {
  readonly ctx: HostContext
  readonly connection: HostConnection
  /** effect 注册的清理函数，按注册顺序。 */
  readonly restorers: (() => void)[]
  /** 订阅过的宿主事件名，按首次订阅顺序。用来核"订阅挂在插件自己的 ctx 上"。 */
  readonly subscribed: string[]
  /** 注册到假 webServer 上的 `webserver/request` 监听器，按注册顺序。 */
  readonly webRequests: WebRequestListener[]
  /** 模拟 connection 服务就绪：跑一遍声明了 `connection` 的 `inject` 回调。可以调多次，模拟服务重建时的重放。 */
  provideConnection(): void
  /** 模拟 webServer 服务就绪：跑一遍声明了 `webServer` 的 `inject` 回调。 */
  provideWebServer(): void
  /** 模拟 Loader 把 volatile 新值就地提交之后向所属 fiber 发出的实例内事件。 */
  emitVolatile(paths?: readonly (readonly string[])[]): void
  /** 跑一遍所有清理函数（逆序，与 Cordis 作用域销毁一致）。 */
  dispose(): void
}

/** 事件监听器的宽松形状：假宿主只负责把参数原样递下去。 */
type AnyListener = (...args: any[]) => void

/** 造一个假宿主。 */
export function createFakeHost(options: { connection?: HostConnection } = {}): FakeHost {
  const listeners = new Map<string, AnyListener[]>()
  const injections: { deps: readonly string[]; callback: (ctx: HostServices) => unknown }[] = []
  const restorers: (() => void)[] = []
  const webRequests: WebRequestListener[] = []
  const connection: HostConnection = options.connection ?? {}

  const ctx: HostContext = {
    on(event: string, listener: AnyListener): unknown {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return undefined
    },
    inject(deps: readonly string[], callback: (ctx: HostServices) => unknown): unknown {
      injections.push({ deps, callback })
      return undefined
    },
  }

  const fire = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }

  /** 跑一遍声明了某一类依赖的 inject 回调；可以调多次，模拟服务重建时的重放。 */
  const provide = (services: HostServices, matches: (deps: readonly string[]) => boolean): void => {
    for (const injection of injections) {
      if (matches(injection.deps)) injection.callback(services)
    }
  }
  const effect = (callback: () => (() => void) | void): unknown => {
    const disposer = callback()
    if (typeof disposer === 'function') restorers.push(disposer)
    return undefined
  }

  return {
    ctx,
    connection,
    restorers,
    webRequests,
    get subscribed(): string[] {
      return [...listeners.keys()]
    },
    provideConnection(): void {
      provide({
        connection,
        on: () => undefined,
        effect,
      }, (deps) => deps.includes('connection'))
    },
    provideWebServer(): void {
      provide({
        webServer: {},
        on(_event, listener) {
          webRequests.push(listener)
          return undefined
        },
        effect,
      }, (deps) => deps.includes('webServer'))
    },
    emitVolatile(paths: readonly (readonly string[])[] = [['allowedUsers']]): void {
      fire('loader/volatile-update', paths)
    },
    dispose(): void {
      for (const restorer of [...restorers].reverse()) restorer()
    },
  }
}

/**
 * 假的 volatile 引用。
 *
 * 真的那一份由 Loader 就地提交新值（`updateVolatile`），这里给同一个观察面：`get()` 读当前值，
 * `set()` 换掉它——测试因此能演"插件启动之后配置变了"这件事，而不必拉起 Loader。
 */
export interface FakeRef<T> {
  get(): VolatileSnapshot<T>
  set(value: T): void
}

/** 造一个假引用。 */
export function volatileRef<T>(initial: T): FakeRef<T> {
  let value = initial
  return {
    get: () => value as VolatileSnapshot<T>,
    set(next: T): void {
      value = next
    },
  }
}

/** 配置只有一个引用的假配置：测试拿得到引用本身，才能中途改值。 */
export interface FakeConfig {
  allowedUsers: FakeRef<string[]>
}

/** 造一份假配置（认证名单默认空表）。 */
export function createConfig(initial: { allowedUsers?: string[] } = {}): FakeConfig {
  return { allowedUsers: volatileRef(initial.allowedUsers ?? []) }
}

/** 造一个带着 Tailscale 登录名的请求：形状与宿主传给校验器的 `ConnectionTrustRequest` 一致。 */
export function loginRequest(login: string): { headers: Record<string, string> } {
  return { headers: { 'tailscale-user-login': login } }
}

/** 假配置与 `PluginConfig` 的关系：引用面一致，因此能直接递给 `apply`。 */
export const asPluginConfig = (config: FakeConfig): PluginConfig => config as PluginConfig

/** 假的 connection.authentication：记录注册了哪些校验器、撤销过几次。 */
export interface FakeAuthentication extends ConnectionAuthenticationLike {
  readonly providers: AuthenticationProviderLike[]
  /** 撤销函数被调用的次数（重复撤销也算）。 */
  readonly revoked: number
}

/** 造一个假的连接鉴权注册表。 */
export function createFakeAuthentication(): FakeAuthentication {
  const providers: AuthenticationProviderLike[] = []
  let revoked = 0
  return {
    providers,
    get revoked(): number {
      return revoked
    },
    register(provider: AuthenticationProviderLike): () => Promise<void> {
      providers.push(provider)
      return async (): Promise<void> => {
        revoked += 1
        const index = providers.indexOf(provider)
        if (index !== -1) providers.splice(index, 1)
      }
    },
  }
}

/** 带新接口的假 connection：authentication + createPeer，并记下建过的 Peer。 */
export interface FakeAdmissionConnection extends HostConnection {
  readonly authentication: FakeAuthentication
  /** createPeer 建出来的 Peer，按调用顺序。 */
  readonly peers: { readonly principal: { readonly kind: string }; readonly id: string }[]
}

/** 造一个走新接口的假 connection。 */
export function createAdmissionConnection(
  options: { authentication?: FakeAuthentication } = {},
): FakeAdmissionConnection {
  const authentication = options.authentication ?? createFakeAuthentication()
  const peers: { principal: { kind: string }; id: string }[] = []
  return {
    authentication,
    peers,
    createPeer({ principal }: { principal: { kind: 'owner' } }): unknown {
      const peer = { principal, id: `peer-${peers.length + 1}` }
      peers.push(peer)
      return peer
    },
  }
}
