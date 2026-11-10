import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { SourceTrendingEntry, SourceTrendingFeed } from "../../../../scripts/source-trending-format.mjs";
import { loadSourceTrending, sourceTrendingDestination, sourceTrendingIsStale } from "./source-trending";
import { Avatar } from "./Avatar";

export function SourceTrendingRows({ entries, onOpen }: { entries: SourceTrendingEntry[]; onOpen: (entry: SourceTrendingEntry) => void }) {
  return <div className="ua-source-trending-rows">{entries.map(entry => {
    const github = entry.source.includes("/");
    const destination = sourceTrendingDestination(entry);
    const content = <>
      <Avatar src={github ? `https://github.com/${encodeURIComponent(entry.source.split("/")[0])}.png?size=80` : undefined} name={entry.source} />
      <span className="ua-row-text"><span className="ua-row-name">{entry.name}</span>
        <span className="ua-row-description">{entry.source}{!entry.catalogId && " · Not reviewed"}</span></span>
      {!entry.catalogId && <ArrowUpRight aria-hidden="true" />}
    </>;
    return <div className="ua-row ua-source-trending-row" key={`${entry.source}:${entry.skillId}`}>
      <span className="ua-rank" aria-label={`Source rank ${entry.rank}`}>{entry.rank}</span>
      {entry.catalogId ? <button type="button" className="ua-row-main" onClick={() => onOpen(entry)} aria-label={`Open ${entry.name}`}>{content}</button>
        : <a className="ua-row-main" href={destination.href} target="_blank" rel="noopener noreferrer" aria-label={`View ${entry.name} on ${destination.label}, not reviewed`}>{content}</a>}
      <span className="ua-source-trending-installs" aria-label={`${entry.installs24h.toLocaleString("en-US")} installs in 24 hours`}>
        {new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(entry.installs24h)}
      </span>
    </div>;
  })}</div>;
}

export function SourceTrending({ limit, onOpen }: { limit?: number; onOpen: (entry: SourceTrendingEntry) => void }) {
  const [feed, setFeed] = useState<SourceTrendingFeed>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void loadSourceTrending(controller.signal).then(value => {
      if (!controller.signal.aborted) setFeed(value);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Trending is unavailable.");
    });
    return () => controller.abort();
  }, [revision]);
  if (!feed && !error) return <p className="ua-muted" role="status" aria-label="Loading trending skills">Loading Trending...</p>;
  return <div className="ua-source-trending">
    {feed && <p className="ua-muted ua-source-trending-meta">
      <a href="https://skills.sh/trending" target="_blank" rel="noopener noreferrer">skills.sh · 24h installs</a>
      <span>{sourceTrendingIsStale(feed) ? "Stale · " : "Updated "}<time dateTime={feed.fetchedAt}>
        {new Date(feed.fetchedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </time></span>
    </p>}
    {error && <p className="ua-muted" role="status">{error}{feed && " Showing the previous snapshot."}{" "}
      <button type="button" className="ua-pill" aria-label="Retry trending skills" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {feed && <SourceTrendingRows entries={feed.entries.slice(0, limit)} onOpen={onOpen} />}
    {feed && !feed.entries.length && <p className="ua-muted">No Trending entries available.</p>}
  </div>;
}
