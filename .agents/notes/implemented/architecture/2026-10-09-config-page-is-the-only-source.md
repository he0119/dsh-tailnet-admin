# Agent Note: 配置页是开关的唯一来源

Status: implemented

## Problem

装上之后，使用者没有任何地方能看到这两个开关现在是什么状态。想打开其中任何一个，只能去改文件：profile 的
`cordis.patch.yml`，或者 systemd unit 里的两行环境变量 —— 而且改完还得重启 DSH。同一件事在同一个部署里
有两套来源（环境变量优先于配置），于是"我明明在配置里改了却没生效"这类现象出现时，得先想到"是不是有个同名
环境变量"。这两份来源还各自拖着一套解析规则：环境变量是字符串，所以布尔量得认 `1` / `true` / `on` / `yes`
这一串词，写到词表外面就按"没开"处理。

DSH 里其它插件不是这样：带配置的插件在侧边栏**设置 → 插件**里都有一张配置表单。本插件明明有两个最适合
放在表单里的开关（一个主机表、一个布尔），却没有页面 —— 因为它压根没有 Web Client 端。

## Decision

两个开关都是 **volatile 配置字段**（`src/config.ts`），**插件配置页是它们的唯一入口**：

- 页面挂在 `plugins.bundle.config` 槽位上（插件列表里本插件那张包页），`pageHosts` 是多行文本，
  `disableBrowserAuth` 是开关（`Switch`），保存由官方 `SettingsForm` 那一套负责。
- 页面保存时落到 profile 的 `cordis.patch.yml` 里那一行的 `config` —— 与手工写文件完全等价，没有优先级。
- 环境变量整条路**删掉**：`DSH_TAILNET_ADMIN_PAGE_HOSTS` 与 `DSH_TAILNET_ADMIN_DISABLE_AUTH` 不再有任何
  作用，systemd unit 里那两行要一起删。
- 改开关**不需要重启**：Loader 提交 volatile 新值后只发一次 `loader/volatile-update`、不重挂插件，插件自己
  跟上 —— 注入行在每次渲染 index.html 时按当前规则重算（`src/index.ts`），认证旁路在事件到达时对齐。

## 为什么 volatile 字段是唯一能上页面的形状

设置服务只投影带 `.volatile()` 的字段：配置表单要读"当前值"、要在别处改过之后重新对齐，而普通字段是
启动时解析一次就固定下来的值。代价是 volatile 更新**不会重挂插件**，只把新值就地面提交进原来那个引用，
再发一次实例内事件。于是插件的两个安装点都不能写成"启动时算一次"：

- 注入行：订阅只注册一次，内容每次渲染时重算；
- 认证旁路：安装/还原由事件驱动，两边都幂等，作用域销毁时无条件还原。

`loader/volatile-update` 按 fiber 过滤（`owner.fiber === fiber`），因此这个订阅必须挂在插件自己的 `ctx`
上；挂在 `ctx.inject` 回调拿到的子上下文上收不到。

## 页面上的那两个字段

`pageHosts` 是字符串数组，官方设置表单按"草稿文本"组织，中间的换算与校验在 `src/client/rules.ts`：一行
一条（也认逗号）。**命不中的写法在页面上当场挡住保存** —— 注入脚本只认 `*`、`.` 开头的后缀、精确主机名
三种，而 `*.ts.net`、`https://a`、`a:3080` 这类写法在配置文件里完全合法、永远不会命中，现象与"没开一样"。
配置文件那条路没有这一层，页面是唯一能在写之前说话的地方。

`disableBrowserAuth` 用开关而不是文本框：它改的是认证边界，不该让人手打 `true`；提示与代价说明常驻在
控件下面，不做悬停才出现的那一套。

## 第一次怎么开

配置页的写入走 DSH 的设置接缝：**页面没有被当作「本机」时是内存模式**，改动只留在浏览器里。而"页面被
当作本机"正是 `pageHosts` 要解决的问题，于是首次配置有一个先有鸡还是先有蛋的环节。两条能走的路：

1. 从回环地址打开一次 DSH（`http://localhost:<port>`），在配置页里填 `pageHosts`；
2. 直接改 profile 的 `cordis.patch.yml`（README 里给了那一段）。

这是 DSH 设置接缝的既有性质，不是本插件引入的；配置页会明说"只写进这个浏览器"，README 的排障表也列了
这一行。

## Alternatives considered

**保留环境变量优先。** 牺牲的是"只有一个地方能改"：两套来源意味着每个"没生效"都要先排除另一套，而它换来
的好处（把开关放在 systemd unit 这类运维位置）对一个改一次就不动的开关并不值。环境变量在这里唯一真正方便
的场景（首次 bootstrap）由回环地址或手写 patch 覆盖。

**环境变量降级为兜底（配置为空时读它）。** "我把这个开关清空了"与"我没配置过"于是变成两件不同的事，而这
两件事在页面上看起来一样；保留它就得连词表解析一起保留。

**只留环境变量，配置页只做只读展示。** 不可编辑的开关等于没有页面，使用者还是得去改文件 —— 那正是这次要
解决的问题。

**挂 `plugins.row.config`（行上的"配置"控件）而不是包页。** 本插件只有一行，包页就是它的全部：挂行上会多
出 `#tailnet-admin` 这样的键，还要多点一次才能看到表单。多行插件（如 dsh-aperture）才需要行级槽位。

## Consequences

- systemd unit 里那两行 `Environment=DSH_TAILNET_ADMIN_*` 从此是无效设置，升级时要删掉；README 的排障表
  与 `cordis.patch.yml` 的注释都改了。
- "手滑变成打开"的风险从词表解析移到 schema：`disableBrowserAuth: 'true'`（字符串）会被 Loader 直接拒绝，
  而不是被当成 `true`。根 `AGENTS.md` 硬约束第 3 条按这个事实重写。
- 插件从"只有 Host 端"变成两端：多了一份 `lib/client.js`、一个 `dsh.client` 声明、一份内联的 CSS、一份
  客户端字典，以及一条只在两者之间成立的契约 —— 设置命名空间必须等于 profile 里那一行的 entry id
  （`tailnet-admin`）。`test/client.test.ts` 把这几条都钉住了（含"`cordis.patch.yml` 里那一行的 id 就是
  页面用的命名空间"）。
- 改开关不再需要重启，但**首次装上插件仍然要重启**：profile 的 bundle 清单与客户端的 `dsh.client` 都是
  启动时读的。
- 默认值没有变：两个开关装上时依旧都是"什么都不做"（见
  [2026-09-30-switches-default-to-off.md](2026-09-30-switches-default-to-off.md)）。
