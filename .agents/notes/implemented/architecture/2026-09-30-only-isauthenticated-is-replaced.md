# Agent Note: 只替换 isAuthenticated，不拆栅栏

Status: implemented

## Problem

`/api` 的判定是两道叠加的门：

```
requestRejection = isTrustedApiRequest(host, trustedHosts)   // Host/Origin 栅栏
                 + browserAuth.isAuthenticated(request)      // 浏览器会话认证
```

要免掉「每次换 token」，可以换掉整个 `requestRejection`，也可以只换后一半。

## Decision

只把 `browserAuth.isAuthenticated` 换成常量 `true`；`isTrustedApiRequest` 与
`trustedHosts` 原样保留。跨站请求、伪造 Host 仍然会被拒。

## Alternatives considered

**把整个 `requestRejection` 置空。** 那是宿主给插件与页面共用的一道门，置空等于连栅栏一起拆掉：
「请求是不是来自我们声明的那个 authority」不再判断，DNS 重绑定类的场景直接就通了。收益仍然是
「谁都能进」，代价却比它大得多。

**按请求放宽栅栏（临时把 authority 塞进 `trustedHosts`）。** 那要改宿主判定的来源，
而 `--trusted-host` 本来就是给这件事准备的正规入口。

## Consequences

- 这一改的收益是「谁都能进」，代价也**仅止于**「谁都能进」——这是使用者明确选择要承担的那部分。
- `browserAuth` 形状不符时（不是带 `isAuthenticated` 方法的对象）一律不碰：认证这种边界上，
  宁可不动也不能猜着动。
- 「不动栅栏」同时是根 [AGENTS.md](../../../../AGENTS.md) 里的一条硬约束，文档里也不得暗示它
  可以放宽。
