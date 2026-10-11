// Vue 把 view/text/button/input 里与 HTML/SVG 同名的标签当原生元素处理（isNativeTag），
// 全局注册的垫片组件不会生效（例如 <text> 会被当成 SVG text 渲染成空）。
// 这里在预览编译期把它们改写成 uni-xxx，命中 uni-components.ts 里注册的组件。
// 只作用于 <template> 块，源码本身仍是标准 uni-app 写法。
import type { Plugin } from 'vite'

const ALIASED = ['view', 'text', 'button', 'input', 'textarea', 'image', 'switch', 'navigator', 'icon', 'page', 'scroll-view']
const TAG_PATTERN = new RegExp('<(/?)(' + ALIASED.join('|') + ')(?=[\\s/>])', 'g')

export function rewriteUniTags(code: string): string {
  const start = code.indexOf('<template>')
  const end = code.lastIndexOf('</template>')
  if (start < 0 || end <= start) return code
  const head = code.slice(0, start)
  const body = code.slice(start, end)
  const tail = code.slice(end)
  return head + body.replace(TAG_PATTERN, '<$1uni-$2') + tail
}

export function uniTagAlias(): Plugin {
  return {
    name: 'miniwechat:uni-tag-alias',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('.vue')) return null
      const next = rewriteUniTags(code)
      return next === code ? null : { code: next, map: null }
    },
  }
}