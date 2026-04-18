import TrendingTags from "../../../components/TrendingTags";
import { fetchTrendingTags } from "@/lib/supabase/fetch-trending-tags";

/** Async server fragment: loads trending separately so the page can stream it inside Suspense. */
export default async function ExploreTrendingTags() {
  const { data, error } = await fetchTrendingTags();
  return <TrendingTags tags={data ?? []} unavailable={Boolean(error)} />;
}
