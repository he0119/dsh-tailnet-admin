# Agent Note: 认证旁路改成 Tailscale 用户白名单

Status: implemented

## Problem

以前这个插件把 `browserAuth.isAuthenticated` 换成常量 `true`：token 的麻烦没了，但任何能打开
`https://dsh.example.ts.net` 的人都同时拿到了这台机器的读写、命令执行与已配置 API key。把访问控制完全
推给 Tailscale ACL 也不是不行，但插件无法在页面这一层确认「请求者是谁」；而 tailscale serve 其实已经把
这个信息放进了请求头。

## Decision

把「关掉浏览器会话校验」换成 `allowedUsers` 名单，默认空表（= 不做事）。名单非空时，把
`connection.browserAuth.isAuthenticated` 换成：

- 请求带 `Tailscale-User-Login`：转小写后与名单整串比较，命中放行；
- 带了但不在名单里（或头值不可用）：拒绝；
- 没带：调用宿主原来的方法，token / cookie 校验照旧。

`authenticateApi` 存在时按同一份名单包装：名单外的 API 凭据同样拿不到 `PeerId`。名单内但带着 API
凭据的请求，`isAuthenticated` 会让位给 `authenticateApi` —— `admit` 先问前者、再问后者，如果前者对
API 请求也答 true，`admit` 会把它降级成共享的 `browserPeer`，operator 身份与交互声明一起丢掉。
替换点仍然只在认证这一层，Host/Origin 栅栏与 `isTrustedApiRequest` / `trustedHosts` 没动。这条决策取代
[只替换 isAuthenticated，不拆栅栏](2026-09-30-only-isauthenticated-is-replaced.md) 里「替换成常量
`true`」的那一半。

Tailscale 的 [Serve 身份头](https://tailscale.com/docs/features/tailscale-serve#identity-headers) 说清了两件
事：头是 serve 加的，而且 serve 会先删掉入站请求里的同名头。插件依赖的正是这两条。

## 匹配规则

- 头名 `Tailscale-User-Login`，值按小写比较（登录名是邮箱，大小写不敏感）。
- 只做整串相等。没有通配符、后缀、正则、显示名；`Tailscale-User-Name` 不参与判断，因为它不是唯一标识。
- 空串、数组（重复头）、同一个头出现多个大小写/下划线变体、含逗号 / 空白 / 非 ASCII 的值判为不可用并
  拒绝。这些值对不上任何登录名，猜一个只会让判断变得模棱两可。
- 名单每次请求现读 volatile 引用，改配置不重装、不重启。

## 部署前提

身份头是 tailscale serve 加的，不是 DSH 自己验的。因此：

- DSH 必须只监听回环地址（默认 `127.0.0.1`）；否则能直连这个端口的人可以自己写这个头。官方文档也把
  「后端只监听 localhost」写成使用身份头的前提。
- Funnel 与 tagged device 的请求没有身份头，会回落到 token 校验。
- 共享节点的外部用户带的是自己的登录名；不在名单里就进不来。

## Alternatives considered

**保留 `disableBrowserAuth` 布尔开关，再叠加一份名单。** 两个开关组合出四种状态，其中「开着但不填名单」
仍然等于谁都能进，正是这次要消掉的形状；迁移时也容易把旧的 `true` 留着。

**只靠 Tailscale ACL。** ACL 能决定谁能连到这个服务，但插件无法在页面里确认请求者是谁；而且共享节点、
tagged device 与同一台机器上的本地进程都不在 ACL 的「用户」维度里。名单是页面这一层能拿到的最小事实。

**按显示名或设备名匹配。** 显示名可改、可重复；设备名不回答「是谁」。

**支持通配符或域名后缀。** 写错一个 `*` 就把整份名单作废，而这类错误在界面上看不出来；需要放行一个域时
逐条写出来更贵，但可审计。

**用来源 IP / `remoteAddress` 判断。** 宿主传给 `isAuthenticated` 的只有 `headers`
（`ConnectionTrustRequest` 只声明了这一面），拿不到可靠的来源地址；就算拿得到，本机进程也永远是回环。

## Consequences

- 收益从「谁都能进」收窄成「名单里的人能进」；代价是名单外的人即使有 token，也会被带身份头的请求挡下，
  以及要维护一份登录名。
- 没带身份头的访问仍然走原 token 校验，所以回环调试、Funnel、tagged device 不会因为插件而锁死。
- 本机是 tagged device 时（作者的服务器就是），从它自己发起的请求没有身份头；这不影响浏览器里的用户
  设备，但用 curl 在本机验证时走的是回落路径。
- 旧配置里的 `disableBrowserAuth: true` 会被 schema 静默忽略，效果是恢复认证；升级说明写在 README。
- 只包装 `isAuthenticated` / `authenticateApi`；`/connect` 的启动 token 交换仍然只认 token。拿到启动
  token 的人仍能换到 API 凭据，但凭据随后在名单外会被 `authenticateApi` 拦下。
