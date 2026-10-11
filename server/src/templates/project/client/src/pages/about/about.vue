<script setup lang="ts">
// 「关于」页：演示第二个 Tab 页 + 读取后端健康状态 + 本地存储。
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fetchHealth } from '@/api/todo'
import { API_BASE } from '@/api/request'

const health = ref('未检测')
const uptime = ref(0)
const version = ref('-')
const remember = ref(false)
const from = ref('')

function toggleRemember(): void {
  remember.value = !remember.value
  uni.setStorageSync('remember-about', remember.value)
  uni.showToast({ title: remember.value ? '已记住' : '已取消', icon: 'none' })
}

async function check(): Promise<void> {
  try {
    const info = await fetchHealth()
    health.value = info.ok ? '正常' : '异常'
    uptime.value = Math.round(info.uptime)
    version.value = info.version
  } catch (error) {
    health.value = '连不上后端：' + (error as Error).message
  }
}

onLoad((query) => {
  from.value = query?.from ?? '直接进入'
  remember.value = uni.getStorageSync('remember-about') === true
  void check()
})
</script>

<template>
  <view class="page">
    <view class="card">
      <text class="title">{{appTitle}} · 关于</text>
      <text class="line">来源：{{ from }}</text>
      <text class="line">接口地址：{{ API_BASE || '(同源)' }}</text>
      <text class="line">后端状态：{{ health }}</text>
      <text class="line">运行时长：{{ uptime }} 秒 · 版本 {{ version }}</text>
    </view>

    <view class="card">
      <view class="row">
        <text class="grow">记住我的选择（本地存储演示）</text>
        <button class="btn btn--small" @click="toggleRemember">{{ remember ? '已记住' : '未记住' }}</button>
      </view>
    </view>

    <button class="btn" @click="check">重新检测后端</button>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
}

.card {
  padding: 12px;
  border-radius: 8px;
  background: #f7f8fa;
}

.title {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
}

.line {
  display: block;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.9;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.grow {
  flex: 1;
}
</style>