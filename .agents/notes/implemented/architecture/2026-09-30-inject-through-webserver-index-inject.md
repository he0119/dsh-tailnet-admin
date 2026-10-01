# Agent Note: 注入走 webserver/index-inject

Status: implemented

## Problem

要让命中主机的页面被当成「本机」，得在客户端读 `globalThis.__DSH_TRANSPORT__` **之前**把那个
标志位放好。放它的位置有几条路，代价差别很大。

## Decision

订阅官方扩展点 `webserver/index-inject`，往注入表里 push 一行
`{ kind: 'script', placement: 'head', text: script }`。

`placement` 取 `head`：渲染器把它插在 `<head>` 开标签之后、**早于**入口模块脚本，因此客户端读
`__DSH_TRANSPORT__` 时它已经就位。index.html 是每次请求现读现渲染的
（`dsh-host-frontend-static` 里那句 `await readFile(distIndex, …)`），所以改完刷新即生效、
不必重启。

## Alternatives considered

| 做法 | 为什么不用 |
| --- | --- |
| 改 `@deepseek-ai/dsh-web-frontend/dist/index.html` | 改的是安装目录里的文件，升级即丢；而且是「所有来源」的页面都生效，没法按主机收窄 |
| 改客户端插件（`dsh-client-ui-settings` 等）的判定 | 要动别人的包，且判定散在多个包里；升级一样会丢 |

## Consequences

- 注入行是插件自己的代码，升级宿主不受影响，并且能按主机收窄。
- 脚本里三处写法是刻意的：`__DSH_TRANSPORT__` 已存在时让路（桌面壳会自己注入这个对象）；规则表用
  `JSON.stringify` 内联并把 `<` 转义成 `\u003c`（规则里带 `</script` 也关不掉这个元素）；用 `var`
  与显式索引循环（这是一段经典脚本，注入位置在 `<head>` 最前，不假设任何后置语法）。
