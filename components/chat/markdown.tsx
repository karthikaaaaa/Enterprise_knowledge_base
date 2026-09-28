import { type ReactNode } from 'react'

/** Renders a subset of Markdown (headings, bold/italic, inline code, code blocks,
 *  lists, blockquotes, links) without pulling in a full parser dependency. */

const INLINE_RE =
  /(\*\*([^*]+?)\*\*)|(__([^_]+?)__)|(`([^`]+?)`)|(\*([^*\n]+?)\*)|(_([^_\n]+?)_)|(\[([^\]]+?)\]\(([^)\s]+?)\))/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let i = 0
  let match: RegExpExecArray | null

  INLINE_RE.lastIndex = 0
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const key = `${keyPrefix}-${i++}`

    if (match[2] !== undefined || match[4] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {match[2] ?? match[4]}
        </strong>,
      )
    } else if (match[6] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-card px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {match[6]}
        </code>,
      )
    } else if (match[8] !== undefined || match[10] !== undefined) {
      nodes.push(<em key={key}>{match[8] ?? match[10]}</em>)
    } else if (match[12] !== undefined) {
      nodes.push(
        <a
          key={key}
          href={match[13]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-blue-ink underline underline-offset-2"
        >
          {match[12]}
        </a>,
      )
    }
    lastIndex = INLINE_RE.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

const HEADING_SIZES = ['text-base', 'text-base', 'text-sm', 'text-sm', 'text-sm', 'text-sm']

export function Markdown({ content }: { content: string }) {
  const lines = (content ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++ // consume closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-xl bg-card p-3 text-xs leading-relaxed"
        >
          <code className="font-mono text-foreground">{buf.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // Blank line
    if (!line.trim()) {
      i++
      continue
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      blocks.push(
        <p
          key={key++}
          className={`mb-1 mt-3 font-semibold text-foreground first:mt-0 ${HEADING_SIZES[level - 1]}`}
        >
          {renderInline(heading[2], `h-${key}`)}
        </p>,
      )
      i++
      continue
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ul-${key}-${idx}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ol-${key}-${idx}`)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderInline(buf.join(' '), `bq-${key}`)}
        </blockquote>,
      )
      continue
    }

    // Paragraph
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('```') &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    blocks.push(
      <p key={key++} className="my-1.5 first:mt-0 last:mb-0">
        {renderInline(buf.join(' '), `p-${key}`)}
      </p>,
    )
  }

  return <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{blocks}</div>
}
