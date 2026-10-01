# Agent Note: 两个开关默认都不做事

Status: implemented

## Problem

这个插件的价值来自「少一次折腾」，代价是「这台机器对能打开页面的人敞开」。默认值就是在这两者之间
表态，而表态的时机是「装上的一刻」——那时使用者还没读代价那一段。

## Decision

`pageHosts` 默认空表（一行都不注入），`disableBrowserAuth` 默认 `false`（保留认证）。② 必须由
使用者显式打开，README 的第一屏就写明代价。

## Alternatives considered

**「装了就生效」。** 那会让只是想要 ①（设置页能用）的人顺手放弃认证。一个有副作用的开关不该在装上
的一刻就改变这台机器的安全状态。

**只把 ② 留成显式，① 默认全放行。** `pageHosts` 也有代价：命中主机的页面被当成有宿主权限。而
「哪些主机算自己人」只有使用者知道，默认空表才让注入范围由配置决定。

## Consequences

- 环境变量走同一套语义：`DSH_TAILNET_ADMIN_DISABLE_AUTH` 只认 `1` / `true` / `on` / `yes`
  （根 [AGENTS.md](../../../../AGENTS.md) 硬约束第 3 条），typo 一律按「没开」处理。
- 环境变量优先于配置：环境变量在 systemd unit 这类运维位置，改 profile 重装不会被动到；配置跟着
  插件配置走。两者冲突时以环境变量为准。
