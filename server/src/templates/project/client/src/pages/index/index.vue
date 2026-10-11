<script setup lang="ts">
// {{appTitle}} 首页：增删改查都走后端接口（server/），页面内不放业务数据。
// 注意：button/input/text 这类与 HTML 同名的标签不要用 uni 专属属性（如 type="primary"），
// 样式统一走 class，这样浏览器预览与真机编译行为一致。
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { createTodo, fetchTodos, removeTodo, updateTodo } from '@/api/todo'
import type { Todo } from '@/api/types'

const todos = ref<Todo[]>([])
const draft = ref('')
const loading = ref(false)

const doneCount = computed(() => todos.value.filter((item) => item.done).length)

function notify(message: string): void {
  uni.showToast({ title: message, icon: 'none' })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    todos.value = await fetchTodos()
  } catch (error) {
    notify('加载失败：' + (error as Error).message)
  } finally {
    loading.value = false
  }
}

async function add(): Promise<void> {
  const title = draft.value.trim()
  if (!title) {
    notify('先写点内容再添加')
    return
  }
  try {
    const created = await createTodo(title)
    todos.value = [created, ...todos.value]
    draft.value = ''
  } catch (error) {
    notify('添加失败：' + (error as Error).message)
  }
}

async function toggle(item: Todo): Promise<void> {
  try {
    const updated = await updateTodo(item.id, { done: !item.done })
    todos.value = todos.value.map((current) => (current.id === updated.id ? updated : current))
  } catch (error) {
    notify('更新失败：' + (error as Error).message)
  }
}

function confirm(content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '确认',
      content,
      success: (res) => resolve(res.confirm),
      fail: () => resolve(false),
    })
  })
}

async function remove(item: Todo): Promise<void> {
  if (!(await confirm('要删除「' + item.title + '」吗？'))) return
  try {
    await removeTodo(item.id)
    todos.value = todos.value.filter((current) => current.id !== item.id)
    notify('已删除')
  } catch (error) {
    notify('删除失败：' + (error as Error).message)
  }
}

// onShow：每次进入页面都重新拉一次，保证和后端一致。
onShow(() => {
  void load()
})
</script>

<template>
  <view class="page">
    <view class="card">
      <view class="row">
        <input v-model="draft" class="grow input" placeholder="要做什么？" @keyup.enter="add" />
        <button class="btn btn--primary" :disabled="loading" @click="add">添加</button>
      </view>
      <text class="hint">共 {{ todos.length }} 条 · 已完成 {{ doneCount }} 条</text>
    </view>

    <scroll-view scroll-y class="list">
      <view v-for="item in todos" :key="item.id" class="item" :class="{ 'is-done': item.done }">
        <text class="item-title" @click="toggle(item)">{{ item.title }}</text>
        <button class="btn btn--small" @click="remove(item)">删除</button>
      </view>
      <view v-if="todos.length === 0" class="empty">
        <text>{{ loading ? '加载中…' : '还没有待办，先添加一条吧' }}</text>
      </view>
    </scroll-view>

    <navigator class="link" url="/pages/about/about">查看「关于」页 →</navigator>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  padding: 12px;
  border-radius: 8px;
  background: #f7f8fa;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.grow {
  flex: 1;
}

.input {
  padding: 8px 10px;
  border: 1px solid #ebedf0;
  border-radius: 6px;
  background: #ffffff;
  font-size: 14px;
}

.hint {
  display: block;
  margin-top: 8px;
  color: #7a7e83;
  font-size: 12px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #ebedf0;
  border-radius: 8px;
}

.item-title {
  flex: 1;
  word-break: break-all;
}

.is-done .item-title {
  color: #9aa0a6;
  text-decoration: line-through;
}

.empty {
  padding: 24px 0;
  text-align: center;
  color: #9aa0a6;
}

.link {
  padding: 8px 0;
  font-size: 13px;
}
</style>