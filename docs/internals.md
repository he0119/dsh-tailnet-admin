# 为什么是这样

[README](../README.md) 说怎么用，[development.md](development.md) 说怎么构建与本地验证，
[releasing.md](releasing.md) 说发布。

每条决策的依据、被否决的做法与代价都在 `.agents/notes/implemented/` 下，下面按主题指过去；这里只
留没有记录承载的部分：跨插件的分工查表。

## 决策地图

**免掉每次换 token，但只放行指定的人**

- [只换认证那一层，不拆栅栏](../.agents/notes/implemented/architecture/2026-09-30-only-isauthenticated-is-replaced.md)：
  替换点留在认证这一层，栅栏不动的结论仍然成立。
- [认证旁路改成 Tailscale 用户白名单](../.agents/notes/implemented/architecture/2026-11-12-tailscale-user-allowlist.md)：
  读 `Tailscale-User-Login`，名单内放行、名单外拒绝、没带头回落 token。

**安全上的共同表态**

- [认证边界默认不做事](../.agents/notes/implemented/architecture/2026-09-30-switches-default-to-off.md)：
  `allowedUsers` 默认空表，默认值不改变这台机器的安全状态。

**配置的取值只有一个来源**

- [配置页是配置的唯一来源](../.agents/notes/implemented/architecture/2026-10-09-config-page-is-the-only-source.md)：
  `allowedUsers` 是 volatile 字段（设置服务只投影这一种），页面挂在 `plugins.bundle.config`、写的就是
  profile 的 `cordis.patch.yml` 里那一行的 `config`；环境变量那条路已删。改配置不重启：认证旁路在
  `loader/volatile-update` 到达时对齐。

**不再注入页面脚本**

- [去掉 pageHosts](../.agents/notes/implemented/simplification/2026-11-23-remove-page-hosts.md)：设置页靠
  登录后的 owner Peer 使用；只有 `通用设置` 里的配置文件编辑器读 `isLoopback`，留在本机地址。

**宿主会重放**

- [apply 会跑不止一次，替换要记引用计数](../.agents/notes/implemented/bug-fix/2026-09-30-apply-runs-more-than-once.md)。

**插件列表里那一行**

- [标题与描述来自包导出的 locale 元信息](../.agents/notes/implemented/bug-fix/2026-10-08-plugin-title-comes-from-exported-locale.md)：
  外壳读 `<包名>/locale/*.json` 的 `meta.title` / `meta.description`（`en.json` 是发现入口），读不到就
  回退成包名——`en.json`、`zh.json`、`exports` 里的 `./locale/*.json` 三样缺一即静默回退；同一行的
  图标是另一条路，走 `package.json` 的 `icon`。

## 跨插件的分工

域名下用得顺不顺，取决于几道互相独立的判定；本插件只负责认证这一项：

| 需求 | 该动谁 |
| --- | --- |
| 设置页在域名下能用 | 宿主的远程登录（登录后拿到的 owner Peer）；本插件不参与 |
| 不想每次换 token，但仍只想让指定的人进 | 本插件的 `allowedUsers`（Tailscale 登录名名单） |
| 请求者的 Tailscale 身份从哪来 | `tailscale serve` 加的 `Tailscale-User-Login`（Funnel 与 tagged device 没有） |
| 改这项配置 | 本插件的配置页（**设置 → 插件 → dsh-tailnet-admin**），等价地写 profile 的 `cordis.patch.yml` |
| `/api` 整体不被 403 | `dsh web --trusted-host <authority>` |
| 配置管理插件的页面（备份/导入/配置管理） | 它自己的硬 `loopback-only` 栅栏，没有任何开关能放开，只能走回环（SSH 隧道） |
