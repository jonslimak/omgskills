import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import {
  ArrowLeft,
  ArrowUpRight,
  Atom,
  BookOpen,
  Bot,
  Braces,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CirclePlay,
  Code,
  Compass,
  Copy,
  FileText,
  FileSearch,
  Folder,
  GitBranch,
  Globe,
  Heart,
  Inbox,
  Laptop,
  ListPlus,
  ListChecks,
  Lock,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Newspaper,
  Palette,
  PanelLeft,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  SearchCheck,
  SearchX,
  Server,
  Shapes,
  ShieldCheck,
  Smartphone,
  Sparkles,
  PanelsTopLeft,
  Star,
  Sun,
  Target,
  Table,
  TrendingUp,
  User,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  isMember,
  visibilityLabels,
  type PortalData,
  type PortalSet,
  type Visibility,
  type LoadState,
} from "../model";
import {
  isDiscovery,
  isFavorite,
  matchesSearch,
  skillDisplays,
  starCount,
  type CatalogDisplay,
  type Navigation,
  type SkillDisplay,
  type View,
} from "./model";
import "./unified.css";
import type { PublicStatus } from "./use-public-catalog";

type Props = {
  data: PortalData;
  catalog: CatalogDisplay;
  nav: Navigation;
  navigate: (next: Navigation, replace?: boolean) => void;
  signedIn: boolean;
  onSession: (signedIn: boolean) => void;
  onFavorite: (skill: SkillDisplay) => void;
  onCreateSet: (name: string, skills: SkillDisplay[]) => void;
  onMembership: (setId: string, skills: SkillDisplay[], add: boolean) => void;
  onVisibility: (setId: string, visibility: Visibility) => void;
  state: LoadState;
  retry: () => void;
  previewBar: ReactNode;
  publicStatus?: PublicStatus;
};

