// 拼 uni.request 的最终地址 .
// 关键不变量：**幂等** —— 调用方（client/src/api/request.ts）已经拼过 VITE_API_BASE 时不能再拼一次 .
// 否则地址会变成 /preview/<id>/preview/<id>/api/xxx，代理认不出 /api 前缀就转给了 vite，
// 拿回 index.html 后 JSON.parse 失败，页面会把整段 HTML 当字符串遍历（症状：几百个空行）.
export function resolveRequestUrl(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const trimmed = base.replace(/\/+$/, '')
  if (trimmed === '') return url
  if (url === trimmed || url.startsWith(trimmed + '/')) return url
  return trimmed + (url.startsWith('/') ? url : '/' + url)
}