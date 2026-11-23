<p align="center">
  <img src="assets/icon.svg" alt="dsh-tailnet-admin" width="88" height="88">
</p>

<div align="center">

# dsh-tailnet-admin

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

</div>

用 Tailscale 账号登录 DSH，不需要 token。

> ⚠️ 这个插件会动到认证边界：默认不做事，装上去不会放宽任何访问。填 `allowedUsers` 之前先读
> [安全边界](#安全边界必读)。

## 它做什么

从 Tailnet 打开 DSH 时，`tailscale serve` 会在请求里带上 `Tailscale-User-Login`。插件把这个登录名交给
宿主的连接鉴权：名单里的用户直接进入，其他人照旧登录。

登录后，设置页、模型目录、插件配置都能用。

从桌面图标打开（装成应用的网页）时，安卓会把第一次跳转标成“跨站”，新版 DSH 会在认证之前回
403。插件对名单里的用户先回一个不含任何数据的同源重载页，第二次请求就是同源，再走正常的栅栏与
认证；普通浏览器标签页不受影响。

## 安装

需要 Node `^22.19.0 || >=24.0.0` 与 DSH `0.2.3-alpha.2` 及以上。

```sh
npx @deepseek-ai/dsh plugin --profile web add @he0119/dsh-tailnet-admin
```

把包名加进 profile 的 `dsh.profile.bundles`，或在 **设置 → 插件** 里启用，然后重启 DSH：

```json
// ~/.dsh/profiles/web/package.json
"dsh": { "profile": { "bundles": ["@he0119/dsh-tailnet-admin"] } }
```

服务挂在反向代理或 Tailnet 地址上时，记得给 `dsh web` 加 `--trusted-host <你的域名>`，否则请求会卡在
Host/Origin 栅栏。

## 配置

**设置 → 插件 → dsh-tailnet-admin**：填 Tailscale 登录名，一行一个，保存即生效，不用重启。

```yaml
# 等价于在配置页里填；写 profile 也行
- id: tailnet-admin
  name: '@he0119/dsh-tailnet-admin'
  config:
    allowedUsers:
      - alice@example.com
```

| 配置 | 默认 | 作用 |
| --- | --- | --- |
| `allowedUsers` | `[]` | 免 token 登录的 Tailscale 登录名。空表 = 不碰认证 |

登录名是 Tailscale 管理后台里的用户账号（通常是邮箱），不是设备名或显示名。插件没放行某个用户时会把真实
登录名打进日志，照着填即可。

## 安全边界（必读）

- **名单里的人打开页面就等于拿到这台机器的控制权**：读写文件、执行命令、用你的 API key。名单要短。
- **名单外的人不会被自动放行，但插件不能否决**：对方如果自己有有效的登录 cookie，仍可能被放进来。
- **DSH 必须只监听 `127.0.0.1`**：这个判断建立在「身份头是 tailscale serve 加的」之上；直接暴露端口就能
  伪造。
- 没带身份头的请求（Funnel、tagged device、直连）仍然要求登录。
- **桌面应用的跳板页不含任何应用数据**：它只在名单里的 Tailscale 用户从桌面图标冷启动时出现，页面
  自己重载同一个地址；真正的页面与接口仍然要过 Host/Origin 栅栏和认证。

## 排障

| 现象 | 原因 |
| --- | --- |
| 请求 403 | 没给 `dsh web` 加 `--trusted-host`，Host/Origin 栅栏没过 |
| 仍然要登录 | `allowedUsers` 是空表、登录名不在名单里，或请求没经过 tailscale serve |
| 名单里的人也被拒 | 登录名写错；看日志里「没有自动放行…」那行的真实登录名 |
| 配置页读不到这一节 | `cordis.patch.yml` 里那一行的 `id` 不是 `tailnet-admin` |
| 从桌面图标打开先闪一下空白页 | 正常：插件先回同源跳板页，页面会立刻重载；停在 `forbidden` 见上面第一条 |

## 开发

构建、测试与本地验证见 [docs/development.md](docs/development.md)；实现细节见
[docs/internals.md](docs/internals.md)；发布见 [docs/releasing.md](docs/releasing.md)。
