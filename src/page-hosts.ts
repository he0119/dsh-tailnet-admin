/**
 * 页面主机规则，以及注入到启动 HTML 里的那段脚本。
 *
 * 为什么需要它：DSH 的客户端只把两种情况当作「本机」—— 由桌面壳注入
 * `globalThis.__DSH_TRANSPORT__ = { ownsHost: true }`，或页面自身的 `location.hostname` 是回环
 * （`localhost` / `127.0.0.0/8` / `[::1]`）。从 Tailnet 服务名或反向代理进来的页面两者都不满足，
 * 于是 settings 走「进程内」持久化、模型与凭据页直接报 `settings are unavailable in this browser`。
 *
 * 这里做的就是第一种：在页面脚本之前把那个标志位放好。规则表让使用者自己决定哪些主机享受这个待遇，
 * 默认（空表）**一行都不注入**。
 */

/**
 * 单个主机是否命中规则表。
 *
 * 规则写法：`*` 命中一切；`.` 开头是**子域边界**匹配（`.ts.net` 命中 `dsh.example.ts.net`，
 * **不**命中裸 `ts.net`，也不命中 `evilts.net`）；其余为精确匹配。比较一律小写。
 * @param hostname - 页面主机名（`location.hostname`，不带端口）。
 * @param patterns - 已规整的规则表（见 options.normalizePageHosts）。
 * @returns 命中任意一条即为 true。
 */
export function pageHostMatches(hostname: string, patterns: readonly string[]): boolean {
  const host = hostname.trim().toLowerCase()
  if (host === '') return false
  for (const pattern of patterns) {
    if (pattern === '*') return true
    if (pattern.startsWith('.')) {
      // 后缀匹配：`ts.net` 自身不算命中 `.ts.net` —— 规则里的点是"子域边界"，不是任意字符。
      if (host.length > pattern.length && host.endsWith(pattern)) return true
      continue
    }
    if (host === pattern) return true
  }
  return false
}

/**
 * 生成注入到 `<head>` 的那段经典脚本。
 *
 * 几个刻意的写法：
 * - 先看 `__DSH_TRANSPORT__` 是否已存在 —— 桌面壳会自己注入它，那种情况下这里必须让路。
 * - 用 `var` 与显式索引循环：这是经典脚本，注入位置在 `<head>` 最前，不假设任何后置语法糖。
 * - 规则表用 `JSON.stringify` 内联；`<` 一律转义成 `\u003c`，规则里带 `</script` 也关不掉这个元素
 *   （官方渲染注入行时做的是同一件事）。
 * @param patterns - 已规整的规则表。
 * @returns 脚本正文；规则表为空时返回 undefined（= 不注入）。
 */
export function buildPageScript(patterns: readonly string[]): string | undefined {
  if (patterns.length === 0) return undefined
  const rules = JSON.stringify(patterns).replaceAll('<', '\\u003c')
  return 'if(!globalThis.__DSH_TRANSPORT__){var h=location.hostname.toLowerCase();'
    + `var p=${rules};`
    + 'for(var i=0;i<p.length;i++){var r=p[i];'
    + 'if(r==="*"||(r.charAt(0)==="."?h.endsWith(r):h===r))'
    + '{globalThis.__DSH_TRANSPORT__={ownsHost:true};break}}}'
}
