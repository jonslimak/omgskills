import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight, Download } from "lucide-react";
import type { SourceTrendingEntry, SourceTrendingFeed } from "../../../../scripts/source-trending-format.mjs";
import { loadSourceTrending, sourceTrendingDestination, sourceTrendingIsStale } from "./source-trending";
import { Avatar } from "./Avatar";

const compactCount = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// Today's three-column grid, built like the compact catalog rows it replaced:
// rank, avatar, name, "@owner · installs", and a round open button (link-out arrow when not reviewed).
function SourceTrendingGrid({ entries, onOpen }: { entries: SourceTrendingEntry[]; onOpen: (entry: SourceTrendingEntry) => void }) {
  return <div className="ua-trending">{entries.map(entry => {
    const github = entry.source.includes("/");
    const owner = github ? entry.source.split("/")[0] : entry.source;
    const destination = sourceTrendingDestination(entry);
    const installs = `${entry.installs24h.toLocaleString("en-US")} installs in 24 hours`;
    const content = <>
      <Avatar src={github ? `https://github.com/${encodeURIComponent(owner)}.png?size=80` : undefined} name={entry.source} />
      <span className="ua-row-text">
        <span className="ua-row-heading">
          <span className="ua-row-name">{entry.name}</span>
          <span className="ua-row-stars ua-row-stars-mobile" aria-label={installs}><Download aria-hidden="true" />{compactCount.format(entry.installs24h)}</span>
        </span>
        <span className="ua-row-description">
          {github ? `@${owner}` : owner}
          <span className="ua-trending-separator" aria-hidden="true"> · </span>
          <span className="ua-trending-stars" aria-label={installs}><Download aria-hidden="true" />{compactCount.format(entry.installs24h)}</span>
        </span>
      </span>
    </>;
    const label = entry.catalogId ? `Open ${entry.name}` : `View ${entry.name} on ${destination.label}, not reviewed`;
    return <div className="ua-row ua-row-compact" key={`${entry.source}:${entry.skillId}`}>
      <span className="ua-rank">{entry.rank}</span>
      {entry.catalogId
        ? <button type="button" className="ua-row-main" onClick={() => onOpen(entry)} aria-label={label}>{content}</button>
        : <a className="ua-row-main" href={destination.href} target="_blank" rel="noopener noreferrer" aria-label={label}>{content}</a>}
      <span className="ua-row-stars" />
      {entry.catalogId
        ? <button type="button" className="ua-pill ua-link ua-row-open" aria-label={`${label} details`} title={`${label} details`} onClick={() => onOpen(entry)}><ChevronRight aria-hidden="true" /></button>
        : <a className="ua-pill ua-link ua-row-open" href={destination.href} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true"><ArrowUpRight aria-hidden="true" /></a>}
    </div>;
  })}</div>;
}

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

/** "Updated Nov 10, 6:17 AM" for the page heading; says when the snapshot is out of date. */
export function sourceTrendingUpdated(feed: SourceTrendingFeed) {
  const time = new Date(feed.fetchedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return sourceTrendingIsStale(feed) ? `Last updated ${time}` : `Updated ${time}`;
}

export function SourceTrending({ limit, onOpen, onLoad, grid = false }: {
  limit?: number; onOpen: (entry: SourceTrendingEntry) => void; onLoad?: (feed: SourceTrendingFeed) => void; grid?: boolean;
}) {
  const [feed, setFeed] = useState<SourceTrendingFeed>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void loadSourceTrending(controller.signal).then(value => {
      if (!controller.signal.aborted) { setFeed(value); onLoad?.(value); }
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Trending is unavailable.");
    });
    return () => controller.abort();
  }, [revision]);
  if (!feed && !error) return <p className="ua-muted" role="status" aria-label="Loading trending skills">Loading Trending...</p>;
  return <div className="ua-source-trending">
    {error && <p className="ua-muted" role="status">{error}{feed && " Showing the previous snapshot."}{" "}
      <button type="button" className="ua-pill" aria-label="Retry trending skills" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {feed && (grid ? <SourceTrendingGrid entries={feed.entries.slice(0, limit)} onOpen={onOpen} />
      : <SourceTrendingRows entries={feed.entries.slice(0, limit)} onOpen={onOpen} />)}
    {feed && !feed.entries.length && <p className="ua-muted">No Trending entries available.</p>}
  </div>;
}
