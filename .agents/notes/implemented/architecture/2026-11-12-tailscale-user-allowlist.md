# Agent Note: 认证旁路改成 Tailscale 用户白名单

Status: implemented

## Problem

以前这个插件把 `browserAuth.isAuthenticated` 换成常量 `true`：token 的麻烦没了，但任何能打开
`https://dsh.example.ts.net` 的人都同时拿到了这台机器的读写、命令执行与已配置 API key。把访问控制完全
推给 Tailscale ACL 也不是不行，但插件无法在页面这一层确认「请求者是谁」；而 tailscale serve 其实已经把
这个信息放进了请求头。

## Decision

把「关掉浏览器会话校验」换成 `allowedUsers` 名单，默认空表（= 不做事）。名单非空时，向宿主的
`ctx.connection.authentication.register(provider)` 交一个校验器（要求 DSH `0.2.3-alpha.2` 起）：

- 请求带 `Tailscale-User-Login`：转小写后与名单整串比较，命中就返回插件建好的共享 `owner` Peer；
- 带了但不在名单里（或头值不可用）：返回 `undefined`，让下一个校验器继续问；
- 没带：同样返回 `undefined`，token / cookie 校验照旧。

Peer 用 `connection.createPeer({ principal: { kind: 'owner' } })` 建一次，所有名单用户共用。替换点只在
认证这一层，Host/Origin 栅栏与 `isTrustedApiRequest` / `trustedHosts` 没动。这条决策取代
[只替换 isAuthenticated，不拆栅栏](2026-09-30-only-isauthenticated-is-replaced.md) 里「替换成常量
`true`」的那一半，也取代那篇记录里「替换点始终在 isAuthenticated」的后半句。

Tailscale 的 [Serve 身份头](https://tailscale.com/docs/features/tailscale-serve#identity-headers) 说清了两件
事：头是 serve 加的，而且 serve 会先删掉入站请求里的同名头。插件依赖的正是这两条。

## 匹配规则

- 头名 `Tailscale-User-Login`，值按小写比较（登录名是邮箱，大小写不敏感）。
- 只做整串相等。没有通配符、后缀、正则、显示名；`Tailscale-User-Name` 不参与判断，因为它不是唯一标识。
- 空串、数组（重复头）、同一个头出现多个大小写/下划线变体、含逗号 / 空白 / 非 ASCII 的值一律
  不认领。这些值对不上任何登录名，猜一个只会让判断变得模棱两可。
- 名单每次请求现读 volatile 引用，改配置不重装、不重启。

## 接口的约束

- **不能否决。** 返回 `undefined` 只是让下一个校验器继续问；名单外的人如果自己有有效的登录 cookie，
  仍可能被令牌插件放进来。名单是一条"自动放行"的捷径，不是一道门。旧接口能直接答 false，宿主在
  0.2.3-alpha.1 把它删掉了，这个能力也随之消失。
- **注册顺序有意义。** 带 API 凭据的请求应当在令牌校验器那里被认领（它认得凭据，会给出带 RemoteAccess
  的 Peer）。插件在 profile 补丁里排在 web bundle 之后加载，因此注册在令牌之后；顺序反过来时，一个带
  API 凭据、又带身份头的请求会被这里当成 owner。
- **头值不可用的结局由别人定。** 重复头、空串、非 ASCII 一律不认领，最终能不能进取决于其它校验器。
- 名单匹配规则：转小写、整串相等、每请求现读。

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

**用来源 IP / `remoteAddress` 判断。** 宿主传给校验器的只有 `headers`
（`ConnectionTrustRequest` 只声明了这一面），拿不到可靠的来源地址；就算拿得到，本机进程也永远是回环。

**保留双路径。** 0.2.3-alpha.1 起 `browserAuth` 已被删除，旧路径在新宿主上只会静默不装；为了一个没人
运行的宿主版本维护两套替换点和两套测试，不如把插件下限直接抬到 `0.2.3-alpha.2`。

**用抛错表示拒绝。** `authenticate` 抛错会让 `admit` 记一次失败；如果其它校验器都没认领，结果是 503
（服务故障），不是"这个人被拒绝"——还会把本来能进的人挡成故障。

## Consequences

- 收益从「谁都能进」收窄成「名单里的人能进」；代价是要维护一份登录名。
- 名单外的人不会被自动放行，但他们自己的登录 cookie 仍然有效——插件没有否决权，最终由宿主的令牌
  校验决定。
- 没带身份头的访问仍然走原 token 校验，所以回环调试、Funnel、tagged device 不会因为插件而锁死。
- 本机是 tagged device 时（作者的服务器就是），从它自己发起的请求没有身份头；这不影响浏览器里的用户
  设备，但用 curl 在本机验证时走的是回落路径。
- 旧配置里的 `disableBrowserAuth: true` 会被 schema 静默忽略，效果是恢复认证；升级说明写在 README。
- `/connect` 的启动 token 交换仍然只认 token。拿到启动 token 的人仍能换到 API 凭据；带 API 凭据的
  请求由注册顺序保证先被令牌校验器认领，不会在这里被降成 owner。
