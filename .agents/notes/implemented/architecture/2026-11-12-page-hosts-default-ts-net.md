# Agent Note: pageHosts 默认 .ts.net

Status: implemented

## Problem

这个插件的使用场景就是 Tailnet 页面：`pageHosts` 要解决的问题（让设置页把域名页面当成本机）在
`*.ts.net` 上是默认会遇到的，但之前默认值是空表，于是每个新装的人都要先手动填一次 `.ts.net`。
更麻烦的是首次配置有一个先有鸡还是先有蛋的环节：`pageHosts` 没命中当前页面时，配置页只能写进浏览器，
所以第一次要么从回环地址打开，要么直接改 profile 文件。这是插件场景决定的重复劳动，不是使用者该做的选择。

但把字段整个删掉也不行：自定义域名和普通反向代理仍然需要它，而 `allowedUsers` 只对经过 tailscale serve
的请求有效，`pageHosts` 是独立的一层。

## Decision

`pageHosts` 的默认值改成 `['.ts.net']`（Tailnet 的 MagicDNS 后缀）。字段保留：自定义域名/反向代理仍然
在字段里加。`allowedUsers` 的默认值不变，仍是空表——认证边界默认不做事。

“没写这一项”和“显式空表”是两件事：

- 不写 `pageHosts`：用默认的 `.ts.net`；
- 写 `pageHosts: []`，或在配置页里清空并保存：**显式不注入**，不会回落到默认值；
- 配置页的「恢复默认」把用户层那一条去掉，回落到 `.ts.net`。

这条决策取代 [两项配置默认都不做事](2026-09-30-switches-default-to-off.md) 里 `pageHosts` 默认空表的
那一半；`allowedUsers` 默认空表、认证边界默认关闭的结论不变。

## 为什么不是自动识别

最理想的是"服务端看请求的 Host，自己判断是不是 Tailnet 域名"，但 `webserver/index-inject` 事件只带
`(table, peer)`，没有请求本身；注入发生在 index.html 渲染时，拿不到这次请求的 Host。客户端脚本能看到的
只有 `location.hostname`，它无法知道"这个 Tailnet 叫什么"，只能按后缀判断。因此默认值只能是 `.ts.net`
这样的后缀规则，而不是当前 tailnet 的精确域名。

## Alternatives considered

**写死 `.ts.net`，删掉字段。** 配置页会少一个控件，但自定义域名和普通反向代理从此没有入口；`pageHosts`
与 `allowedUsers` 是两层，不能因为认证只对 Tailscale 生效就把页面主机这一层也砍掉。

**保持默认空表。** 就是现状：每个 Tailnet 用户都要手动填一次，还要处理首次配置的回环绕行。插件的名字和
文档都说明它是为 Tailnet 页面准备的，这个默认值不匹配它的场景。

**加一个 `treatTsNetAsLocal` 布尔开关。** 结果一样，但配置页多一个控件、配置多一个字段；空表已经能
表达"不注入"，不需要再引入一个布尔。

**默认 `*`（所有主机）。** 等于放弃这条判定的隔离作用：任何反向代理域名都会被当成本机，而使用者没有
一个"只对 Tailnet 生效"的默认值可用。`.ts.net` 是范围更小的默认。

**按请求 Host 自动匹配。** 见上一节：注入事件没有请求，拿不到 Host；为了这一条去改宿主的路由或注入
时机，代价远大于收益。

## Consequences

- 新装即在 `*.ts.net` 页面生效，首次配置不再需要从回环地址绕一圈；自定义域名/反向代理仍然按原来的
  方式加一条。
- 显式写了 `pageHosts: []` 的配置保持"不注入"；删掉这一项的配置会开始用 `.ts.net`。升级说明写在
  README 里。
- 配置页空文本的写入从 `clear` 改成显式空表：清空并保存是"关掉"，点「恢复默认」才是回到 `.ts.net`。
- `.ts.net` 是**所有** Tailnet 的 MagicDNS 后缀，不只当前这一个。这个标志位只影响浏览器端的设置持久化，
  服务端的 Host/Origin 栅栏与认证仍然按原样判定；需要更窄的范围时，把这一项写成自己的完整后缀
  （例如 `.long-antares.ts.net`）即可。
- 根 `AGENTS.md` 硬约束第 1 条按新默认重写：认证边界默认不做事；页面主机默认 `.ts.net`，要关掉就显式
  设成空表。
