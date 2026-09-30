import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

import type { BrowserAuthLike, ConnectionLike } from '../src/browser-auth.ts'
import type { ConnectionContext, HostContext } from '../src/host.ts'

/**
 * 只用得着两面的假宿主。
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
  /** 模拟一次 index.html 渲染：跑一遍注入订阅方，返回它们填出来的表。 */
  renderIndex(): IndexInjection[]
  /** 模拟 connection 服务就绪：跑一遍 `inject` 回调。可以调多次，模拟服务重建时的重放。 */
  provideConnection(): void
  /** 跑一遍所有清理函数（逆序，与 Cordis 作用域销毁一致）。 */
  dispose(): void
}

/** 造一个假宿主。 */
export function createFakeHost(options: { connection?: ConnectionLike } = {}): FakeHost {
  const listeners: ((table: IndexInjection[]) => void)[] = []
  const callbacks: ((ctx: ConnectionContext) => unknown)[] = []
  const restorers: (() => void)[] = []
  const connection: ConnectionLike = options.connection ?? {}

  const ctx: HostContext = {
    on(_event, listener) {
      listeners.push(listener)
      return undefined
    },
    inject(_deps, callback) {
      callbacks.push(callback)
      return undefined
    },
  }

  return {
    ctx,
    connection,
    restorers,
    renderIndex(): IndexInjection[] {
      const table: IndexInjection[] = []
      for (const listener of listeners) listener(table)
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
    dispose(): void {
      for (const restorer of [...restorers].reverse()) restorer()
    },
  }
}

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

/** 在环境变量存在期间跑一段代码，结束后还原（测试之间不串味）。 */
export function withEnv(vars: Record<string, string | undefined>, body: () => void): void {
  const saved = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    body()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
