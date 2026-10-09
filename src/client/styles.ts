/**
 * 配置页的样式表。
 *
 * 源码是真正的 `styles.css`，由 `tsdown.config.ts` 里的 `cssInline()` 编译成文本内联进产物
 * （对应官方 `dsh-css-text-inline`）：客户端模块系统只服务 `<包名>/client.js` 这一条经典脚本，没有
 * 旁挂 `.css` 的路由，所以 CSS 必须进产物。
 *
 * 注入按 effect 的生命周期走：卸载时移除自己那一份；元素按 `data-plugin-css` 认领，热替换时先删掉
 * 同名的那一份，免得越换越多。
 *
 * @module dsh-tailnet-admin/client/styles
 */

import styles from './styles.css?inline'

/** 样式归属：官方 `data-plugin` 写包名，`data-plugin-css` 写「包名/文件名」。 */
const PLUGIN_ID = 'dsh-tailnet-admin'
const STYLE_OWNER = `${PLUGIN_ID}/styles.css`

/**
 * 注入配置页样式。
 * @returns 卸载时移除样式表的 disposer。
 */
export function installStyles(): () => void {
  const stale = document.querySelector(`style[data-plugin-css="${STYLE_OWNER}"]`)
  if (stale !== null && stale.parentNode !== null) stale.parentNode.removeChild(stale)

  const element = document.createElement('style')
  element.dataset.plugin = PLUGIN_ID
  element.dataset.pluginCss = STYLE_OWNER
  element.textContent = styles
  document.head.appendChild(element)

  return () => {
    if (element.parentNode !== null) element.parentNode.removeChild(element)
  }
}
