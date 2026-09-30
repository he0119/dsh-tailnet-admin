# 为什么是这样

[README](../README.md) 说怎么用，这里说为什么这么实现、以及哪些做法是踩过坑之后才定下来的。

## 两个问题是两层的，不能混着修

从域名访问 DSH 会同时撞上两件事，它们在不同的一侧：

**① 设置页不可用** —— 判定在**浏览器端**。DSH 的 Web Client 用
`connection.isLoopback` 决定设置走 host 持久化还是"进程内"：

```js
isLoopback: transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname)
```

`transport` 就是 `globalThis.__DSH_TRANSPORT__`，普通网页里它是 `undefined`；`pageLocation` 是
`window.location`。所以只有桌面壳注入的标志位、或页面自身是回环主机名，两者之一成立时它才是 true。为 false
时设置镜像直接进 `unavailable`，模型页拿到的是 `settings are unavailable in this browser`。

**服务端的 `--trusted-host` 改不了它**：那个参数喂的是 `/api` 的 Host/Origin 栅栏，浏览器端不读它。这就是
本插件要注入脚本、而不是加一个命令行参数的原因。

**② 每次重启要重新换 token** —— 判定在**服务端**，而且是两层叠在一起的：

```
requestRejection = isTrustedApiRequest(host, trustedHosts)  // 栅栏：回环或声明过的 authority + 同源
                 + browserAuth.isAuthenticated(request)     // 认证：?token= 换来的、按 authority 绑定的 cookie
```

`?token=` 里的 token 每个进程重新生成（桌面壳之外没有别的入口），cookie 又有 authority 与有效期两道约束，
所以"换个地址就被踢"和"每 N 天要重新点一次链接"都是这一层的正常表现。

## 于是拆成两个开关

`pageHosts` 只动 ①：往启动 HTML 注入一行，把命中的页面标记成
`globalThis.__DSH_TRANSPORT__ = { ownsHost: true }`。它不改变服务端任何判定 —— 栅栏原来拦什么还拦什么。

`disableBrowserAuth` 只动 ② 的**后一半**：把 `browserAuth.isAuthenticated` 换成常量 true。栅栏那一半
（`isTrustedApiRequest`）原样保留，因此跨站请求、伪造 Host 仍然会被拒。

**为什么只替换 `isAuthenticated` 而不是整个 `requestRejection`。** 后者是宿主给插件与页面共用的一道门，
把它置空等于连栅栏一起拆掉：那样连"请求是不是来自我们声明的那个 authority"都不再判断，DNS 重绑定类的
场景直接就通了。替换前者的收益是"谁都能进"，代价也仅止于"谁都能进"——这是使用者明确选择要承担的那部分。

**为什么两个开关默认都关。** 这个插件的价值来自"少一次折腾"，而它的代价是"这台机器对能打开页面的人敞开"。
把后者做成默认值，等于让所有只是想要①的人也顺手放弃了认证。所以②必须显式打开，并且 README 的第一屏就
写明代价。

## 注入为什么走 `webserver/index-inject`

三条路都比过：

| 做法 | 为什么不用 |
| --- | --- |
| 改 `@deepseek-ai/dsh-web-frontend/dist/index.html` | 改的是安装目录里的文件，升级即丢；而且是"所有来源"的页面都生效，没法按主机收窄 |
| 改客户端插件（`dsh-client-ui-settings` 等）的判定 | 要动别人的包，且判定散在多个包里；升级一样会丢 |
| 订阅 `webserver/index-inject` | 官方扩展点（`dsh-client-ui-settings-models` 就这么发布引导配置）、插件自己的代码、升级不受影响、可按主机收窄 |

注入行的 `placement` 取 `head`：渲染器把它插在 `<head>` 开标签之后，**早于**入口模块脚本，因此客户端读
`__DSH_TRANSPORT__` 时它已经就位。index.html 是每次请求现读现渲染的（`dsh-host-frontend-static` 里那句
`await readFile(distIndex, …)`），所以改完刷新即生效、不必重启。

脚本里几个细节都是刻意的：

- `if(!globalThis.__DSH_TRANSPORT__)` —— 桌面壳会自己注入这个对象，那种情况下必须让路。
- 规则表用 `JSON.stringify` 内联，并把 `<` 转义成 `\u003c` —— 与官方渲染注入行时做的是同一件事，规则里
  带 `</script` 也关不掉这个元素。
- 用 `var` 和显式索引循环 —— 这是一段经典脚本，注入位置在 `<head>` 最前，不假设任何后置语法。

## 主机规则的语义

`.ts.net` 是**子域边界**匹配，不是"以这些字符结尾"：

- 命中 `dsh.example.ts.net`
- **不**命中裸 `ts.net`（规则里那个点表示"前面还有点东西"）
- 不命中 `evilts.net`（相同后缀但不是子域）

这三条都有单测钉着。要"什么都命中"就写 `*`，让使用者显式放弃这道收窄，而不是靠一个含混的后缀。

## 幂等：`apply` 会跑不止一次

实测启动日志里插件那句出现了两轮 —— 宿主会重放 `inject` 回调（服务重建、HMR 之类的路径）。因此：

- `disableBrowserAuth` 用 `WeakMap` 记引用计数：重复安装只加计数，最后一轮 `restore` 才真正还原原型上的
  方法。没有这个计数，"第一轮的清理"会把还在生效的那一轮一起拆掉。
- 注入行是每次渲染现组装的常量，重复注册订阅方只会让同一行被 push 两次 —— 浏览器端重复设置同一个标志位
  没有副作用，因此这里不需要额外去重。

## 与 `DSHW_ADMIN_HOSTS` 的关系

那是另一层、另一个插件的东西：`dsh-whale-widget` 自己有一道**写请求**栅栏，只认回环 Host 或它自己的
`DSHW_ADMIN_HOSTS` 列表，宿主给的 `--trusted-host` 它不读。两者容易混：

| 需求 | 该动谁 |
| --- | --- |
| 设置页在域名下能用 | 本插件的 `pageHosts` |
| 不想每次换 token | 本插件的 `disableBrowserAuth` |
| 挂件（余额、音效等）在域名下能**保存** | `DSHW_ADMIN_HOSTS` |
| `/api` 整体不被 403 | `dsh web --trusted-host <authority>` |
| 配置管理插件的页面（备份/导入/配置管理） | 它自己的硬 `loopback-only` 栅栏，**任何环境变量都放不开**，只能走回环（SSH 隧道） |
