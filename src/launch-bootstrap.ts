/**
 * 桌面应用冷启动的同源跳板。
 *
 * 安卓把网页装成应用（WebAPK）后，从桌面图标冷启动的第一次请求会被浏览器标成
 * `Sec-Fetch-Site: cross-site`——这是浏览器对“从外部应用启动”的分类，不是页面在跨站发起请求。
 * DSH 0.2.3-alpha.2 起，Host/Origin 栅栏覆盖了网页请求，这类请求在认证之前就拿到 403，名单里的
 * Tailscale 用户也永远走不到 `connection.authentication`。
 *
 * 这里在 `webserver/request` 瀑布里补一跳：只对“名单里的 Tailscale 用户 + 跨站顶层网页跳转”回一个
 * 不含任何数据的空页面，页面用 meta refresh 重载当前地址。第二次请求由同一个页面发起，浏览器按
 * `same-origin` 标记，栅栏与认证照常走。接口、WebSocket、名单外的请求都不经过这里。
 *
 * 为什么不在 `webserver/authorize` 里直接放行：那一层要么由宿主的连接栅栏先给出 403，要么只能抢在
 * 它前面自己判 Host——前者轮不到插件，后者等于绕过栅栏。跳板页不是准入：它没有应用数据、没有凭据，
 * 真正的页面请求仍然要过栅栏和认证。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { PluginConfig } from './config.ts'
import type { HostContext, HostServices, WebRequestListener } from './host.ts'
import { log } from './log.ts'
import { readLoginHeader } from './login-header.ts'
import { resolveOptions } from './options.ts'

/** 跳板页的响应头：不缓存、不允许任何子资源、不参与表单与框架。 */
const BOOTSTRAP_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const

/** HTML 属性转义：目标地址来自请求行，可能带 `&` 与引号。 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * 从请求行取“页面地址”。
 * @param raw - node:http 的 `request.url`（通常是 origin-form，代理场景下也可能是绝对形式）。
 * @returns 路径与查询；解析失败时 undefined。
 */
function requestTarget(raw: string | undefined): { readonly path: string; readonly target: string } | undefined {
  let url: URL
  try {
    url = new URL(raw ?? '/', 'http://dsh.invalid')
  } catch {
    return undefined
  }
  return { path: url.pathname, target: url.pathname + url.search }
}

/** 只处理应用页面；`/api` 与 `/connect` 保持原样。 */
function isAppDocumentPath(path: string): boolean {
  return path !== '/api' && !path.startsWith('/api/') && path !== '/connect' && !path.startsWith('/connect/')
}

/** 这一次请求是不是“从桌面图标冷启动”的顶层网页跳转。 */
function isColdLaunchDocument(request: IncomingMessage): boolean {
  const headers = request.headers
  return request.method === 'GET'
    && headers['sec-fetch-site'] === 'cross-site'
    && headers['sec-fetch-mode'] === 'navigate'
    && headers['sec-fetch-dest'] === 'document'
}

/** 请求里的 Tailscale 登录名是否在名单里；名单每次现读。 */
function isAllowedLogin(request: IncomingMessage, config: PluginConfig | undefined): boolean {
  const header = readLoginHeader(request)
  if (header.state !== 'value') return false
  return resolveOptions(config).allowedUsers.includes(header.login)
}

/** 跳板页：没有应用数据，只把同一个地址重新打开一次。 */
function renderBootstrap(target: string): string {
  const href = escapeHtml(target)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0; url=${href}">
<title>正在打开 DSH</title>
</head>
<body>
<p><a href="${href}">继续打开 DSH</a></p>
</body>
</html>
`
}

/**
 * 命中跨站顶层跳转时写跳板页。
 * @param request - 原始请求。
 * @param response - 由本函数接管的响应。
 * @param config - loader 传入的配置（读取当前名单）。
 * @returns 是否已经写了响应；false 时调用方应继续 `next()`。
 */
export function handleLaunchBootstrap(
  request: IncomingMessage,
  response: ServerResponse,
  config: PluginConfig | undefined,
): boolean {
  if (request.destroyed || response.destroyed || response.headersSent) return false
  if (!isColdLaunchDocument(request)) return false
  if (!isAllowedLogin(request, config)) return false
  const target = requestTarget(request.url)
  if (target === undefined || !isAppDocumentPath(target.path)) return false

  response.writeHead(200, BOOTSTRAP_HEADERS)
  response.end(renderBootstrap(target.target))
  return true
}

/**
 * 安装桌面应用跳板。
 *
 * 只声明 `webServer`：请求瀑布挂在它的上下文上（与 Token 交换根路径 token 的挂法一致）；名单在每次
 * 请求里现读，改配置不需要重挂。
 * @param ctx - 插件自己的上下文。
 * @param config - loader 传入的配置。
 */
export function installLaunchBootstrap(ctx: HostContext, config: PluginConfig | undefined): void {
  ctx.inject(['webServer'], (webCtx: HostServices) => {
    if (webCtx.webServer === undefined) return
    const listener: WebRequestListener = async (request, response, next) => {
      if (request.socket?.destroyed === true || response.destroyed) return
      if (handleLaunchBootstrap(request, response, config)) return
      await next()
    }
    webCtx.on('webserver/request', listener)
    log('已注册桌面应用跳板：名单里的用户从桌面图标冷启动时先走一次同源重载')
  })
}
