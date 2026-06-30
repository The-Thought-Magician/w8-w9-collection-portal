import type { HTMLAttributes } from 'react'

export type BadgeTone = 'green' | 'yellow' | 'red' | 'slate' | 'blue'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

const tones: Record<BadgeTone, string> = {
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  slate: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  blue: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
}

export function Badge({ tone = 'slate', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