function IconButton({
  label,
  children,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      className="ua-icon"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}
function Avatar({
  name,
  src,
  size = "small",
}: {
  name: string;
  src?: string;
  size?: "small" | "medium" | "large";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`ua-avatar ua-avatar-${size}`} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        name.slice(0, 2).toUpperCase() || <Lock />
      )}
    </span>
  );
}
function Menu({
  trigger,
  children,
  theme,
  label,
  side = "bottom",
}: {
  trigger: ReactNode;
  children: ReactNode;
  theme: string;
  label: string;
  side?: "top" | "bottom";
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="ua-menu ua-theme"
          data-theme={theme}
          aria-label={label}
          side={side}
          sideOffset={8}
          collisionPadding={12}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
function MenuItem({
  icon: Icon,
  children,
  onSelect,
  disabled,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      className="ua-menu-item"
      onSelect={onSelect}
      disabled={disabled}
    >
      {Icon && <Icon />}
      {children}
    </DropdownMenu.Item>
  );
}
function Modal({
  title,
  close,
  theme,
  children,
}: {
  title: string;
  close: () => void;
  theme: string;
  children: ReactNode;
}) {
  const trigger = useRef(document.activeElement as HTMLElement | null);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ua-overlay" />
        <Dialog.Content
          className="ua-modal ua-theme"
          data-theme={theme}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
          }}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close asChild>
            <IconButton label="Close dialog">
              <X />
            </IconButton>
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Empty({
  title = "Nothing here yet",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ua-empty">
      <SearchX />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
function AgentTiles({
  skill,
  sources,
}: {
  skill: SkillDisplay;
  sources: string[];
}) {
  return (
    <div
      className="ua-agent-tiles"
      aria-label={skill.installed?.sources.join(", ")}
    >
      {sources.map((source) => (
        <span
          className="ua-agent-tile"
          data-present={skill.installed?.sources.includes(source)}
          key={source}
          title={skill.installed?.sources.includes(source) ? source : undefined}
        >
          {skill.installed?.sources.includes(source) ? (
            source === "Claude" ? (
              <Sparkles />
            ) : source === "Codex" ? (
              <Bot />
            ) : (
              source.slice(0, 1)
            )
          ) : null}
        </span>
      ))}
    </div>
  );
}
const categoryIcons: Record<string, LucideIcon> = {
  "Design system": Palette,
  SwiftUI: Smartphone,
  React: Atom,
  "App Store": Laptop,
  Remotion: CirclePlay,
  "Landing page": PanelsTopLeft,
  Brand: Star,
  Blog: Newspaper,
  SEO: SearchCheck,
  Scraping: Globe,
  "Social media": Users,
  "Market research": Target,
  "Code review": GitBranch,
  Playwright: ListChecks,
  Debugging: Bug,
  "API design": Braces,
  Refactoring: RefreshCw,
  "Security audit": ShieldCheck,
  "Deep research": FileSearch,
  "MCP server": Server,
  PDF: FileText,
  Deck: Presentation,
  Humanizer: UserCheck,
  Excel: Table,
};

export function UnifiedApp({
  data,
  catalog,
  nav,
  navigate,
  signedIn,
  onSession,
  onFavorite,
  onCreateSet,
  onMembership,
  onVisibility,
  state,
  retry,
  previewBar,
  publicStatus,
}: Props) {
  const [rail, setRail] = useState(false);
  const [theme, setTheme] = useState("light");
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [dialog, setDialog] = useState<
    "new-set" | "membership" | "signin" | null
  >(null);
  const [actionSkills, setActionSkills] = useState<SkillDisplay[]>([]);
  const [setName, setSetName] = useState("");
  const [notice, setNotice] = useState("");
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 1180px)").matches,
  );
  const main = useRef<HTMLElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const models = useMemo(() => skillDisplays(data, catalog), [data, catalog]);
  const sources = useMemo(
    () => [...new Set(data.skills.map((s) => s.source))].sort(),
    [data.skills],
  );
  const mine = signedIn ? models.mine : [];
  const library = signedIn && !publicStatus
    ? models.library
    : models.library.map((skill) => ({ ...skill, installed: undefined }));
  const pendingSelection: SkillDisplay | undefined = publicStatus && nav.selected.startsWith("catalog:")
    ? { key: nav.selected, catalogId: nav.selected.slice(8), name: "Skill details", description: "", author: "", githubUrl: null, tags: [] }
    : undefined;
  const selected = [...mine, ...library].find((s) => s.key === nav.selected) || pendingSelection;
  const remoteDetail = !!publicStatus && nav.selected.startsWith("catalog:");
  const detailPending = remoteDetail && publicStatus.detail !== "ready";
  const relatedSkills = selected?.author
    ? library
        .filter((skill) => skill.author === selected.author && skill.catalogId !== selected.catalogId)
        .slice(0, 3)
    : [];
  const activeSet = signedIn
    ? data.sets.find((set) => set.id === nav.id)
    : undefined;
  const collection = catalog.collections.find((item) => item.id === nav.id);
  const creator = catalog.creators.find((item) => item.handle === nav.id);
  const categoryGroup = catalog.categories.find((group) => group.label === nav.id);
  const discovery = !signedIn || isDiscovery(nav.view);
  const favorites = mine.filter((skill) => isFavorite(data, skill));
  const sets = signedIn
    ? data.sets.filter((set) => !set.hidden && !set.isFavorites)
    : [];
  const editableView =
    signedIn &&
    ["all", "favorites", "set"].includes(nav.view) &&
    (!activeSet || activeSet.role === "owner");
  const matchingMine = mine.filter((skill) => matchesSearch(skill, nav.query));
  const remoteRows = catalog.resultIds?.flatMap((id) => library.find((skill) => skill.catalogId === id) || []) || [];
  const matchingLibrary = publicStatus ? remoteRows : library.filter((skill) => matchesSearch(skill, nav.query));
  const publicList = !!publicStatus && (isDiscovery(nav.view) || !!nav.query.trim());
  const listState = publicList ? publicStatus.list : state;
  const scopeKey = `${nav.view}:${nav.id}:${nav.query}:${nav.source}:${signedIn}`;

  useEffect(() => {
    setEditing(false);
    setPicked([]);
    setDialog(null);
    main.current?.scrollTo(0, 0);
  }, [scopeKey]);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1180px)");
    const change = () => setWide(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (selected) return;
    if (detailTrigger.current?.isConnected) detailTrigger.current.focus();
  }, [selected?.key]);

  function go(view: View, id = "") {
    navigate({ view, id, query: "", selected: "", source: "all" });
  }
  function open(skill: SkillDisplay) {
    detailTrigger.current = document.activeElement as HTMLElement;
    navigate({ ...nav, selected: skill.key });
  }
  function closeDetail() {
    navigate({ ...nav, selected: "" });
  }
  function addToSet(skills: SkillDisplay[]) {
    setActionSkills(skills);
    setDialog("membership");
  }
  function newSet(skills: SkillDisplay[] = []) {
    setActionSkills(skills);
    setSetName("");
    setDialog("new-set");
  }
  function changeQuery(query: string) {
    navigate({ ...nav, query, selected: "" }, true);
  }
  async function copySource(skill: SkillDisplay) {
    if (!skill.githubUrl) return;
    try {
      await navigator.clipboard.writeText(skill.githubUrl);
      setNotice("Source link copied");
    } catch {
      setNotice("Could not copy the link. Open the source instead.");
    }
  }
  const search = (mobile = false) => (
    <label className={`ua-search ${mobile ? "ua-search-mobile" : ""}`}>
      <Search />
      <span className="ua-sr">Search skills or creators</span>
      <input
        type="search"
        placeholder={mobile ? "Search skills or creators" : "Search skills"}
        value={nav.query}
        onChange={(event) => changeQuery(event.target.value)}
      />
    </label>
  );
  function navItem(
    view: View,
    label: string,
    Icon: LucideIcon,
    count?: number,
    id = "",
  ) {
    const active = nav.view === view && (!id || nav.id === id) && !nav.query;
    return (
      <button
        type="button"
        key={`${view}:${id}`}
        className="ua-nav-item"
        title={rail ? label : undefined}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={() => go(view, id)}
      >
        <Icon />
        <span>{label}</span>
        {count !== undefined && <small>{count}</small>}
      </button>
    );
  }
  const accountMenu = (mobile = false) => (
    <Menu
      theme={theme}
      label="Account"
      side={mobile ? "bottom" : "top"}
      trigger={
        <button
          type="button"
          className={`ua-account ${mobile ? "ua-account-mobile" : ""}`}
          aria-label="Account menu"
        >
          <Avatar name={data.profile.name} />
          <span>
            <strong>{data.profile.name.split(" ")[0]}</strong>
            <small>
              {sources.length} sources · {data.devices.length} devices
            </small>
          </span>
          <ChevronsUpDown />
        </button>
      }
    >
      <div className="ua-menu-heading">
        <strong>{data.profile.name}</strong>
        <small>{data.profile.email}</small>
      </div>
      <MenuItem icon={User} onSelect={() => go("profile")}>
        Profile
      </MenuItem>
      <MenuItem icon={Bot} onSelect={() => go("agents")}>
        Agents <small>{sources.length} observed</small>
      </MenuItem>
      <MenuItem icon={Monitor} onSelect={() => go("devices")}>
        Devices <small>{data.devices.length}</small>
      </MenuItem>
      <MenuItem icon={Code} onSelect={() => go("github")}>
        GitHub sources
      </MenuItem>
      <MenuItem icon={Server} onSelect={() => go("mcp")}>
        MCP server
      </MenuItem>
      <DropdownMenu.Separator className="ua-separator" />
      <MenuItem
        icon={theme === "light" ? Moon : Sun}
        onSelect={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? "Dark" : "Light"} appearance
      </MenuItem>
      <MenuItem icon={LogOut} onSelect={() => onSession(false)}>
        Sign out
      </MenuItem>
    </Menu>
  );

  function renderRow(skill: SkillDisplay, rank?: number, compact = false) {
    const canSelect = editing && !!skill.installed;
    return (
      <div
        key={skill.key}
        className={`ua-row ${compact ? "ua-row-compact" : ""}`}
        data-selected={selected?.key === skill.key}
      >
        {canSelect && (
          <input
            type="checkbox"
            aria-label={`Select ${skill.name}`}
            checked={picked.includes(skill.key)}
            onChange={() =>
              setPicked((old) =>
                old.includes(skill.key)
                  ? old.filter((id) => id !== skill.key)
                  : [...old, skill.key],
              )
            }
          />
        )}
        {rank && <span className="ua-rank">{rank}</span>}
        <button
          type="button"
          className="ua-row-main"
          onClick={() =>
            canSelect
              ? setPicked((old) =>
                  old.includes(skill.key)
                    ? old.filter((id) => id !== skill.key)
                    : [...old, skill.key],
                )
              : open(skill)
          }
          aria-label={`Open ${skill.name}`}
          aria-expanded={selected?.key === skill.key}
        >
          <Avatar src={skill.avatar} name={skill.author || skill.name} />
          <span className="ua-row-text">
            <span className="ua-row-heading">
              <span className="ua-row-name">{skill.name}</span>
              {!compact && (discovery || nav.query) && skill.author && (
                <span className="ua-row-author">@{skill.author}</span>
              )}
              {skill.installed?.isLocalOnly && <Lock aria-label="Local skill" />}
            </span>
            <span className="ua-row-description">
              {compact
                ? `@${skill.author}${skill.stars !== undefined ? ` · ${starCount(skill.stars)} stars` : ""}`
                : skill.description || "No description available"}
            </span>
          </span>
        </button>
        {!compact && !discovery && !nav.query && (
          <AgentTiles skill={skill} sources={sources} />
        )}
        {!canSelect &&
          (discovery || nav.query || compact ? (
            <>
              <span className="ua-row-stars">
                {!compact && skill.stars !== undefined && (
                  <>
                    <Star />
                    {starCount(skill.stars)}
                  </>
                )}
              </span>
              <button
                type="button"
                className="ua-pill ua-link"
                onClick={() => open(skill)}
              >
                Open
              </button>
            </>
          ) : (
            <Menu
              theme={theme}
              label={`${skill.name} actions`}
              trigger={
                <IconButton label={`Actions for ${skill.name}`}>
                  <MoreHorizontal />
                </IconButton>
              }
            >
              <MenuItem icon={BookOpen} onSelect={() => open(skill)}>
                View details
              </MenuItem>
              <MenuItem icon={ListPlus} onSelect={() => addToSet([skill])}>
                Add to set
              </MenuItem>
              <MenuItem icon={Heart} onSelect={() => onFavorite(skill)}>
                {isFavorite(data, skill)
                  ? "Remove from favorites"
                  : "Add to favorites"}
              </MenuItem>
              <MenuItem
                icon={Copy}
                onSelect={() => void copySource(skill)}
                disabled={!skill.githubUrl}
              >
                Copy source link
              </MenuItem>
            </Menu>
          ))}
      </div>
    );
  }
  function rows(skills: SkillDisplay[], ranked = false) {
    return skills.length ? (
      <div className="ua-list">
        {skills.map((skill, i) => renderRow(skill, ranked ? i + 1 : undefined))}
      </div>
    ) : (
      <Empty title={nav.query ? "Nothing matches" : "No skills here yet"}>
        {nav.query
          ? "Try a creator or a task."
          : "Explore the library for your next useful skill."}
      </Empty>
    );
  }
  function SectionHeading({
    title,
    action,
  }: {
    title: string;
    action?: () => void;
  }) {
    return (
      <div className="ua-section-heading">
        <h2>{title}</h2>
        {action && (
          <button type="button" className="ua-link" onClick={action}>
            See all <ChevronRight />
          </button>
        )}
      </div>
    );
  }
  function CollectionCards({ limit }: { limit?: number }) {
    return (
      <div className="ua-collections">
        {catalog.collections.slice(0, limit).map((item) => (
          <button
            type="button"
            className="ua-collection"
            key={item.id}
            onClick={() => go("collection", item.id)}
          >
            <span className="ua-avatar-stack">
              {item.authors ? item.authors.map((author) => (
                <Avatar key={author.handle} src={author.avatar} name={author.handle} size="medium" />
              )) : [
                ...new Map(
                  library
                    .filter((skill) => item.skillIds.includes(skill.catalogId!))
                    .map((skill) => [skill.author, skill]),
                ).values(),
              ]
                .slice(0, 3)
                .map((skill) => (
                  <Avatar
                    key={skill.author}
                    src={skill.avatar}
                    name={skill.author}
                    size="medium"
                  />
                ))}
            </span>
            <span className="ua-collection-copy">
              <small>Collection</small>
              <strong>{item.name}</strong>
              <span>{item.description}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }
  function CreatorList({ limit }: { limit?: number }) {
    return (
      <div className="ua-creators">
        {catalog.creators.slice(0, limit).map((item) => (
          <button
            type="button"
            className="ua-creator"
            key={item.handle}
            onClick={() => go("creator", item.handle)}
          >
            <Avatar src={item.avatar} name={item.name} size="medium" />
            <span>
              <strong>{item.name}</strong>
              <small>{item.tagline}</small>
            </span>
            <ChevronRight />
          </button>
        ))}
      </div>
    );
  }
  function CategoryList({ groups = catalog.categories }: { groups?: CatalogDisplay["categories"] }) {
    return (
      <div className="ua-categories">
        {groups.map((group) => (
          <div key={group.label}>
            {groups.length > 1 && <h3>{group.label}</h3>}
            <div>
              {group.items.map((item) => {
                const Icon = categoryIcons[item] || Search;
                return (
                  <button
                    type="button"
                    key={item}
                    onClick={() => navigate({ view: "discover", id: "", query: item, selected: "", source: "all" })}
                  >
                    <Icon />
                    <span>{item}</span>
                    <ChevronRight />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const top = catalog.trendingIds.flatMap(
    (id) => library.find((s) => s.catalogId === id) || [],
  );
  let visible = nav.view === "favorites" ? favorites : mine;
  if (nav.view === "set")
    visible = activeSet
      ? mine.filter((skill) => isMember(activeSet, skill.installed!))
      : [];
  if (nav.view === "top") visible = top;
  if (nav.view === "creator")
    visible = library.filter((skill) => skill.author === nav.id);
  if (nav.view === "collection")
    visible = library.filter((skill) =>
      collection?.skillIds.includes(skill.catalogId!),
    );
  if (nav.view === "category") {
    visible = library.filter((skill) => matchesSearch(skill, nav.id));
  }
  if (publicStatus && ["top", "creator", "collection", "category"].includes(nav.view)) visible = remoteRows;
  if (nav.source !== "all")
    visible = visible.filter((skill) =>
      skill.installed?.sources.includes(nav.source),
    );
  const titles: Record<View, string> = {
    all: "my skills",
    favorites: "favorites",
    sets: "sets",
    discover: "Discover",
    top: publicStatus ? "Trending skills" : "Top this week",
    creators: "Creators",
    collections: "Collections",
    set: activeSet?.name || "Set not found",
    creator: creator?.name || nav.id,
    collection: collection?.name || (listState === "loading" ? "Collection" : "Collection not found"),
    category: nav.id,
    agents: "agents",
    devices: "devices",
    profile: "profile",
    github: "GitHub sources",
    mcp: "MCP server",
  };
  const title = nav.query ? "Search results" : titles[nav.view];
  const meta = nav.query
    ? `Results for "${nav.query}"`
    : nav.view === "all"
      ? `${mine.length} skills across ${sources.length} sources`
      : nav.view === "discover"
        ? "Find your next useful skill."
        : nav.view === "favorites"
          ? "Your favorites are shared publicly."
          : nav.view === "set"
            ? activeSet?.description
            : nav.view === "collection"
              ? collection?.description
              : nav.view === "creator"
                ? creator?.tagline
                : nav.view === "top"
                  ? "A little inspiration for what to try next."
                  : "";

  return (
    <div className="ua-theme ua-root" data-theme={theme}>
      {previewBar}
      <div
        className="ua-workspace"
        data-rail={rail}
        data-detail={!!selected && wide}
      >
        <aside className="ua-sidebar" aria-label="Main navigation">
          <div className="ua-brand">
            <span aria-hidden="true">👀</span>
            <strong>omgskills</strong>
          </div>
          {signedIn && (
            <div className="ua-modes" role="group" aria-label="App mode">
              <button
                type="button"
                aria-pressed={!discovery}
                title="My skills"
                onClick={() => go("all")}
              >
                <Inbox />
                <span>My skills</span>
              </button>
              <button
                type="button"
                aria-pressed={discovery}
                title="Discover"
                onClick={() => go("discover")}
              >
                <Compass />
                <span>Discover</span>
              </button>
            </div>
          )}
          {rail ? (
            <IconButton label="Expand search" onClick={() => setRail(false)}>
              <Search />
            </IconButton>
          ) : (
            search()
          )}
          <nav className="ua-nav">
            {discovery ? (
              <>
                {navItem("discover", "Discover", Compass)}
                {navItem("top", publicStatus ? "Trending skills" : "Top this week", TrendingUp)}
                {navItem("creators", "Creators", Users)}
                {navItem("collections", "Collections", Shapes)}
                <div className="ua-nav-group">
                  <small>Categories</small>
                  {catalog.categories.map((group, i) =>
                    navItem(
                      "category",
                      group.label,
                      [Palette, Target, Code, BookOpen][i],
                      undefined,
                      group.label,
                    ),
                  )}
                </div>
              </>
            ) : (
              <>
                {navItem("all", "All skills", Inbox, mine.length)}
                {navItem("favorites", "Favorites", Heart, favorites.length)}
                <div className="ua-nav-group">
                  <small>Sets</small>
                  {sets.map((set) =>
                    navItem("set", set.name, Folder, undefined, set.id),
                  )}
                  <button
                    type="button"
                    className="ua-nav-item ua-muted"
                    title={rail ? "New set" : undefined}
                    onClick={() => newSet()}
                  >
                    <Plus />
                    <span>New set</span>
                  </button>
                </div>
              </>
            )}
          </nav>
          <div className="ua-sidebar-bottom">
            <IconButton
              label={rail ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setRail(!rail)}
            >
              <PanelLeft />
            </IconButton>
          </div>
          {signedIn ? (
            <div className="ua-account-footer">{accountMenu()}</div>
          ) : (
            <div className="ua-account-footer">
              <button
                type="button"
                className="ua-pill ua-primary"
                onClick={() => setDialog("signin")}
              >
                <User />
                <span>Sign in</span>
              </button>
            </div>
          )}
        </aside>
        <div className="ua-content-column">
          <header className="ua-mobile-header">
            <div>
              <span aria-label="omgskills">👀</span>
              {signedIn ? (
                accountMenu(true)
              ) : (
                <button
                  type="button"
                  className="ua-pill ua-primary"
                  onClick={() => setDialog("signin")}
                >
                  Sign in
                </button>
              )}
            </div>
            {search(true)}
          </header>
          <main className="ua-main" ref={main} id="unified-main">
            <div className="ua-content">
              {!signedIn && (
                <div className="ua-public-actions">
                  <a
                    href="https://omgskills.com/download"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get the Mac app <ArrowUpRight />
                  </a>
                  <button
                    type="button"
                    className="ua-pill ua-primary"
                    onClick={() => setDialog("signin")}
                  >
                    Sign in
                  </button>
                </div>
              )}
              {["creator", "collection", "category"].includes(nav.view) &&
                !nav.query && (
                  <button
                    type="button"
                    className="ua-link ua-back"
                    onClick={() => go("discover")}
                  >
                    <ArrowLeft />
                    Discover
                  </button>
                )}
              <div className="ua-page-heading">
                <div>
                  <h1>{title}</h1>
                  {meta && <p>{meta}</p>}
                </div>
                {nav.view === "sets" && (
                  <button
                    type="button"
                    className="ua-pill"
                    onClick={() => newSet()}
                  >
                    <Plus />
                    New set
                  </button>
                )}
                {nav.view === "set" && activeSet && (
                  <Menu
                    theme={theme}
                    label="Set visibility"
                    trigger={
                      <button
                        type="button"
                        className="ua-pill"
                        disabled={activeSet.role !== "owner"}
                      >
                        {activeSet.visibility === "public" ? (
                          <Globe />
                        ) : (
                          <Lock />
                        )}
                        {visibilityLabels[activeSet.visibility]}
                        <ChevronDown />
                      </button>
                    }
                  >
                    {(["public", "restricted", "private"] as Visibility[]).map(
                      (value) => (
                        <MenuItem
                          key={value}
                          onSelect={() => onVisibility(activeSet.id, value)}
                          icon={
                            value === activeSet.visibility ? Check : undefined
                          }
                        >
                          {visibilityLabels[value]}
                        </MenuItem>
                      ),
                    )}
                  </Menu>
                )}
              </div>
              {publicList && publicStatus.note && listState === "ready" && <p className="ua-muted" role="status">{publicStatus.note}</p>}
              {listState === "loading" ? (
                <div
                  className="ua-skeletons"
                  role="status"
                  aria-label="Loading skills"
                >
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} />
                  ))}
                </div>
              ) : listState === "error" ? (
                <Empty title="Skills couldn't be loaded">
                  {publicList && publicStatus.error && <span>{publicStatus.error}<br /></span>}
                  <button type="button" className="ua-pill" onClick={publicList ? publicStatus.retry : retry}>
                    Try again
                  </button>
                </Empty>
              ) : nav.query ? (
                <>
                  <section>
                    <SectionHeading title="In my skills" />
                    {signedIn ? (
                      rows(matchingMine)
                    ) : (
                      <p className="ua-muted">Sign in to see your skills.</p>
                    )}
                  </section>
                  <section>
                    <SectionHeading title="Library" />
                    {rows(matchingLibrary)}
                  </section>
                </>
              ) : nav.view === "discover" ? (
                <>
                  <CollectionCards limit={publicStatus ? 3 : undefined} />
                  <section>
                    <SectionHeading
                      title={publicStatus ? "Trending skills" : "Top this week"}
                      action={() => go("top")}
                    />
                    <div className="ua-trending">
                      {top
                        .slice(0, 9)
                        .map((skill, i) => renderRow(skill, i + 1, true))}
                    </div>
                  </section>
                  <section>
                    <SectionHeading
                      title="Creators"
                      action={() => go("creators")}
                    />
                    <CreatorList limit={publicStatus ? 9 : undefined} />
                  </section>
                  <section>
                    <SectionHeading title="Categories" />
                    <CategoryList />
                  </section>
                </>
              ) : nav.view === "category" && categoryGroup ? (
                <CategoryList groups={[categoryGroup]} />
              ) : nav.view === "collections" ? (
                <CollectionCards />
              ) : nav.view === "creators" ? (
                <CreatorList />
              ) : nav.view === "sets" ? (
                <div className="ua-set-list">
                  {sets.map((set) => (
                    <button
                      type="button"
                      key={set.id}
                      onClick={() => go("set", set.id)}
                    >
                      <span className="ua-set-icon">
                        <Folder />
                      </span>
                      <span>
                        <strong>{set.name}</strong>
                        <small>
                          {set.items.length} skills ·{" "}
                          {visibilityLabels[set.visibility]}
                          {set.role !== "owner"
                            ? ` · Shared by ${set.ownerName}`
                            : ""}
                        </small>
                      </span>
                      <ChevronRight />
                    </button>
                  ))}
                  {!sets.length && (
                    <Empty title="Your sets start here">
                      Group useful skills for your next project.
                    </Empty>
                  )}
                </div>
              ) : ["agents", "devices", "profile", "github", "mcp"].includes(
                  nav.view,
                ) ? (
                <div className="ua-account-page">
                  {nav.view === "agents" && (
                    <>
                      {sources.map((source) => (
                        <div className="ua-account-row" key={source}>
                          <Bot />
                          <strong>{source}</strong>
                          <span>
                            {
                              mine.filter((s) =>
                                s.installed?.sources.includes(source),
                              ).length
                            }{" "}
                            skills
                          </span>
                        </div>
                      ))}
                      <p className="ua-muted">
                        Sources observed in your synced skills. Remote
                        installation is not available here.
                      </p>
                    </>
                  )}
                  {nav.view === "devices" &&
                    data.devices.map((device) => (
                      <div className="ua-account-row" key={device.id}>
                        <Monitor />
                        <span>
                          <strong>{device.name}</strong>
                          <small>Last activity: {device.lastActive}</small>
                        </span>
                        <span>{device.status}</span>
                      </div>
                    ))}
                  {nav.view === "profile" && (
                    <>
                      <Avatar name={data.profile.name} size="large" />
                      <h2>{data.profile.name}</h2>
                      <p>@{data.profile.handle}</p>
                      <p>{data.profile.email}</p>
                      <p className="ua-muted">
                        {data.profile.published
                          ? "Public profile"
                          : "Unpublished profile"}
                      </p>
                    </>
                  )}
                  {nav.view === "github" && (
                    <Empty
                      title={
                        data.privateSourceConnected
                          ? "GitHub source connected"
                          : "No private sources connected"
                      }
                    >
                      Private source management will keep its existing account
                      controls.
                    </Empty>
                  )}
                  {nav.view === "mcp" && (
                    <>
                      <Server />
                      <h2>omgskills MCP server</h2>
                      <code>https://omgskills.com/mcp</code>
                      <p className="ua-muted">
                        Public, read-only skill discovery for your agent.
                      </p>
                      <a
                        className="ua-link"
                        href="https://omgskills.com/developers/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Connection instructions <ArrowUpRight />
                      </a>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {editableView && (
                    <div className="ua-toolbar">
                      <label className="ua-filter">
                        Agent
                        <select
                          aria-label="Filter by agent"
                          value={nav.source}
                          onChange={(event) =>
                            navigate({ ...nav, source: event.target.value })
                          }
                        >
                          <option value="all">All</option>
                          {sources.map((source) => (
                            <option key={source}>{source}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="ua-pill"
                        onClick={() => {
                          setEditing(!editing);
                          setPicked([]);
                          closeDetail();
                        }}
                      >
                        {editing ? "Done" : "Edit"}
                      </button>
                    </div>
                  )}
                  {editing && (
                    <div className="ua-bulk">
                      <button
                        type="button"
                        className="ua-link"
                        onClick={() =>
                          setPicked(
                            picked.length === visible.length
                              ? []
                              : visible.map((s) => s.key),
                          )
                        }
                      >
                        {picked.length === visible.length && picked.length
                          ? "Deselect all"
                          : "Select all"}
                      </button>
                      <span>{picked.length} selected</span>
                      <button
                        type="button"
                        className="ua-pill"
                        disabled={!picked.length}
                        onClick={() =>
                          addToSet(
                            visible.filter((s) => picked.includes(s.key)),
                          )
                        }
                      >
                        <ListPlus />
                        Add to set
                      </button>
                    </div>
                  )}
                  {visible.length ||
                  nav.view !== "set" ||
                  !activeSet?.items.length
                    ? rows(visible, nav.view === "top")
                    : null}
                  {nav.view === "set" &&
                    activeSet &&
                    activeSet.items
                      .filter(
                        (item) =>
                          !mine.some((skill) =>
                            skill.installed?.allSkillIds.includes(
                              item.syncedSkillId || "",
                            ),
                          ),
                      )
                      .map((item) => (
                        <div className="ua-account-row" key={item.id}>
                          <FileText />
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.description}</small>
                          </span>
                          <span>{item.kind}</span>
                        </div>
                      ))}
                </>
              )}
            </div>
          </main>
          {signedIn && (
            <nav className="ua-mobile-tabs" aria-label="Mobile navigation">
              {(
                [
                  ["all", "My skills", User],
                  ["discover", "Discover", TrendingUp],
                  ["sets", "Sets", Shapes],
                ] as const
              ).map(([view, label, Icon]) => (
                <button
                  type="button"
                  key={view}
                  aria-current={
                    (
                      view === "all"
                        ? !discovery && !["sets", "set"].includes(nav.view)
                        : view === "sets"
                          ? ["sets", "set"].includes(nav.view)
                          : discovery
                    )
                      ? "page"
                      : undefined
                  }
                  onClick={() => go(view)}
                >
                  <Icon />
                  {label}
                </button>
              ))}
            </nav>
          )}
        </div>
        {selected && (
          <Dialog.Root
            open
            modal={!wide}
            onOpenChange={(show) => !show && closeDetail()}
          >
            <Dialog.Portal>
              {!wide && <Dialog.Overlay className="ua-detail-overlay" />}
              <Dialog.Content
                className="ua-detail ua-theme"
                data-theme={theme}
                aria-describedby={undefined}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  detailTrigger.current?.isConnected &&
                    detailTrigger.current.focus();
                }}
                onInteractOutside={(event) => {
                  if (wide) event.preventDefault();
                }}
              >
                <div className="ua-detail-top">
                  <span className="ua-grabber" />
                  <Dialog.Close asChild>
                    <IconButton label="Close skill details">
                      <X />
                    </IconButton>
                  </Dialog.Close>
                </div>
                {detailPending ? (
                  <>
                    <Dialog.Title>Skill details</Dialog.Title>
                    <p role="status">{publicStatus.detail === "loading" ? "Loading skill..." : publicStatus.detailError}</p>
                    {publicStatus.detail === "error" && <button className="ua-pill" type="button" onClick={publicStatus.retryDetail}>Try again</button>}
                  </>
                ) : <>
                <div className="ua-detail-heading">
                  <Avatar
                    src={selected.avatar}
                    name={selected.author || selected.name}
                    size="large"
                  />
                  <div className="ua-detail-heading-copy">
                    <Dialog.Title>{selected.name}</Dialog.Title>
                    <div className="ua-detail-meta">
                      {selected.author && (
                        <button
                          type="button"
                          className="ua-link"
                          onClick={() => go("creator", selected.author)}
                        >
                          @{selected.author}
                        </button>
                      )}
                      {selected.stars !== undefined && (
                        <span>
                          <Star />
                          {starCount(selected.stars)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="ua-detail-actions">
                  {selected.githubUrl ? (
                    <a
                      className="ua-pill ua-primary"
                      href={selected.githubUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View source <ArrowUpRight />
                    </a>
                  ) : (
                    <span className="ua-pill">
                      <Lock />
                      Local skill
                    </span>
                  )}
                  {signedIn && selected.installed && (
                    <>
                      <IconButton
                        label={
                          isFavorite(data, selected)
                            ? "Remove from favorites"
                            : "Add to favorites"
                        }
                        data-favorite={isFavorite(data, selected)}
                        onClick={() => onFavorite(selected)}
                      >
                        <Heart />
                      </IconButton>
                      <IconButton
                        label="Add to set"
                        onClick={() => addToSet([selected])}
                      >
                        <ListPlus />
                      </IconButton>
                    </>
                  )}
                  {selected.githubUrl && (
                    <IconButton
                      label="Copy source link"
                      onClick={() => void copySource(selected)}
                    >
                      <Copy />
                    </IconButton>
                  )}
                </div>
                <p className="ua-description">
                  {selected.description || "No description available."}
                </p>
                {selected.installed && (
                  <section className="ua-detail-account">
                    <h3>On this account</h3>
                    <div>
                      <span>Observed on</span>
                      <strong>{selected.installed.sources.join(", ")}</strong>
                    </div>
                    <div className="ua-set-chips">
                      {data.sets
                        .filter((set) => isMember(set, selected.installed!))
                        .map((set) => (
                          <button
                            type="button"
                            className="ua-pill"
                            key={set.id}
                            onClick={() =>
                              go(set.isFavorites ? "favorites" : "set", set.id)
                            }
                          >
                            {set.isFavorites ? <Heart /> : <Folder />}
                            {set.name}
                          </button>
                        ))}
                    </div>
                  </section>
                )}
                <section className="ua-about">
                  <h3>About</h3>
                  <p>
                    {selected.githubUrl
                      ? "Read the skill's instructions and installation guidance at its source."
                      : "This skill belongs to your local library."}
                  </p>
                  {selected.githubUrl && (
                    <a
                      className="ua-link"
                      href={selected.githubUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open on GitHub <ArrowUpRight />
                    </a>
                  )}
                  {selected.publicUrl && (
                    <a className="ua-link" href={selected.publicUrl} target="_blank" rel="noreferrer">
                      View public skill page <ArrowUpRight />
                    </a>
                  )}
                </section>
                {relatedSkills.length > 0 && (
                  <section className="ua-more">
                    <h3>More from @{selected.author}</h3>
                    {relatedSkills.map((skill) => (
                        <button
                          type="button"
                          key={skill.key}
                          onClick={() => open(skill)}
                        >
                          <strong>{skill.name}</strong>
                          <small>{skill.description}</small>
                          <ChevronRight />
                        </button>
                      ))}
                  </section>
                )}
                </>}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>
      {dialog === "new-set" && (
        <Modal title="New set" theme={theme} close={() => setDialog(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!setName.trim()) return;
              onCreateSet(setName.trim(), actionSkills);
              setDialog(null);
              setNotice("Sample set created");
            }}
          >
            <label>
              Set name
              <input
                autoFocus
                value={setName}
                maxLength={100}
                onChange={(event) => setSetName(event.target.value)}
                placeholder="e.g. My next project"
                required
              />
            </label>
            <p className="ua-muted">
              Only me · {actionSkills.length} selected skills
            </p>
            <button
              type="submit"
              className="ua-pill ua-primary"
              disabled={!setName.trim()}
            >
              Create set
            </button>
          </form>
        </Modal>
      )}
      {dialog === "membership" && (
        <Modal title="Add to set" theme={theme} close={() => setDialog(null)}>
          <div className="ua-membership">
            {sets
              .filter((set) => set.role === "owner")
              .map((set) => {
                const checked =
                  actionSkills.length > 0 &&
                  actionSkills.every(
                    (skill) =>
                      skill.installed && isMember(set, skill.installed),
                  );
                return (
                  <label key={set.id}>
                    <Folder />
                    <span>
                      {set.name}
                      <small>{visibilityLabels[set.visibility]}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        onMembership(set.id, actionSkills, event.target.checked)
                      }
                    />
                  </label>
                );
              })}
          </div>
          <button
            type="button"
            className="ua-link"
            onClick={() => newSet(actionSkills)}
          >
            <Plus />
            New set
          </button>
          <button
            type="button"
            className="ua-pill ua-primary"
            onClick={() => setDialog(null)}
          >
            Done
          </button>
        </Modal>
      )}
      {dialog === "signin" && (
        <Modal
          title="Sign in to omgskills"
          theme={theme}
          close={() => setDialog(null)}
        >
          <p>
            Local preview only. No account or authentication request will be
            created.
          </p>
          <button
            type="button"
            className="ua-pill ua-primary"
            onClick={() => {
              onSession(true);
              setDialog(null);
            }}
          >
            Use sample account
          </button>
        </Modal>
      )}
      {notice && (
        <div className="ua-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
