import type { AdmissionConnection } from './connection-auth.ts'

/**
 * 本插件用到的那一小片宿主形状。
 *
 * 为什么不直接 import 官方的 `Context`：宿主服务与事件的类型由各官方包用模块增补
 * （module augmentation）声明，插件的类型面因此随"安装环境里恰好装了哪些包"而变。本插件对宿主的用法
 * 只有两处，而且**都在运行时兜底**（`authentication` / `createPeer` 形状不对就不注册、配置引用缺席
 * 就按没配置处理），所以这里只声明用到的部分，插件不会因为宿主换了一代类型面就编译不过。
 *
 * 注意**订阅得挂在插件自己的 `ctx` 上**：`loader/volatile-update` 是实例内事件
 * （Loader 按 `owner.fiber === fiber` 过滤），挂在 `ctx.inject` 回调里的子 fiber 上收不到。
 */
export interface HostContext {
  /** 订阅本插件实例的 volatile 配置更新；参数是变化的字段路径（键数组），等值更新不通知。 */
  on(event: 'loader/volatile-update', listener: (paths: readonly (readonly string[])[]) => void): unknown
  /** 起一个只声明这些依赖的子 fiber；依赖由别的插件提供，到位时才回调，缺席或卸载时不回调。 */
  inject(deps: readonly string[], callback: (ctx: ConnectionContext) => unknown): unknown
}

/** 本插件用到的 connection 服务。 */
export type HostConnection = AdmissionConnection

/** `ctx.inject` 回调收到的、已能读到 `connection` 服务的那层上下文。 */
export interface ConnectionContext {
  connection?: HostConnection
  /** Cordis 的作用域清理钩子：回调返回的清理函数在作用域销毁时执行。 */
  effect?(callback: () => (() => void) | void, label?: string): unknown
}
