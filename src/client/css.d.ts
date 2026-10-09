/**
 * `x.css?inline` 的类型：默认导出编译好的样式文本。
 *
 * 真正把它变成文本的是 `tsdown.config.ts` 里的 `cssInline()` 加载器（对应官方
 * `packages/client/tsdown.client.ts` 的 `dsh-css-text-inline`）。客户端模块系统只服务
 * `<包名>/client.js` 这一条经典脚本，没有旁挂 `.css` 的路由，所以 CSS 必须内联进产物；源码仍然
 * 留在真正的 `.css` 文件里，编辑器认它。
 */
declare module '*.css?inline' {
  const text: string
  export default text
}
