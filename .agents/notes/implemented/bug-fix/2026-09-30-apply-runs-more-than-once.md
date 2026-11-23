# Agent Note: apply 会跑不止一次，注册要记引用计数

Status: implemented

## Problem

实测启动日志里插件那句出现了两轮——宿主会重放 `inject` 回调（服务重建、HMR 之类的路径）。

连接鉴权注册如果没有计数，「第一轮的清理」会把**还在生效的那一轮**一起拆掉：使用者看到的是「名单里明明
有我，却仍然要重新登录」。

## Decision

`src/connection-auth.ts` 用 `WeakMap<ConnectionAuthenticationLike, AdmissionEntry>` 记引用计数：

- 重复安装只加计数（句柄的 `registered` 为 false），最后一轮 `restore` 才真正撤销注册；
- 每个句柄的 `restore()` 幂等（内部 `released` 标志），重复调用不会多减计数；
- 名单与 `onNotAllowed` 以后一次安装的为准；名单用户共用一个 owner Peer，不随重放增加。

## Alternatives considered

**假定宿主只调用一次。** 实测就是两轮；没有计数时卸载路径会拆掉别人还在用的那一轮。

**用模块级布尔「装过就跳过」。** 那无法区分「我自己注册的」与「别人注册的」，卸载时会错误地撤销别人的
校验器。

## Consequences

- `handle.registered` 让日志能分开「这次真的注册了」与「只加了引用计数」——排查时先看这两句。
- 名单清空再填上不会累积注册：计数归零即撤销，下一轮重新装。
