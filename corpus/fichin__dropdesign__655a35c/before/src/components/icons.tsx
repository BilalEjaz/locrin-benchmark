import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base: IconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  focusable: false,
}

const stroke: IconProps = {
  ...base,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-8.5Z" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  )
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function GridViewIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 4v16M4 12h16" />
    </svg>
  )
}

export function ListViewIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  )
}

export function ColumnViewIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="5" y="4" width="5" height="16" rx="1.5" />
      <rect x="14" y="4" width="5" height="16" rx="1.5" />
    </svg>
  )
}

export function RowViewIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <rect x="4" y="5" width="16" height="5" rx="1.5" />
      <rect x="4" y="14" width="16" height="5" rx="1.5" />
    </svg>
  )
}

export function ExportIcon(props: IconProps) {
  return (
    <svg {...stroke} {...props}>
      <path d="M8 10H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1M12 15V4M8.5 7.5 12 4l3.5 3.5" />
    </svg>
  )
}

export function CommentIcon(props: IconProps) {
  return (
    <svg {...base} fill="currentColor" {...props}>
      <path d="M12 3c-5 0-9 3.6-9 8 0 2.1.9 4 2.4 5.4L4.6 20a.6.6 0 0 0 .8.7l4.2-1.5c.8.2 1.6.3 2.4.3 5 0 9-3.6 9-8s-4-8.5-9-8.5Zm-4 9.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base} fill="currentColor" {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.7-5.5 5.5a1 1 0 0 1-1.4 0l-2.5-2.5a1 1 0 1 1 1.4-1.4l1.8 1.8 4.8-4.8a1 1 0 1 1 1.4 1.4Z" />
    </svg>
  )
}
