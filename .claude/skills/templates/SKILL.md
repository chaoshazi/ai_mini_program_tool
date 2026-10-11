---
name: templates
description: 改 D:\miniwechat 的生成工程模板（server/src/templates/project：页面骨架、pages.json/tabBar、request.ts、预览运行时装、自检脚本）时使用。不适用于改生成编排逻辑（看 generator）、改预览编排/代理（看 preview）。只改控制台 UI 也用不上。
---

# 工程模板

## 结构

模板是**真实文件**（不是字符串常量），生成时按占位符渲染进 `var/workspaces/<id>/`：

```
server/src/templates/project/
├─ package.json            workspaces 根：client + server，scripts: dev/typecheck/build
├─ README.md               导入运行说明（真机与浏览器预览都写清楚）
├─ scripts/dev.mjs         零依赖同时起前后端（client 9400 / api 9401）
├─ client/
│  ├─ src/                 标准 uni-app 源码：main.ts / App.vue / pages.json / manifest.json / pages/ / api/
│  ├─ src/types/           uni 全局 API 与内置组件的类型声明（供 vue-tsc 校验）
│  └─ preview/             浏览器预览运行时装（见 preview 技能）
└─ server/src/             index.ts / routes.ts / store.ts（统一 { code, message, data }）
```

占位符清单在 `server/src/templates/index.ts` 的 `PLACEHOLDERS`：`appName`、`appTitle`、`description`、`createdAt`。
渲染器 `renderProject` 会遍历模板目录写入工作目录，文本文件替换占位符，二进制直接拷贝。

新增页面/模板的固定步骤：① 在模板目录改真实文件 → ② 有新的 `{{占位符}}` 就同步 `PLACEHOLDERS` → ③ 页面必须同时登记进
`client/src/pages.json`（进 tabBar 还要加到 `tabBar.list`）→ ④ 跑 `npm run smoke:template` 与 `npm run check:render`。

## 不变量

- **App.vue 必须保留 `<slot />`**：预览运行时装把当前页面渲染进这个插槽；业务 UI 不要写在 App.vue 里。
- **与 HTML/SVG 同名的内置标签**（`text`/`button`/`input`/`textarea`/`image`/`switch`）在浏览器里会被 Vue 当原生元素，
  所以 `client/preview/uni-tag-alias.ts` 在编译期把它们改写成 `uni-*`；垫片组件只按 `uni-*` 注册这些名字。
  页面里不要给它们用 uni 专属属性（如 `type="primary"`、`size="mini"`），vue-tsc 会按原生元素校验而报错——样式走 class。
  `<switch>` 与 SVG 同名，模板里改用 `<button>` 切换。
- 页面路径在 `pages.json` 里是**相对 `src/` 的**（如 `pages/index/index`），而 `import.meta.glob` 的 key 是相对预览文件名，
  拼接时要写 `'../src/' + path + '.vue'`。
- `client/src/api/request.ts` 是唯一请求入口，baseURL 读 `VITE_API_BASE`（预览时工具注入 `/preview/<id>`，真机改成自己的域名）。
- 纯 CSS 全局样式放 `client/src/styles/app.css`，由 App.vue 的 `<style>` `@import` 引入（H5 与小程序都支持）。
- 不要给生成物加第三方依赖：前端只用 vue/vite，后端只用 express/cors。

## 验证

```powershell
npm run smoke:template --workspace server    # 渲染 + npm install + vue-tsc/tsc + vite build，全绿才算模板可用
npm run check:render --workspace server      # SSR 渲染首页，断言 uni-view/uni-button/文案真的渲染出来
npm run test --workspace server              # templates.test.ts 卡占位符清单与「渲染后不残留占位符」
```

渲染校验的坑（改 `scripts/render-check.ts` 时注意）：`@vue/runtime-dom` 在模块加载时做特性探测，
必须**等 `import('vue')` 完成后再补 `document` 桩**；`vite build --ssr` 的入口必须是绝对路径，且 Windows 下用反斜杠。