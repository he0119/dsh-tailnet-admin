# 开发

安装与配置看 [README](../README.md)；这里放本地开发的流程与"怎么确认它真的生效"。"为什么是现在这样"在
[internals.md](internals.md)，发布在 [releasing.md](releasing.md)。

## 装依赖、构建、检查、测试

```sh
pnpm install               # 会顺带跑 prepare = prebuild + build，也就是一次完整构建
pnpm run build             # tsdown：lib/index.js（宿主）+ lib/types/（逐模块声明）
pnpm run typecheck         # tsc -p tsconfig.test.json（src + test + 构建配置）
pnpm test                  # 单元测试，离线
```

包管理器是 pnpm，版本由 `package.json` 的 `packageManager` 钉在 `pnpm@12.6.0`，经 corepack 生效。
两个与本仓库有关的坑：

- **pnpm 12 读 `pnpm-workspace.yaml` 里的 camelCase 键**。写成 `node-linker` 会被忽略并打一条 WARN，
  布局仍走 isolated；本仓库写的是 `nodeLinker: hoisted`。
- `pnpm install` 会跑 `prepare`。所以"改了 `src` 却看到旧行为"通常只是没重新构建，`pnpm run build` 一下。

`lib/` 不进 git（`.gitignore`），发布时由 `prepare` 现场编译。**因此"装进 profile 的 link 安装"依赖仓库
目录里存在 `lib/`** —— 拉下代码先 `pnpm install` 或 `pnpm run build`。

## 装进一个 profile 手动验证

单元测试只覆盖到"钩子接对了没有"。真正的行为要在页面上看，最小路径是装进你自己的 web profile：

```sh
pnpm run build
npx @deepseek-ai/dsh plugin --profile web add link:/path/to/dsh-tailnet-admin
```

然后把包名写进 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`（`dsh plugin add` 只做
`pnpm add`；设置 → 插件 里"启用"一次做的是同一件事），并在
`~/.dsh/profiles/web/cordis.patch.yml` 里给配置：

```yaml
- id: tailnet-admin
  name: '@he0119/dsh-tailnet-admin'
  config:
    pageHosts: [.ts.net]
```

重启 DSH（systemd：`systemctl --user restart dsh-web`），然后按这三条逐一确认 —— 它们分别证明一件不同的
事，任何一条不过就还没到"能用"：

```sh
# ① 插件到位：启动日志里有两行 [dsh-tailnet-admin]
grep 'dsh-tailnet-admin' ~/.dsh/dsh-web.log | tail -2

# ② 注入生效：无 cookie / 无 token 取根页面，200 且 HTML 里有注入（页面主机名要命中 pageHosts）
curl -s -H 'Host: dsh.example.ts.net' http://127.0.0.1:3080/ | grep -o '__DSH_TRANSPORT__[^<]*' | head -1

# ③ 栅栏还在：未声明的 Host 必须 403（开了 disableBrowserAuth 之后这条依然要成立）
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: evil.example.com' \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3080/api/whatever
```

③ 返回 403 才说明改动没有越过 [AGENTS.md](../AGENTS.md) 里的硬约束 2。浏览器那一侧最后再确认一次：打开
域名页面，看 `<head>` 最前有没有那行脚本（DevTools 里 `view-source:` 最直观），以及设置页是否不再报
`settings are unavailable in this browser`。

## 撤回

这个插件不留任何持久状态，撤回就是两件事：把配置里的开关关掉（或删掉环境变量、删掉 `pageHosts` 那一段），
重启。想彻底移除：从 `dsh.profile.bundles` 里删掉包名，可选再
`npx @deepseek-ai/dsh plugin --profile web remove @he0119/dsh-tailnet-admin`。
