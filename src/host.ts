import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

import type { ConnectionLike } from './browser-auth.ts'

/**
 * 本插件用到的那一小片宿主形状。
 *
 * 为什么不直接 import 官方的 `Context`：宿主服务与事件的类型由各官方包用模块增补
 * （module augmentation）声明，插件的类型面因此随"安装环境里恰好装了哪些包"而变。本插件对宿主的用法
 * 只有两处，而且**都在运行时校验**（表不是数组就跳过、`browserAuth` 形状不对就不碰），所以这里只声明
 * 用到的部分，插件不会因为宿主换了一代类型面就编译不过。
 *
 * `IndexInjection` 是例外 —— 它正是要写进事件表里的那一行，形状对不上应当在编译期就报错，所以用官方类型。
 */
export interface IndexInjectionHost {
  /** 订阅启动 HTML 的注入表；每次渲染 index.html 前回调一次，订阅方往表里追加行。 */
  on(event: 'webserver/index-inject', listener: (table: IndexInjection[]) => void): unknown
}

/** `ctx.inject` 回调收到的、已能读到 `connection` 服务的那层上下文。 */
export interface ConnectionContext {
  connection?: ConnectionLike
  /** Cordis 的作用域清理钩子：回调返回的清理函数在作用域销毁时执行。 */
  effect?(callback: () => (() => void) | void, label?: string): unknown
}

/** 插件 `apply` 收到的宿主上下文（只声明本插件用到的两面）。 */
export interface HostContext extends IndexInjectionHost {
  inject(deps: readonly string[], callback: (ctx: ConnectionContext) => unknown): unknown
}
