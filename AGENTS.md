# AGENTS.md

本仓库的协作约定，给 AI 助手与贡献者看。安装与用法在 [README](README.md)（英文版
[README.en.md](README.en.md) 与它对齐），决策的依据与被放弃的做法在
[.agents/notes/](.agents/notes/AGENTS.md)，当前机制与跨插件分工在 [docs/internals.md](docs/internals.md)，
怎么构建与本地验证在 [docs/development.md](docs/development.md)，发布在
[docs/releasing.md](docs/releasing.md)。文档、提交信息、给维护者的报告一律用中文。

## 文档分工

每条信息只写一处，别处放链接或一句话指过去：

| 文档 | 写什么 |
| --- | --- |
| `README.md` / `README.en.md` | 装什么、怎么装、开关表、安全边界；两份的键与结构保持对齐 |
| `AGENTS.md` | 本文件：协作约定、硬约束、提交信息口径、验证清单 |
| `.agents/notes/` | 决策的依据、被否决的做法与代价；一条决策一篇，格式由 `test/notes.test.ts` 核 |
| `docs/AGENTS.md` | `docs/` 这一层的文档规范与写作规则 |
| `docs/internals.md` | 决策地图，以及没有记录承载的部分：跨插件的分工查表 |
| `docs/development.md` | 怎么构建、怎么测、怎么装进一个 profile 手动验证 |
| `docs/releasing.md` | 发布流程、包名与 scope、首版为什么必须手动发 |

一次改动**引入了新的决策**（安全边界、默认值、对外契约、修掉一个有现象可查的缺陷）时，与代码同一个
提交里写一篇记录，判据见 [.agents/notes/AGENTS.md](.agents/notes/AGENTS.md)；已经有一篇记录持有该
决策就更新它，不新建重复记录。措辞调整与纯局部实现细节豁免。

## 硬约束

改动不得越过这几条；越过之前先在这里说清楚理由：

1. **两个开关默认都不做事。** `pageHosts` 默认空表（不注入），`disableBrowserAuth` 默认 `false`。
   这是一个动认证边界的插件，"装了就生效"不是合适的默认值。
2. **不动 Host/Origin 栅栏。** 认证那层（`browserAuth.isAuthenticated`）可以按开关替换；栅栏那层
   （`isTrustedApiRequest` / `trustedHosts`）不许碰，也不许在文档里暗示它可以放宽。
3. **布尔量只认真正的布尔。** `disableBrowserAuth` 在 schema 层就是 `z.boolean()`：写 `'true'` / `'1'` /
   `'on'` 这类字符串会被 Loader **拒绝加载**（fail-closed），不许放宽成"解析字符串"或"不是 false 就算真"
   —— 那会把一个手滑变成关认证。
4. **不引入运行时依赖。** 产物里只允许出现宿主提供的模块（peerDependencies）：Host 端是包依赖，Web Client
   端是平台基线模块表（`react` / `react/jsx-runtime` 与 `@deepseek-ai/dsh-client-ui-primitives`），其余一律
   内联。插件在宿主进程与页面里跑，多一个依赖就是多一份来源与版本风险。
5. **不往产物里写死任何机器相关的值。** 主机名、路径、端口只能来自配置。
6. **注入的脚本必须让路。** `__DSH_TRANSPORT__` 已存在时（桌面壳）一律不覆盖；正文里不得出现
   `</script`。

## 提交信息

**只写这个提交做了什么、为什么这么做、有什么取舍。** 不写"按照要求"、不写"提升了健壮性"这类没有信息的
话，也不写本次会话的过程。标题照约定式提交（`feat:` / `fix:` / `docs:` / `chore:` …），PR 标题同样 ——
Release 日志的分组靠它（见 [docs/releasing.md](docs/releasing.md)）。

## 验证清单

改完至少跑这一串；涉及行为改动时再补上 [docs/development.md](docs/development.md) 里那条手动验证：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run typecheck
pnpm run build
```

- `lib/` 不进 git，由 `prepare` 构建；因此**改了 `package.json` 的 `main`/`exports`/`dsh.client` 就要跑一次
  `pnpm run build` 再看效果**。`lib/client.js` 是 Web Client 端唯一的入口，`test/client.test.ts` 直接读它
  （产物不在时那组用例跳过），所以改了 `src/client/` 也要先构建再测。
- `test/notes.test.ts` 只核**声明**：`.agents/notes/` 下的路径形状、三行头部、`Status:` 与所在目录
  是否一致、`## Problem` 是不是第一个二级标题、必备章节在不在、`implemented/` 里有没有混进提案
  用语、相对链接能不能解析。改记录格式就同一次改动里改它。
- 改了注入脚本的形状，就对着真实页面复核一次（浏览器里看 `<head>` 最前有没有那一行），别只信单测。
- 改了开关语义（名字、默认值、取值来源），README 两份、`cordis.patch.yml` 的注释、`src/config.ts` 的
  schema、以及配置页那两个字段（`src/client/rules.ts` 的规格与 `src/client/locales.ts` 的文案）必须一起改
  —— 这几处任何一处落后都是错的。
- 配置页的设置命名空间（`src/client/form.ts` 的 `SETTINGS_NS`）必须等于 profile 里那一行的 entry id：
  `test/client.test.ts` 拿 `cordis.patch.yml` 核这一条。

## Git

- **`main` 走 PR**：改动一律「推分支 → 开 PR → 合并」；PR 标题照约定式提交，Release 日志的分组靠它
  （见 [docs/releasing.md](docs/releasing.md)）。这个仓库的 `main` 目前没有服务端 ruleset，这条靠约定，
  `check` 由 CI 在 PR 上跑（`.github/workflows/ci.yml` 的 job id 就是它）。
- **没有明确指示不合并**：推分支、开 PR、把 PR 链接与验证结果交出来是默认动作；合并这件事要等维护者
  明说——`check` 绿了也只说明「可以合」，不说明「该我合」。
