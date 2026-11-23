# Agent Note: 桌面应用冷启动先做一次同源重载

Status: implemented

## Problem

安卓把网页装成应用（WebAPK）后，从桌面图标冷启动的第一次请求会被 Chrome 标成
`Sec-Fetch-Site: cross-site`。这不是页面在跨站发起请求，而是浏览器对“从外部应用启动”的分类。DSH
0.2.3-alpha.2 起把 Host/Origin 栅栏从 `/api` 扩大到了网页请求，这类请求在认证之前就拿到 403，正文是
纯文本 `forbidden`；名单里的 Tailscale 用户也走不到 `connection.authentication`。普通浏览器标签页
不受影响。

## Decision

在 `webserver/request` 瀑布里加一跳，只对下面全部成立的请求写一个跳板页：

- `GET`；
- `Sec-Fetch-Site: cross-site`、`Sec-Fetch-Mode: navigate`、`Sec-Fetch-Dest: document`；
- 带 `Tailscale-User-Login`，且转小写后与 `allowedUsers` 整串相等；
- 路径不是 `/api` 或 `/connect`。

跳板页只有 `<meta http-equiv="refresh">` 和一个链接，把同一个路径与查询重新打开；响应 `no-store`、
`default-src 'none'` 的 CSP、`nosniff`、`no-referrer`。第二次请求由同一个页面发起，浏览器按
`same-origin` 标记，Host/Origin 栅栏与认证照常走，名单里的用户由连接鉴权放进来。

跳板页不是准入：它没有应用数据、没有凭据、不能执行任何操作；真正的页面与接口仍然要过栅栏和认证。
名单为空、没带头、名单外、同源请求、子资源、接口和 `/connect` 都原样 `next()`。

## Alternatives considered

**改核心的 `isTrustedApiRequest`，让顶层网页跳转跳过跨站检查。** 这是根因所在的修法，但它属于 DSH
核心；本插件改不到，而且本地改 npx 安装目录会在下次升级/重装时被覆盖。上游修好后这段可以删。

**在 `webserver/authorize` 里用 `prepend` 抢在连接栅栏前面直接放行。** 那等于绕过 Host/Origin 栅栏，
和 [认证旁路只换认证那一层](../architecture/2026-11-12-tailscale-user-allowlist.md) 以及根 AGENTS.md
的硬约束 2 冲突；而且要对所有名单用户默认生效。

**把请求的 `Sec-Fetch-Site` 头改成 `same-origin` 再 `next()`。** 让栅栏相信一个不成立的事实，比补一跳
更难审计；改头还会影响同一请求上其他读这个头的插件。

**回 302 到同一个地址。** 重定向后的请求仍然带着原来的跨站来源标记，会再次命中跳板，形成循环；
`location.replace` / meta refresh 是同一页面发起的新导航，才会变成同源。

**什么都不做，等上游。** 安卓用户从桌面图标打开一直是 403；插件文档里承诺的“名单里的人直接进入”
在这条路径上不成立。

## Consequences

- 只覆盖带 `Tailscale-User-Login` 的 Tailnet 用户；用 token 登录的安卓应用仍然会在认证前拿到 403，
  要等上游修。Funnel 与 tagged device 没有这个头，行为不变。
- 冷启动多一次页面重载，正常情况下用户看不到。
- 跳板页在栅栏之前写出，但只对名单里的用户、且只对顶层网页跳转；它不读也不写任何应用状态。未声明的
  Host 若带着伪造的身份头，会先拿到这个空页面，重载后仍然 403。
- 上游修好后这段是冗余的；删掉 `src/launch-bootstrap.ts` 与入口里那一行即可。
