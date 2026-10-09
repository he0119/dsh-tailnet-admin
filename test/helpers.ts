import type { VolatileSnapshot } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

import type { BrowserAuthLike, ConnectionLike } from '../src/browser-auth.ts'
import type { PluginConfig } from '../src/config.ts'
import type { ConnectionContext, HostContext } from '../src/host.ts'

/**
 * 只用得着三面的假宿主。
 *
 * 这里刻意不挂真的 Cordis：本插件与宿主之间只有三个接触面（事件订阅、`inject` 回调、effect 清理），
 * 把它们记下来手动触发，比拉起一个真的 Loader 更能说清"哪一步发生了什么"。端到端那一层由
 * docs/development.md 里那条"装进 profile 再看页面"的手动路径负责。
 */
export interface FakeHost {
  readonly ctx: HostContext
  readonly connection: ConnectionLike
  /** effect 注册的清理函数，按注册顺序。 */
  readonly restorers: (() => void)[]
  /** 订阅过的宿主事件名，按首次订阅顺序。用来核"订阅挂在插件自己的 ctx 上"。 */
  readonly subscribed: string[]
  /** 模拟一次 index.html 渲染：跑一遍注入订阅方，返回它们填出来的表。 */
  renderIndex(): IndexInjection[]
  /** 模拟 connection 服务就绪：跑一遍 `inject` 回调。可以调多次，模拟服务重建时的重放。 */
  provideConnection(): void
  /** 模拟 Loader 把 volatile 新值就地提交之后向所属 fiber 发出的实例内事件。 */
  emitVolatile(paths?: readonly (readonly string[])[]): void
  /** 跑一遍所有清理函数（逆序，与 Cordis 作用域销毁一致）。 */
  dispose(): void
}

/** 事件监听器的宽松形状：假宿主只负责把参数原样递下去。 */
type AnyListener = (...args: any[]) => void

/** 造一个假宿主。 */
export function createFakeHost(options: { connection?: ConnectionLike } = {}): FakeHost {
  const listeners = new Map<string, AnyListener[]>()
  const callbacks: ((ctx: ConnectionContext) => unknown)[] = []
  const restorers: (() => void)[] = []
  const connection: ConnectionLike = options.connection ?? {}

  const ctx: HostContext = {
    on(event: string, listener: AnyListener): unknown {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return undefined
    },
    inject(_deps: readonly string[], callback: (ctx: ConnectionContext) => unknown): unknown {
      callbacks.push(callback)
      return undefined
    },
  }

  const fire = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }

  return {
    ctx,
    connection,
    restorers,
    get subscribed(): string[] {
      return [...listeners.keys()]
    },
    renderIndex(): IndexInjection[] {
      const table: IndexInjection[] = []
      fire('webserver/index-inject', table)
      return table
    },
    provideConnection(): void {
      const connectionCtx: ConnectionContext = {
        connection,
        effect(callback) {
          const disposer = callback()
          if (typeof disposer === 'function') restorers.push(disposer)
          return undefined
        },
      }
      for (const callback of callbacks) callback(connectionCtx)
    },
    emitVolatile(paths: readonly (readonly string[])[] = [['pageHosts']]): void {
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

/** 两个开关都是引用的假配置：测试拿得到引用本身，才能中途改值。 */
export interface FakeConfig {
  pageHosts: FakeRef<string[]>
  disableBrowserAuth: FakeRef<boolean>
}

/** 造一份假配置（缺省都是"关着"）。 */
export function createConfig(initial: { pageHosts?: string[]; disableBrowserAuth?: boolean } = {}): FakeConfig {
  return {
    pageHosts: volatileRef(initial.pageHosts ?? []),
    disableBrowserAuth: volatileRef(initial.disableBrowserAuth ?? false),
  }
}

/** 假配置与 `PluginConfig` 的关系：引用面一致，因此能直接递给 `apply`。 */
export const asPluginConfig = (config: FakeConfig): PluginConfig => config as PluginConfig

/** 假的浏览器认证：记录被问了几次，答案默认为"没通过"。 */
export interface FakeAuth extends BrowserAuthLike {
  calls: number
}

/** 造一个假认证。 */
export function createFakeAuth(): FakeAuth {
  const auth: FakeAuth = {
    calls: 0,
    isAuthenticated(_request: unknown): boolean {
      auth.calls += 1
      return false
    },
  }
  return auth
}
