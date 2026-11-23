# Agent Note: 去掉 pageHosts 页面注入

Status: implemented

## Problem

插件曾经用 `pageHosts` 往启动 HTML 里注入一行脚本，把命中的页面标成「本机」。它解决的是设置页在域名下
用不了：客户端只把桌面壳注入的 `ownsHost` 或回环主机名当作本机，域名页面两者都不满足。

这条绕过的代价是让浏览器端相信一个不成立的事实（这个远程页面有宿主权限），而同一个事实只被一处读取：
`通用设置` 里的配置文件编辑器。设置页、模型目录、插件配置走的是 `remote.settings` 的 RPC，凭登录后的
owner Peer 就能用。宿主的远程登录（二维码、登录链接、设备配对）让域名页面拿到正常的 owner 身份之后，
注入就失去了必要性。

## Decision

删掉 `pageHosts`：

- 配置 schema 去掉这个字段；旧 profile 里留着它会被忽略，不阻塞加载；
- 删掉 `src/page-hosts.ts`、`webserver/index-inject` 订阅与注入脚本；
- 配置页只保留 `allowedUsers` 一个控件；插件描述、README、AGENTS.md 与 docs 同步。

插件只剩一件事：向 `connection.authentication` 注册校验器，按名单放行 `Tailscale-User-Login`。

## Alternatives considered

**保留字段，默认 `.ts.net`。** 只为一处编辑器保留一条"让远程页面伪装成本机"的路径，代价是每个装插件的人
都要先理解 `isLoopback`；设置页已经不需要它。

**保留但默认空表。** 只是把默认值换掉；第一次用编辑器的人仍然要手动打开，插件描述与文档也得继续解释
两件事。

**只删注入，保留字段。** 字段还在、行为没了，配置页会多一个写了没用的输入框，比删掉更容易误导。

## Consequences

- 域名页面登录后，设置页、模型目录、插件配置都能用；`通用设置` 里的配置文件编辑器只在本机地址出现。
- 配置页少一个字段，文档与测试少一整层主机规则。
- 旧 profile 里的 `pageHosts` 被 schema 静默忽略，不需要迁移动作。
