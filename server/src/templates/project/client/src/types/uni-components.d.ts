// 内置组件的全局声明：让 vue-tsc 认识 <view>/<text>/<scroll-view> 等标签。
// 生产/真机建议安装 @dcloudio/types 并删除本文件。
import type { Component } from 'vue'

declare module 'vue' {
  export interface GlobalComponents {
    view: Component
    View: Component
    'uni-view': Component
    'uni-text': Component
    'uni-button': Component
    'uni-input': Component
    'uni-textarea': Component
    'uni-image': Component
    'uni-switch': Component
    'uni-scroll-view': Component
    'uni-navigator': Component
    'uni-page': Component
    'uni-icon': Component
    text: Component
    Text: Component
    image: Component
    Image: Component
    button: Component
    Button: Component
    input: Component
    Input: Component
    textarea: Component
    Textarea: Component
    scrollView: Component
    ScrollView: Component
    'scroll-view': Component
    navigator: Component
    Navigator: Component
    switch: Component
    Switch: Component
    page: Component
    Page: Component
    icon: Component
    Icon: Component
  }
}