<p align="center">
  <img src="assets/icon.svg" alt="dsh-tailnet-admin" width="88" height="88">
</p>

<div align="center">

# dsh-tailnet-admin

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

</div>

按 Tailscale 登录名放行已登录的浏览器：从 Tailnet 打开 DSH 时不用再搬 `?token=`，Host/Origin 栅栏
保持不动。

> ⚠️ 这个插件会动到认证边界：**默认不做事**，装上去不会放宽任何访问。填 `allowedUsers` 之前，请先读
> [安全边界](#安全边界必读)。

## 它解决什么

从 `https://dsh.example.ts.net`（Tailnet 服务名）打开 DSH 时，宿主的 `/api` 判定是「Host/Origin 栅栏 +
浏览器会话认证」两层。认证那层要一个由 `?token=` 换来的、**按 authority 绑定**的 cookie；token 每次启动
都重新生成，cookie 换地址即失效。

`tailscale serve` 会在转发给 DSH 的请求上加 `Tailscale-User-Login`（请求者的登录名，例如
`alice@example.com`），并且会先删掉入站请求里的同名头，避免客户端自己伪造。插件向宿主的
`connection.authentication` 注册一个校验器，只认这个头：名单里的用户不再需要 token；没带这个头的访问
（没经过 tailscale serve、Funnel、tagged device）回落到原来的 cookie 校验。

登录之后，设置页、模型目录、插件配置在公开地址上都能正常用；只有 `通用设置` 里的「打开配置文件」
编辑器仍然只在本机地址出现。

## 安装

前提：Node `^22.19.0 || >=24.0.0`（与官方 DSH 一致）。

### 1. 装包

```sh
npx @deepseek-ai/dsh plugin --profile web add @he0119/dsh-tailnet-admin
```

发布产物里带着编译好的 `lib/`，安装时不需要授权任何构建脚本。本地改代码时直接装仓库目录（先
`pnpm run build`）：

```sh
npx @deepseek-ai/dsh plugin --profile web add link:/path/to/dsh-tailnet-admin
```

### 2. 注册为 bundle

`dsh plugin add` 只做 `pnpm add`。DSH 启动时**只读** profile 清单里的 `dsh.profile.bundles`，所以还要把
包名加进去：

```json
// ~/.dsh/profiles/web/package.json
"dsh": {
  "profile": {
    "bundles": [
      // …
      "@he0119/dsh-tailnet-admin"
    ]
  }
}
```

用图形界面也行：**设置 → 插件**里会列出「已安装但未启用」的包，启用一次做的是同一件事。

改完重启 DSH（systemd 部署的话：`systemctl --user restart dsh-web`）。启动日志里会出现
`[dsh-tailnet-admin] …` 那几行，说明插件到位了。

### 3. 填配置（配置页）

**设置 → 插件 → `dsh-tailnet-admin`**：本插件那张包页的描述下面就是配置表单。

- **不用 token 的 Tailscale 用户**：一行一条，写完整的 Tailscale 登录名（例如
  `alice@example.com`），不区分大小写。留空 = 不碰浏览器会话校验。填之前先读[安全边界](#安全边界必读)。

改完点**保存**，立刻生效，不需要重启 DSH。

登录名就是 Tailscale 管理后台里你的用户账号（通常是邮箱），不是设备名或显示名。插件没放行某个用户时
会把真实登录名打进日志（`[dsh-tailnet-admin] 没有自动放行不在 allowedUsers 里的…`），照着那一行填即可。

配置页在登录后的公开地址上就能保存，不必先绕回环地址。也可以直接写 profile 的 `cordis.patch.yml`：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: tailnet-admin            # 这一行的 id 是本插件的固定约定：配置页按它取这一段设置，别改
  name: '@he0119/dsh-tailnet-admin'
  config:
    allowedUsers:
      - alice@example.com    # 你在 Tailscale 里的登录名；留空 = 不碰认证
```

## 配置

| 配置 | 默认 | 作用 |
| --- | --- | --- |
| `allowedUsers` | `[]` | 哪些 Tailscale 登录名可以免掉浏览器会话校验。空表 = 不碰认证 |

两处写的是同一份配置：**插件配置页**（`设置 → 插件 → dsh-tailnet-admin`）保存时落到的就是 profile 里
`cordis.patch.yml` 那一行的 `config`；手工写文件与在页面上改完全等价，没有优先级之分。

- 名单一行一条；配置页里也认逗号，从本文档抄一行过去不用改。
- 命不中的写法会在配置页里**当场挡住保存**：登录名只认转小写后整串相等的可打印 ASCII（没有通配符，逗号、
  显示名、空格、非 ASCII 都不行）。写进去只会静默不生效，所以不如在保存前挡住。
- `allowedUsers` 不是字符串数组（例如写成单个字符串）会被 Loader **拒绝加载**，而不是被猜成一项。

systemd 部署只负责栅栏那一层，配置不走环境变量（见
[.agents/notes/implemented/](.agents/notes/implemented) 里的那条决策）：

```ini
[Service]
ExecStart=%h/.npm/_npx/<hash>/node_modules/.bin/dsh web --host 127.0.0.1 --port 3080 \
  --trusted-host dsh.example.ts.net --public-url https://dsh.example.ts.net/ --no-open
```

> `--trusted-host`（或 profile 里 connection 插件的 `trustedHosts`）是**另一条**独立要求：`/api` 的
> Host/Origin 栅栏只认回环或声明过的 authority。只填本插件的 `allowedUsers`、不给 `--trusted-host`，请求会在
> 栅栏那一步就被 403 掉。
>
> `--public-url`（DSH `0.2.1-alpha.1` 起）是纯广告位：它只改 DSH 报出去的地址 —— 打印与打开的启动
> URL、`DSH_WEB_URL`、给模型的方位提示；不配置监听、路由或 cookie 作用域，**也不放宽信任**，所以替不掉
> 本插件的任何一项配置。它的用处是让 `?token=` 换 cookie 落在你真正使用的 authority 上，不必再手工把
> token 搬到对外地址。

## 安全边界（必读）

`allowedUsers` 改的是「谁可以免 token 进这个界面」。填了名单之后：

- **名单里的用户**打开页面就等于拿到这台机器的控制权 —— 读写文件、执行命令、动用你在 DSH 里配置的
  API key。所以名单要短，只写真正需要远程管理这台机器的人。
- **名单外的 Tailscale 用户**：不会被自动放行，但插件只能**不认领**、不能否决：对方如果自己有
  有效的登录 cookie，仍可能被宿主的令牌校验放进来。
  名单是一条「不用 token 的捷径」，不是一道门。
  没带这个头的访问（没经过 tailscale serve、Funnel、tagged device）回落到原来的 token 校验；也就是说
  这个插件不会把「没有身份头的请求」当成已认证。
- **必须只监听回环地址。** 这个判断完全建立在「`Tailscale-User-Login` 是 tailscale serve 加的」之上。
  [Tailscale 官方也要求后端只监听 localhost](https://tailscale.com/docs/features/tailscale-serve#identity-headers)；否则任何能直接打到这个端口的人都能自己写这个头。`dsh web`
  默认监听 `127.0.0.1`，不要改成 `0.0.0.0` 或 Tailnet IP。Host/Origin 栅栏挡的是伪造 Host 与跨站请求，
  **不挡**能直连端口的人。
- **Tagged device 与 Funnel 没有身份头**：请求会回落到 token 校验，这份名单帮不了它们。
- **共享节点**：把设备分享给别人后，对方访问时带的是**对方自己的**登录名；不在名单里就进不来。
- 保留下来的是 **Host/Origin 栅栏**：只认回环 Host 或 `--trusted-host` / `trustedHosts` 声明过的
  authority，并拒绝 `Sec-Fetch-Site: cross-site`。它挡的是 DNS 重绑定与跨站请求，**不挡**「知道地址的人」。
- 设置页、模型目录与插件配置在登录后的公开地址上可用；「打开配置文件」编辑器只在回环地址出现。

> 宿主版本：本插件要求 DSH `0.2.3-alpha.2` 及以上。

建议的组合：`allowedUsers` 只写自己的登录名，别把「所有用 Tailscale 的人」都写进去。想撤回认证：在
配置页把名单清空（或删掉 `cordis.patch.yml` 里的 `allowedUsers`）即可 —— 立刻恢复 token 校验。没有
任何状态需要清理。

> 从旧版升级：原来的 `disableBrowserAuth: true` 已经不在 schema 里，Loader 会静默忽略它，效果等于把认证
> 恢复原样。把它换成 `allowedUsers` 名单，否则页面会重新开始要 token；旧配置里的 `pageHosts` 同样会被
> 忽略。

## 排障

| 现象 | 原因 |
| --- | --- |
| 请求直接 403 | Host/Origin 栅栏没过：给 `dsh web` 加 `--trusted-host <authority>` |
| 仍然要 `?token=` | `allowedUsers` 是空表；当前用户的登录名不在名单里；或者请求没经过 tailscale serve（tagged device、Funnel、直连），没有 `Tailscale-User-Login` |
| 名单里的用户也被拒 | 登录名写错（写成了显示名或设备名），或请求没经过 tailscale serve；看日志里「没有自动放行…」那一行的真实登录名 |
| 启动日志里没有 `[dsh-tailnet-admin]` | 包名没写进 `dsh.profile.bundles`，或包没装上（`dsh --profile web --dump-config \| grep tailnet-admin` 可确认） |
| 「打开配置文件」不见了 | 这个编辑器只在回环地址出现；从 Tailnet 打开时用不了 |
| 配置页整段说「读不到这一节」 | `cordis.patch.yml` 里那一行的 `id` 不是 `tailnet-admin`，或者那一行没被启用 |

## 开发

构建、测试、以及「装进一个专用 profile 再看页面」的手动路径写在
[docs/development.md](docs/development.md)；为什么这么实现、踩过什么坑在
[docs/internals.md](docs/internals.md)；发布流程（含首版为什么必须手动发）在
[docs/releasing.md](docs/releasing.md)。

```sh
pnpm install     # 会顺带跑 prepare，也就是一次完整构建
pnpm test        # 单元测试（离线）
pnpm run typecheck
pnpm run build
```

## License

[MIT](LICENSE)
