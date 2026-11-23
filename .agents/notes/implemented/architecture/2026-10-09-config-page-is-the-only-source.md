# Agent Note: 配置页是配置的唯一来源

Status: implemented

## Problem

装上之后，使用者没有任何地方能看到配置现在是什么状态。想改它，只能去改文件：profile 的
`cordis.patch.yml`，或者 systemd unit 里的环境变量 —— 而且改完还得重启 DSH。同一件事在同一个部署里
有两套来源（环境变量优先于配置），于是"我明明在配置里改了却没生效"这类现象出现时，得先想到"是不是有个
同名环境变量"。这两份来源还各自拖着一套解析规则：环境变量是字符串，所以布尔量得认 `1` / `true` /
`on` / `yes` 这一串词，写到词表外面就按"没开"处理。

DSH 里其它插件不是这样：带配置的插件在侧边栏**设置 → 插件**里都有一张配置表单。本插件明明有一个最适合
放在表单里的配置（登录名名单），却没有页面 —— 因为它压根没有 Web Client 端。

## Decision

`allowedUsers` 是 **volatile 配置字段**（`src/config.ts`），**插件配置页是它的唯一入口**：

- 页面挂在 `plugins.bundle.config` 槽位上（插件列表里本插件那张包页），`allowedUsers` 是多行文本，
  保存由官方 `SettingsForm` 那一套负责。
- 页面保存时落到 profile 的 `cordis.patch.yml` 里那一行的 `config` —— 与手工写文件完全等价，没有优先级。
- 环境变量整条路**删掉**：`DSH_TAILNET_ADMIN_*` 不再有任何作用，systemd unit 里那几行要一起删。
- 改配置**不需要重启**：Loader 提交 volatile 新值后只发一次 `loader/volatile-update`、不重挂插件，
  认证旁路在事件到达时对齐。

## 为什么 volatile 字段是唯一能上页面的形状

设置服务只投影带 `.volatile()` 的字段：配置表单要读"当前值"、要在别处改过之后重新对齐，而普通字段是
启动时解析一次就固定下来的值。代价是 volatile 更新**不会重挂插件**，只把新值就地面提交进原来那个引用，
再发一次实例内事件。于是认证旁路的安装/还原要由事件驱动，两边都幂等，作用域销毁时无条件还原。

`loader/volatile-update` 按 fiber 过滤（`owner.fiber === fiber`），因此这个订阅必须挂在插件自己的
`ctx` 上；挂在 `ctx.inject` 回调拿到的子上下文上收不到。

## 页面上的名单字段

`allowedUsers` 是多行文本：一行一条 Tailscale 登录名，匹配是「转小写后整串相等」，页面只接受可打印
ASCII，把通配符、显示名、空格这类永远不会命中的写法当场挡住。提示与代价说明常驻在控件下面，不做悬停才
出现的那一套。清空输入框并保存是 `clear`（回落到默认空表 = 不碰认证）。

## 第一次怎么开

配置页读写走 DSH 的设置接缝，登录后的公开地址上就能保存与生效；不再需要先绕回环地址。首次装上插件仍然
要重启：profile 的 bundle 清单与客户端的 `dsh.client` 都是启动时读的。

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

- systemd unit 里的 `DSH_TAILNET_ADMIN_*` 从此是无效设置，升级时要删掉；README 的排障表与
  `cordis.patch.yml` 的注释都改了。
- "手滑变成放行"的风险从词表解析移到 schema 与匹配规则：`allowedUsers` 不是字符串数组会被 Loader 直接
  拒绝；名单只做整串相等，没有通配符。根 `AGENTS.md` 硬约束第 3 条按这个事实重写。
- 插件从"只有 Host 端"变成两端：多了一份 `lib/client.js`、一个 `dsh.client` 声明、一份内联的 CSS、一份
  客户端字典，以及一条只在两者之间成立的契约 —— 设置命名空间必须等于 profile 里那一行的 entry id
  （`tailnet-admin`）。`test/client.test.ts` 把这几条都钉住了（含"`cordis.patch.yml` 里那一行的 id 就是
  页面用的命名空间"）。
- 改配置不再需要重启，但**首次装上插件仍然要重启**：profile 的 bundle 清单与客户端的 `dsh.client` 都是
  启动时读的。
- 默认值：`allowedUsers` 是空表（不碰认证）。
