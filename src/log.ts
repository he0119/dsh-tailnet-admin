/**
 * 启动日志。
 *
 * 宿主把插件的 stdout 直接写进 dsh 的启动日志，前缀是唯一能把几轮刷新分开的线索。写日志失败不该影响
 * 插件本身：它只写 stdout，没有别的副作用。
 */

/** 日志前缀：插件在启动日志里的那一列。 */
const LOG_PREFIX = '[dsh-tailnet-admin]'

/**
 * 写一行带前缀的启动日志。
 * @param message - 要写的内容，不带前缀。
 */
export function log(message: string): void {
  try {
    console.info(`${LOG_PREFIX} ${message}`)
  } catch {
    // 写不出去就算了：日志不是插件行为的一部分。
  }
}
