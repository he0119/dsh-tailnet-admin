# AGENTS.md

本仓库的协作约定，给 AI 助手与贡献者看。安装与用法在 [README](README.md)（英文版
[README.en.md](README.en.md) 与它对齐），实现与取舍的「为什么」在 [docs/internals.md](docs/internals.md)，
怎么构建与本地验证在 [docs/development.md](docs/development.md)，发布在
[docs/releasing.md](docs/releasing.md)。文档、提交信息、给维护者的报告一律用中文。

## 文档分工

每条信息只写一处，别处放链接或一句话指过去：

| 文档 | 写什么 |
| --- | --- |
| `README.md` / `README.en.md` | 装什么、怎么装、开关表、安全边界；两份的键与结构保持对齐 |
| `AGENTS.md` | 本文件：协作约定、硬约束、提交信息口径、验证清单 |
| `docs/internals.md` | 为什么这么做：两层栅栏的分解、默认值的选择、踩过的坑 |
| `docs/development.md` | 怎么构建、怎么测、怎么装进一个 profile 手动验证 |
| `docs/releasing.md` | 发布流程、包名与 scope、首版为什么必须手动发 |

## 硬约束

改动不得越过这几条；越过之前先在这里说清楚理由：

1. **两个开关默认都不做事。** `pageHosts` 默认空表（不注入），`disableBrowserAuth` 默认 `false`。
   这是一个动认证边界的插件，"装了就生效"不是合适的默认值。
2. **不动 Host/Origin 栅栏。** 认证那层（`browserAuth.isAuthenticated`）可以按开关替换；栅栏那层
   （`isTrustedApiRequest` / `trustedHosts`）不许碰，也不许在文档里暗示它可以放宽。
3. **布尔量只认 `1` / `true` / `on` / `yes`。** 别改成"不是 false 就算真"：那会把一个手滑变成关认证。
4. **不引入运行时依赖。** 产物里只允许出现宿主提供的模块（peerDependencies）。插件在宿主进程里跑，
   多一个依赖就是多一份来源与版本风险。
5. **不往产物里写死任何机器相关的值。** 主机名、路径、端口只能来自配置或环境变量。
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

- `lib/` 不进 git，由 `prepare` 构建；因此**改了 `package.json` 的 `main`/`exports` 就要跑一次
  `pnpm run build` 再看效果**。
- 改了注入脚本的形状，就对着真实页面复核一次（浏览器里看 `<head>` 最前有没有那一行），别只信单测。
- 改了开关语义（名字、默认值、环境变量），README 两份、`cordis.patch.yml` 的注释、`src/options.ts`
  的常量必须一起改 —— 这四处任何一处落后都是错的。
