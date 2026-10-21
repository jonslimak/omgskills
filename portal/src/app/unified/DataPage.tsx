import { useEffect, useState, type ReactNode } from "react";
import { createLucideIcon, ChevronRight, ChevronUp, Star, Users } from "lucide-react";
import { Avatar } from "./Avatar";
import { starCount, type CreatorDisplay } from "./model";
import { leaderboardRows, loadLeaderboards, type Leaderboards, type LeaderboardSkill } from "./leaderboards";

type Props = { creators: CreatorDisplay[]; onCreator: (handle: string) => void; onSkill: (skill: LeaderboardSkill) => void };
export function StarText({ text }: { text: string }) {
  return <>{text.split(/(\u2b50|\bstars\b)/gi).map((part, index) => /^(?:\u2b50|stars)$/i.test(part)
    ? <span className="ua-data-star-unit" role="img" aria-label="stars" key={index}><Star aria-hidden="true" /></span>
    : part)}</>;
}

// Official Lucide artwork (ISC): https://lucide.dev/icons/building-complex
// This icon is not yet included in our installed Lucide version.
const BuildingComplex = createLucideIcon("BuildingComplex", [
  ["path", { d: "M10 12h4", key: "windows-lower" }],
  ["path", { d: "M10 8h4", key: "windows-upper" }],
  ["path", { d: "M14 21v-3a2 2 0 0 0-4 0v3", key: "door" }],
  ["path", { d: "M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2", key: "sides" }],
  ["path", { d: "M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16", key: "center" }],
]);

function DataHeading({ generatedAt, includeCompanies = false, onToggle }: {
  generatedAt?: string; includeCompanies?: boolean; onToggle?: () => void;
}) {
  const [showLabel, setShowLabel] = useState(false);
  useEffect(() => {
    setShowLabel(includeCompanies);
    if (!includeCompanies) return;
    const timer = setTimeout(() => setShowLabel(false), 2000);
    return () => clearTimeout(timer);
  }, [includeCompanies]);
  return <header className="ua-page-heading ua-data-heading">
    <h1>Data</h1>
    <p>{generatedAt && <>Updated on <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleDateString()}</time></>}</p>
    <div className="ua-data-companies">
      <span className="ua-data-filter-label" role="status">{showLabel ? "Include companies" : ""}</span>
      <button type="button" className="ua-data-filter-button" aria-label="Include companies"
        title={includeCompanies ? "Show creators only" : "Include companies"}
        aria-pressed={includeCompanies} disabled={!onToggle} onClick={onToggle}>
        {includeCompanies ? <BuildingComplex aria-hidden="true" /> : <Users aria-hidden="true" />}
      </button>
    </div>
  </header>;
}

export function LeaderboardSections({ data, creators, onCreator, onSkill }: Props & { data: Leaderboards }) {
  const [includeCompanies, setIncludeCompanies] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const profiles = new Map(creators.map(creator => [creator.handle.toLowerCase(), creator]));
  function section<T>(id: string, title: string, subtitle: string, rows: T[], render: (row: T, rank: number) => ReactNode) {
    const shown = expanded[id] ? rows : rows.slice(0, 9);
    return <section key={id} aria-labelledby={`ua-data-${id}-title`}>
      <div className="ua-section-heading">
        <div><h2 id={`ua-data-${id}-title`}>{title}</h2><p className="ua-data-subtitle">{subtitle}</p></div>
        {rows.length > 9 && <button type="button" className="ua-link" aria-expanded={!!expanded[id]}
          aria-controls={`ua-data-${id}`} aria-label={`${expanded[id] ? "Show less" : "See all"} ${title}`}
          onClick={() => setExpanded(previous => ({ ...previous, [id]: !previous[id] }))}>
          {expanded[id] ? "Show less" : "See all"}{expanded[id] ? <ChevronUp /> : <ChevronRight />}
        </button>}
      </div>
      <div className="ua-creators ua-data-grid" id={`ua-data-${id}`}>{shown.map((row, index) => render(row, index + 1))}</div>
      {!rows.length && <p className="ua-muted">No entries in this leaderboard.</p>}
    </section>;
  }
  function creatorRow(handle: string, rank: number, value: ReactNode, detail: ReactNode) {
    const creator = profiles.get(handle.toLowerCase());
    return <button type="button" className="ua-creator ua-data-row" key={handle} onClick={() => onCreator(handle)}>
      <span className="ua-rank">{rank}</span>
      <Avatar name={creator?.name || handle} src={creator?.avatar || `https://github.com/${encodeURIComponent(handle)}.png?size=80`} size="medium" />
      <span className="ua-data-copy"><strong>{creator?.name || `@${handle}`}</strong><span className="ua-data-value">{value}</span><small>{detail}</small></span>
      <ChevronRight aria-hidden="true" />
    </button>;
  }
  return <div className="ua-data">
    <DataHeading generatedAt={data.generatedAt} includeCompanies={includeCompanies}
      onToggle={() => { setIncludeCompanies(value => !value); setExpanded({}); }} />
    {section("top", "Top Skills this Week", "Most Installed This Week", data.topSkills, skill => <button
      type="button" className="ua-creator ua-data-row ua-data-skill" key={skill.id} onClick={() => onSkill(skill)}>
      <span className="ua-rank">{skill.rank}</span>
      <Avatar name={skill.authorHandle} src={`https://github.com/${encodeURIComponent(skill.authorHandle)}.png?size=80`} size="medium" />
      <span className="ua-data-copy"><span className="ua-data-skill-heading"><strong>{skill.name}</strong>
        <span className="ua-row-stars ua-row-stars-mobile" aria-label={`${starCount(skill.stars)} stars`}><Star aria-hidden="true" />{starCount(skill.stars)}</span>
      </span><small>@{skill.authorHandle}</small>
        <span className="ua-data-value">{starCount(skill.installs)} installs <span className="ua-data-stars" aria-label={`${starCount(skill.stars)} stars`}><Star aria-hidden="true" />{starCount(skill.stars)}</span></span>
      </span><span className="ua-pill ua-link ua-row-open" aria-hidden="true"><ChevronRight /></span>
    </button>)}
    {data.creatorCategories.map(category => section(category.id, category.title, category.subtitle,
      leaderboardRows(category.rows, includeCompanies), (row, rank) => creatorRow(row.authorHandle, rank,
        <StarText text={row.value} />, category.id === "peak" ? row.detail : <StarText text={row.detail} />)))}
    {section("all-rounders", "All-Rounders", "Creators across multiple leaderboards", leaderboardRows(data.allRounders, includeCompanies), (row, rank) =>
      creatorRow(row.authorHandle, rank, <StarText text={`${row.skillCount} skills \u00b7 ${starCount(row.totalStars)} stars \u00b7 ${starCount(row.totalInstalls)} installs`} />, row.trophies.join(" \u00b7 ")))}
  </div>;
}

export function DataPage(props: Props) {
  const [data, setData] = useState<Leaderboards | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void loadLeaderboards().then(data => { if (active) setData(data); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [revision]);
  if (data) return <LeaderboardSections {...props} data={data} />;
  return <div className="ua-data"><DataHeading />
    {failed ? <div className="ua-toolbar" role="status"><span className="ua-muted">Leaderboards couldn't be loaded.</span>
      <button type="button" className="ua-pill" onClick={() => setRevision(value => value + 1)}>Retry leaderboards</button></div>
      : <div className="ua-skeletons" role="status" aria-label="Loading leaderboards">{Array.from({ length: 9 }, (_, index) => <div key={index} />)}</div>}
  </div>;
}
