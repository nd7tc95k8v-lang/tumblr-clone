import { formatRelativePostTime } from "@/lib/feed-post-display";

const QUOTE_LAYER_INLINE_TIME_CLASS =
  "ml-2 max-w-[38%] shrink-0 truncate text-right text-[0.6875rem] leading-tight tabular-nums text-text-muted max-md:max-w-[42%] max-md:text-[0.625rem] max-md:leading-tight";

type Props = { iso: string };

/** Muted compact stamp for quote-chain username rows (same relative rules as the card footer). */
export function QuoteLayerInlineTime({ iso }: Props) {
  const t = formatRelativePostTime(iso);
  return (
    <time dateTime={iso} title={t.full} aria-label={t.full} className={QUOTE_LAYER_INLINE_TIME_CLASS}>
      {t.label}
    </time>
  );
}
