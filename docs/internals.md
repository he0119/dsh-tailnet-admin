# 为什么是这样

[README](../README.md) 说怎么用，[development.md](development.md) 说怎么构建与本地验证，
[releasing.md](releasing.md) 说发布。

每条决策的依据、被否决的做法与代价都在 `.agents/notes/implemented/` 下，下面按主题指过去；这里只
留没有记录承载的部分：跨插件的分工查表。

## 决策地图

**两件事是怎么分开的**

- [两个开关，各自只动一层](../.agents/notes/implemented/architecture/2026-09-30-two-switches-for-two-layers.md)：
  ① 的判定在浏览器端（`isLoopback`），② 的判定在服务端（栅栏 + 会话认证），`--trusted-host`
  只喂后者。

**① 让命中主机的页面被当成「本机」**

- [注入走 webserver/index-inject](../.agents/notes/implemented/architecture/2026-09-30-inject-through-webserver-index-inject.md)：
  官方扩展点、`placement: head`、改完刷新即生效。
- [主机规则是子域边界匹配](../.agents/notes/implemented/architecture/2026-09-30-host-rules-are-subdomain-bounded.md)：
  `.ts.net` 命中子域、不命中裸域名，也不命中 `evilts.net`。

**② 免掉每次换 token**

- [只替换 isAuthenticated，不拆栅栏](../.agents/notes/implemented/architecture/2026-09-30-only-isauthenticated-is-replaced.md)：
  收益是「谁都能进」，代价也止于这里。

**安全上的共同表态**

- [两个开关默认都不做事](../.agents/notes/implemented/architecture/2026-09-30-switches-default-to-off.md)：
  默认值不改变这台机器的安全状态。

**宿主会重放**

- [apply 会跑不止一次，替换要记引用计数](../.agents/notes/implemented/bug-fix/2026-09-30-apply-runs-more-than-once.md)。

## 与 `DSHW_ADMIN_HOSTS` 的关系

那是另一层、另一个插件的东西：`dsh-whale-widget` 自己有一道**写请求**栅栏，只认回环 Host 或它
自己的 `DSHW_ADMIN_HOSTS` 列表，宿主给的 `--trusted-host` 它不读。两者容易混：

| 需求 | 该动谁 |
| --- | --- |
| 设置页在域名下能用 | 本插件的 `pageHosts` |
| 不想每次换 token | 本插件的 `disableBrowserAuth` |
| 挂件（余额、音效等）在域名下能**保存** | `DSHW_ADMIN_HOSTS` |
| `/api` 整体不被 403 | `dsh web --trusted-host <authority>` |
| 配置管理插件的页面（备份/导入/配置管理） | 它自己的硬 `loopback-only` 栅栏，**任何环境变量都放不开**，只能走回环（SSH 隧道） |
