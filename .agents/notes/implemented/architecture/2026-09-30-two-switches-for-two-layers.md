# Agent Note: 两个开关，各自只动一层

Status: implemented

## Problem

从域名（Tailnet 服务名或反向代理）访问 DSH 会同时撞上两件事，而它们在不同的一侧。

**① 设置页不可用**，判定在**浏览器端**。DSH 的 Web Client 用 `connection.isLoopback`
决定设置走 host 持久化还是「进程内」：

```js
isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)
```

`transport` 就是 `globalThis.__DSH_TRANSPORT__`，普通网页里它是 `undefined`；
`pageLocation` 是 `window.location`。两者都不成立时设置镜像直接进 `unavailable`，模型页
拿到的是 `settings are unavailable in this browser`。

**② 每次重启都要重新换 token**，判定在**服务端**，而且是两层叠在一起的：

```
requestRejection = isTrustedApiRequest(host, trustedHosts)   // 栅栏：回环或声明过的 authority + 同源
                 + browserAuth.isAuthenticated(request)      // 认证：?token= 换来的、按 authority 绑定的 cookie
```

`?token=` 里的 token 每个进程重新生成（桌面壳之外没有别的入口），cookie 又有 authority 与
有效期两道约束，所以「换个地址就被踢」和「每 N 天要重新点一次链接」都是这一层的正常表现。

## Decision

拆成两个独立开关，各自只动一层：

- `pageHosts` 只动 ①：往启动 HTML 注入一行，把命中的页面标记成
  `globalThis.__DSH_TRANSPORT__ = { ownsHost: true }`。它不改变服务端的任何判定。
- `disableBrowserAuth` 只动 ② 的**后一半**：把 `browserAuth.isAuthenticated` 换成常量
  true，栅栏那一半原样保留（见
  [只替换 isAuthenticated](2026-09-30-only-isauthenticated-is-replaced.md)）。

## Alternatives considered

**加一个命令行参数。** `--trusted-host` 喂的是服务端 `/api` 的 Host/Origin 栅栏，而 ① 的判定
在**浏览器端**，不读它——加参数解决不了设置页。这正是本插件要注入脚本而不是加参数的原因。

**用一个总开关同时动两件事。** 两件事的代价差着量级：① 只是让设置页可用，② 是让能打开页面的人
拿到这台机器的控制权。合成一个开关等于把后者绑给只想解决前者的人。

## Consequences

- 两个开关可以各自单独使用，README 的开关表因此按「想解决哪一件事」组织。
- 两层的失败表现互不掩盖：设置页报 `unavailable` 是 ① 没生效，反复要 token 是 ② 没生效。
