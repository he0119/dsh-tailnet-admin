# Agent Note: 插件标题与描述来自包导出的 locale 元信息

Status: implemented

## Problem

插件列表里这一行的标题是 `@he0119/dsh-tailnet-admin`（设置 → 插件 的清单还会剥掉 npm scope，显示成
`tailnet-admin`），而它下面那行描述是中文。看起来像「标题漏翻了」，实际是两个字段各自沿不同的回退链落
到了不同来源。

宿主的插件展示元信息**不进插件代码**：`dsh-app-boot` 的 `readPluginMeta()` 用 Node 的 ESM 解析器解析
`<包名>/locale/en.json`，把同目录里其它 `*.json` 读成各语言字典；标题按 `locale meta.title` →
`package.json.name` → 完整 Cordis 插件名 逐级回退，描述按 `locale meta.description` →
`package.json.description` → 不显示描述 回退。本包此前只有 `package.json.description` 是中文，于是描述
「恰好」正常，标题露馅——直接调一次 `dsh-app-boot` 导出的 `readPluginMeta()` 就能看到 `title` 是完整
包名。

这条链上没有任何一步会报错：`en.json` 解析不到（文件不在，或 `exports` 没放行）就等于「这个包没有
locale 目录」，一个字典都不读，标题静默变成包名；本地测试全绿，装进 profile 才现形。图标走的是相邻的
另一条路（`iconOf()` 读 `package.json` 的 `icon`），本包已经在
[icon.svg](../../../../icon.svg) 上用过一次。

## Decision

随包发布两份展示元信息（[locale/en.json](../../../../locale/en.json)、
[locale/zh.json](../../../../locale/zh.json)），字段只有 `meta.title` 与 `meta.description`；
[package.json](../../../../package.json) 的 `exports` 加 `"./locale/*.json": "./locale/*.json"`，
`files` 加 `locale/*.json`。

- `en.json` 是**发现入口**，不是「英文兜底」：宿主先解析到它，再去 readdir 它所在目录。所以中文那份以
  英文那份存在为前提，不能只发 `zh.json`。
- 文件名就是语言键，形状要匹配宿主的 `LANGUAGE_ID`（`zh`、`zh-CN` 这类）。
- 文案面向插件列表里那一行，写一句人话，不照抄 `package.json.description`（那是给 npm 检索用的技术
  描述）。中文标题「Tailnet 管理」、描述「在 Tailnet 或反向代理域名下打开页面时，让设置页照常可用，
  并可关闭浏览器会话校验。」，英文一份同义。
- [test/locale.test.ts](../../../../test/locale.test.ts) 把这条链上会静默失败的地方钉住：`en.json` 在、
  每个文件名是语言 id、各语言 `meta` 的键集与英文一致、`exports` 与 `files` 真的放行了
  `locale/*.json`。最后一条不核字面量，直接问 `import.meta.resolve()` 要
  `<包名>/locale/en.json` 的路径——这正是宿主走的那一步。

## Alternatives considered

- **只发 `locale/zh.json`**：宿主的发现入口是常量 `en.json`，单独一份中文文件不会被 readdir 到；中文
  标题不会出现，也不会报错。
- **只把 `package.json.description` 改成人话**：描述确实会回退到它，但标题没有对应的回退位（`name`
  只能是 npm 包名）；而且同一个字段还服务 npm 的检索与项目主页，两个受众要的东西不一样。
- **加进 `files` 但不加进 `exports`**：Node 的 ESM 解析器受 `exports` 限制，拿到的是
  `ERR_PACKAGE_PATH_NOT_EXPORTED`，宿主把这一类错误当成「没有 locale 目录」跳过——文件在包里也没用。
- **在插件源码里写死一份展示文案**：宿主读元信息时**不激活插件**，`apply()` 里做的事到不了插件列表那
  一行；本插件又是纯 Host 半侧、没有客户端字典可挂。
- **门禁只核 `exports` 里的字面条目**：写成 `./locale/*.yaml` 或漏掉 `files` 时自检照旧全绿，而标题照样
  回退；让解析器真的解析一次，这两处才会一起红。

## Consequences

- 插件管理页与设置里的插件清单，标题变成「Tailnet 管理」/ "Tailnet Admin"，描述换成上面那一句；界面
  语言切到哪份就读哪份。读元信息不激活插件，所以关掉的、以及预设里的插件同样显示。
- 改标题与描述从此改 `locale/*.json`；`package.json.description` 只剩 npm 检索与 locale 缺失时的回退
  两份作用，两边不再需要对齐。
- 包体多两个 JSON（两份合计不到 400 字节），发布白名单靠 `files` 里的 `locale/*.json`。
- 新加的 `./locale/*.json` 要等宿主**下一次启动**才读得到：同一个运行期里 `./package.json` 照旧可读
  （图标与描述回退不受影响），但解析器认得的是启动时那份导出台账。实测：改动前启动的实例仍显示包名，
  改动后启动的实例显示「Tailnet 管理」——新装或升级这个包之后要重启宿主，别把这条当"没生效"。
- 这条元信息与两个开关无关：它只改显示，不放宽任何认证或栅栏。
