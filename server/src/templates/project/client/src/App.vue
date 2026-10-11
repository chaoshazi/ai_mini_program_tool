<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  // 应用启动钩子：这里只做示例日志，业务初始化放这里。
  console.log('[app] {{appTitle}} 启动')
})
</script>

<template>
  <!--
    预览运行时装把当前页面渲染进这个插槽（见 client/preview/），
    请在 App.vue 里只放全局样式与启动钩子，不要在 App.vue 里写业务 UI。
  -->
  <slot />
</template>

<style>
@import './styles/app.css';

page,
body {
  background-color: #f2f4f6;
  color: #1f2937;
  font-size: 14px;
}
</style>