// uni-app 内置组件的浏览器实现（只覆盖模板用到的子集）。
// 组件名同时按 kebab 与 Pascal 注册，模板里写 <scroll-view> / <ScrollView> 都能命中。
import { defineComponent, h, type App, type VNode } from 'vue'

function slotChildren(slots: Record<string, ((...args: unknown[]) => VNode[]) | undefined>): VNode[] {
  return slots.default ? slots.default() : []
}

const View = defineComponent({
  name: 'UniView',
  setup(_props, { slots }) {
    return () => h('div', { class: 'uni-view' }, slotChildren(slots))
  },
})

const Text = defineComponent({
  name: 'UniText',
  setup(_props, { slots }) {
    return () => h('span', { class: 'uni-text' }, slotChildren(slots))
  },
})

const Image = defineComponent({
  name: 'UniImage',
  props: {
    src: { type: String, default: '' },
    mode: { type: String, default: 'scaleToFill' },
    alt: { type: String, default: '' },
  },
  setup(props) {
    return () => h('img', { class: 'uni-image', src: props.src, alt: props.alt })
  },
})

const Button = defineComponent({
  name: 'UniButton',
  props: {
    type: { type: String, default: 'default' },
    size: { type: String, default: 'default' },
    plain: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  emits: ['click'],
  setup(props, { slots, emit }) {
    return () =>
      h(
        'button',
        {
          class: ['uni-button', 'uni-button--' + props.type, 'uni-button--' + props.size, props.plain ? 'is-plain' : ''],
          disabled: props.disabled,
          onClick: (event: MouseEvent) => emit('click', { type: 'tap', detail: {}, target: event.target }),
        },
        props.loading ? '…' : slotChildren(slots),
      )
  },
})

const Input = defineComponent({
  name: 'UniInput',
  props: {
    /** 兼容 v-model 与 uni-app 的 :value 两种写法。 */
    modelValue: { type: [String, Number], default: undefined },
    value: { type: [String, Number], default: undefined },
    type: { type: String, default: 'text' },
    placeholder: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
    maxlength: { type: Number, default: 140 },
    focus: { type: Boolean, default: false },
    confirmType: { type: String, default: 'done' },
  },
  emits: ['input', 'update:modelValue', 'confirm', 'blur'],
  setup(props, { emit }) {
    const current = (): string => String(props.modelValue ?? props.value ?? '')
    return () =>
      h('input', {
        class: 'uni-input',
        value: current(),
        type: props.type === 'number' || props.type === 'digit' ? 'number' : props.type === 'idcard' ? 'text' : props.type,
        placeholder: props.placeholder,
        disabled: props.disabled,
        maxlength: props.maxlength,
        autofocus: props.focus,
        onInput: (event: Event) => {
          const value = (event.target as HTMLInputElement).value
          emit('input', { detail: { value } })
          emit('update:modelValue', value)
        },
        onBlur: (event: Event) => emit('blur', { detail: { value: (event.target as HTMLInputElement).value } }),
        onKeyup: (event: KeyboardEvent) => {
          if (event.key === 'Enter') emit('confirm', { detail: { value: (event.target as HTMLInputElement).value } })
        },
      })
  },
})

const Textarea = defineComponent({
  name: 'UniTextarea',
  props: {
    modelValue: { type: String, default: undefined },
    value: { type: String, default: undefined },
    placeholder: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
    maxlength: { type: Number, default: 140 },
  },
  emits: ['input', 'update:modelValue'],
  setup(props, { emit }) {
    const current = (): string => String(props.modelValue ?? props.value ?? '')
    return () =>
      h('textarea', {
        class: 'uni-textarea',
        value: current(),
        placeholder: props.placeholder,
        disabled: props.disabled,
        maxlength: props.maxlength,
        onInput: (event: Event) => {
          const value = (event.target as HTMLTextAreaElement).value
          emit('input', { detail: { value } })
          emit('update:modelValue', value)
        },
      })
  },
})

const ScrollView = defineComponent({
  name: 'UniScrollView',
  props: { scrollY: { type: [Boolean, String], default: false }, scrollX: { type: [Boolean, String], default: false } },
  setup(props, { slots }) {
    return () =>
      h(
        'div',
        {
          class: 'uni-scroll-view',
          style: {
            overflowY: props.scrollY ? 'auto' : 'hidden',
            overflowX: props.scrollX ? 'auto' : 'hidden',
          },
        },
        slotChildren(slots),
      )
  },
})

const Navigator = defineComponent({
  name: 'UniNavigator',
  props: { url: { type: String, default: '' }, openType: { type: String, default: 'navigate' } },
  setup(props, { slots }) {
    return () =>
      h(
        'a',
        {
          class: 'uni-navigator',
          href: 'javascript:void(0)',
          onClick: () => {
            const api = (globalThis as Record<string, any>).uni
            if (props.openType === 'switchTab') api?.switchTab({ url: props.url })
            else api?.navigateTo({ url: props.url })
          },
        },
        slotChildren(slots),
      )
  },
})

const Switch = defineComponent({
  name: 'UniSwitch',
  props: { checked: { type: Boolean, default: false } },
  emits: ['change'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        class: 'uni-switch',
        type: 'checkbox',
        checked: props.checked,
        onChange: (event: Event) => emit('change', { detail: { value: (event.target as HTMLInputElement).checked } }),
      })
  },
})

const Page = defineComponent({
  name: 'UniPage',
  setup(_props, { slots }) {
    return () => h('div', { class: 'uni-page' }, slotChildren(slots))
  },
})

const Icon = defineComponent({
  name: 'UniIcon',
  props: { type: { type: String, default: '' } },
  setup(props) {
    return () => h('span', { class: 'uni-icon', 'data-type': props.type })
  },
})

const REGISTRY: Record<string, ReturnType<typeof defineComponent>> = {
  view: View,
  text: Text,
  image: Image,
  button: Button,
  input: Input,
  textarea: Textarea,
  'scroll-view': ScrollView,
  navigator: Navigator,
  switch: Switch,
  page: Page,
  icon: Icon,
}

/** 与 HTML/SVG 内置元素同名的标签，不能直接用原名注册（Vue 会警告且优先级更低）。 */
const NATIVE_COLLIDING = new Set(['text', 'button', 'input', 'textarea', 'image', 'switch'])

function pascalCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * 注册垫片组件：
 * - `uni-<名字>`：uni-tag-alias.ts 会把模板里的标签改写成这个名字，一律注册；
 * - 原名与 PascalCase：只给非 HTML/SVG 同名的标签（view/scroll-view/navigator/page/icon）。
 */
export function registerUniComponents(app: App): void {
  for (const [name, component] of Object.entries(REGISTRY)) {
    app.component('uni-' + name, component)
    if (!NATIVE_COLLIDING.has(name)) {
      app.component(name, component)
      app.component(pascalCase(name), component)
    }
  }
}

export const UNI_COMPONENT_NAMES = Object.keys(REGISTRY).map((name) => 'uni-' + name)