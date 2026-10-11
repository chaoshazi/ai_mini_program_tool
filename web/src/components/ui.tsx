// 控制台里的通用小部件（按钮、卡片、状态点、代码块）。
import type { ReactNode } from 'react'

const BUTTON_KIND = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-200',
  ghost: 'bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:text-slate-500',
  danger: 'bg-transparent text-rose-300 hover:bg-rose-950',
} as const

export function Button({
  children,
  onClick,
  kind = 'ghost',
  disabled,
  title,
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  kind?: keyof typeof BUTTON_KIND
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
  className?: string
}): ReactNode {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={
        'rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed ' +
        BUTTON_KIND[kind] +
        ' ' +
        className
      }
    >
      {children}
    </button>
  )
}

export function StatusDot({ status }: { status: string }): ReactNode {
  const color =
    status === 'running' || status === 'ready' || status === 'succeeded'
      ? 'bg-emerald-400'
      : status === 'generating' || status === 'starting'
        ? 'bg-amber-400 animate-pulse'
        : status === 'error'
          ? 'bg-rose-400'
          : 'bg-slate-500'
  return <span className={'inline-block h-2 w-2 rounded-full ' + color} />
}

export function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-800 bg-slate-900/60">
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-300 uppercase">{title}</h2>
        <div className="flex items-center gap-2">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="px-3 py-6 text-center text-xs text-slate-500">{children}</p>
}