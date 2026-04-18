import Link from "next/link";
import type { TrendingTag } from "@/lib/supabase/fetch-trending-tags";

/** Match PostCard tag chip styling (default variant). */
const TAG_CHIP_BASE =
  "inline-block rounded-full border px-2 py-0.5 text-meta font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/50 focus-visible:ring-offset-0";
const TAG_CHIP_DEFAULT =
  "border-border bg-bg-secondary text-text-secondary hover:border-accent-purple/45 hover:text-link";

const DISPLAY_MAX = 10;

type Props = {
  tags: TrendingTag[];
  /** True when the RPC could not be loaded (e.g. missing service role). */
  unavailable?: boolean;
};

export function TrendingTagsSkeleton() {
  return (
    <section
      className="mx-auto w-full max-w-3xl px-3 sm:px-6"
      aria-busy="true"
      aria-label="Trending tags loading"
    >
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Trending tags</h2>
      <ul className="flex list-none flex-wrap gap-1.5 p-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i}>
            <span
              className={`${TAG_CHIP_BASE} inline-block min-w-[3.25rem] animate-pulse border-border/60 bg-bg-secondary/60 text-transparent`}
            >
              ···
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function TrendingTags({ tags, unavailable = false }: Props) {
  const top = tags.slice(0, DISPLAY_MAX);

  return (
    <section className="mx-auto w-full max-w-3xl px-3 sm:px-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Trending tags</h2>
      {unavailable ? (
        <p className="text-sm text-text-muted">Trending tags could not be loaded.</p>
      ) : top.length === 0 ? (
        <p className="text-sm text-text-muted">No trending tags in the last 7 days yet.</p>
      ) : (
        <ul className="flex list-none flex-wrap gap-1.5 p-0">
          {top.map((row) => (
            <li key={row.tag}>
              <Link
                href={`/tag/${encodeURIComponent(row.tag)}`}
                className={`${TAG_CHIP_BASE} ${TAG_CHIP_DEFAULT}`}
              >
                #{row.tag}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
