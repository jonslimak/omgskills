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
  createLucideIcon,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  EyeOff,
  ArrowUpRight,
  Atom,
  ChartNoAxesColumn,
  CodeXml,
  BookOpen,
  Bot,
  Braces,
  Bug,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CirclePlay,
  Code,
  Compass,
  Copy,
  Trash2,
  Download,
  FileText,
  FileSearch,
  Folder,
  GitBranch,
  Globe,
  Heart,
  Laptop,
  ListPlus,
  ListChecks,
  Lock,
  LogOut,
  Monitor,
  Menu as MenuIcon,
  Moon,
  MoreHorizontal,
  Newspaper,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  LoaderCircle,
  Search,
  SearchCheck,
  SearchX,
  Server,
  Cloud,
  CloudOff,
  TriangleAlert,
  Shapes,
  Share,
  ShieldCheck,
  Smartphone,
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
  openSkillNavigation,
  isFavorite,
  matchesSearch,
  skillDisplays,
  liveSkill,
  installSavedLink,
  matchVersionsLink,
  maxRemoveFromMac,
  removeFromMacLink,
  liveMine,
  setSkillDisplays,
  setAccessSummary,
  starCount,
  agentKind,
  catalogSkillPath,
  discoverCollectionPage,
  inventorySummary,
  cloudSharedLabel,
  skillsByOrigin,
  notInstalledSkills,
  addedSkills,
  byInstalled,
  byName,
  type SkillShow,
  type CatalogDisplay,
  type Navigation,
  type SkillDisplay,
  type View,
} from "./model";
import "./unified.css";
import type { PublicStatus } from "./use-public-catalog";
import type { UnifiedManagement } from "./management";
import { publicPageRequest, publicSorts, type PublicSort } from "./public-paging";
import { displaySourceName, displaySourceNames, installedSetNames, skillVersions } from "../../synced-skill-grouping";
import { CreatorSocialLinks, CreatorProfileDetails } from "./CreatorProfileDetails";
import { discoveryCreatorGroups, featuredProfiles, isCompany } from "./discovery-presentation";
import { descriptionParagraphs, descriptionSummary, whenLead } from "./description-paragraphs";
import { Avatar } from "./Avatar";
import { DataPage } from "./DataPage";
import { DevelopersPage } from "./DevelopersPage";
import { isMacDevice } from "./install-command";
import { SiteFooter } from "./SiteFooter";
import { saveTheme, storedTheme, type Theme } from "./theme-preference";
import { trackEvent } from "./analytics";
import { SavedSkillReadme, SavedVersionsList, SharedSkillReadme, SkillReadme, savedSkillKeys } from "./SkillReadme";
import type { SavedSkillMdLoader, SavedVersionsLoader, SharedSkillMdLoader } from "../../cloud-save/cloud-save";
import { AlphaRail, railLetter, railLettersOf as railLetters } from "./AlphaRail";
import { CloudStatusBadge, CloudStatusSection, type CloudInfo } from "./CloudStatus";
import { looksLikeGithubLink, type MySkillAdditions } from "../my-skills-additions";
import { AddSkillForm } from "./AddSkillDialog";
import { PortalApiError } from "../../api-error";
import { cloudSkillRows, needsAttention, skillCloudRow, statusText } from "../../cloud-save/cloud-save";

// Official Lucide artwork (ISC): https://lucide.dev/icons/playing-cards-fan
// This icon is not yet included in our installed Lucide version.
const PlayingCardsFan = createLucideIcon("PlayingCardsFan", [
  ["path", { d: "M12.65 7.65a2 2 0 012.629-1.046l5.51 2.374a2 2 0 011.046 2.628l-3.957 9.184a2 2 0 01-2.628 1.046l-5.51-2.374a2 2 0 01-1.046-2.628z", key: "front" }],
  ["path", { d: "M18 7.777V4a2 2 0 00-2-2h-6a2 2 0 00-2 2v10a2 2 0 001.137 1.805", key: "middle" }],
  ["path", { d: "m8 4.389-4.364.809a2 2 0 00-1.602 2.33l1.822 9.833a2 2 0 002.331 1.602l2.542-.47", key: "back" }],
]);

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
  readOnlyAccount?: boolean;
  onSignIn?: () => void;
  management?: UnifiedManagement;
  accountPages?: (view: View, theme: string) => ReactNode;
  /** Reads a local skill's instructions from the user's cloud save, when signed in. */
  savedSkillMd?: SavedSkillMdLoader;
  /** Reads a private Set item's instructions for people the Set is shared with. */
  sharedSkillMd?: SharedSkillMdLoader;
  /** Lists a local skill's saved versions, so an older one can be restored on a Mac. */
  savedVersions?: SavedVersionsLoader;
  /** Each skill's cloud save status, shown in the list and the detail panel. */
  cloud?: CloudInfo;
  /** Library skills added to My skills; absent where the account can't keep them. */
  additions?: MySkillAdditions;
  /** My skills is still waiting on its cloud and added skills, so its count would jump. */
  mySkillsLoading?: boolean;
  publicInstallAction?: (skill: SkillDisplay, detailReady: boolean) => ReactNode;
  /** Clears a saved install request when the user cancels from the Install button. */
  onInstallCancel?: () => void;
  /** Shown once on arrival, e.g. after a broken address fell back to Discover. */
  initialNotice?: string;
  supportedAccountViews?: readonly View[];
};

/** A small mark beside a skill's name, only when cloud save can't keep a copy of it. */
function CloudAttention({ status }: { status?: Parameters<typeof needsAttention>[0] }) {
  if (!status || !needsAttention(status)) return null;
  const Icon = status === "review" ? TriangleAlert : CloudOff;
  return <span className="ua-row-cloud" data-status={status} title={statusText[status]} aria-label={statusText[status]} role="img"><Icon aria-hidden="true" /></span>;
}

// Semi-bolds the "Use when ..." lead-in so the reader sees when to use the skill first.
function DescriptionParagraph({ text }: { text: string }) {
  const lead = whenLead(text);
  return lead ? <><strong className="ua-when-lead">{lead}</strong>{text.slice(lead.length)}</> : <>{text}</>;
}

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
function CollectionCover({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      className="ua-collection-image"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      data-loaded={loaded}
      ref={(img) => { if (img?.complete && img.naturalWidth) setLoaded(true); }}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(false)}
    />
  );
}
function Menu({
  trigger,
  children,
  theme,
  label,
  side = "bottom",
  className = "",
  onCloseAutoFocus,
}: {
  trigger: ReactNode;
  children: ReactNode;
  theme: string;
  label: string;
  side?: "top" | "bottom";
  className?: string;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`ua-menu ua-theme ${className}`}
          data-theme={theme}
          aria-label={label}
          side={side}
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={onCloseAutoFocus}
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
  danger,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      className="ua-menu-item"
      data-danger={danger || undefined}
      onSelect={onSelect}
      disabled={disabled}
    >
      {Icon && <Icon />}
      {children}
    </DropdownMenu.Item>
  );
}

function ManagedSetHeader({ set, skills, management, theme, headingActions }: {
  set: PortalSet; skills: SkillDisplay[]; management: UnifiedManagement; theme: string; headingActions: ReactNode;
}) {
  const editable = set.role === "owner" && !set.hidden && !set.isFavorites;
  const disabled = management.busy || management.blocked;
  const access = setAccessSummary(set);
  const VisibilityIcon = set.visibility === "public" ? Globe : set.visibility === "restricted" ? Lock : User;
  const count = set.itemCount ?? set.items.length;
  const installLink = set.isFavorites ? null : management.installLink?.(set) ?? null;
  const descriptions = {
    public: "Anyone with the link can view this set.",
    restricted: "Only you and people granted email access.",
    private: "Just you, on your account.",
  };
  return <>
    <div className="ua-page-heading ua-set-heading ua-heading-filter">
      <div className="ua-set-identity">
        <div className="ua-set-hero" aria-hidden="true">
          {skills.length ? skills.slice(0, 3).map(skill => <Avatar key={skill.key} name={skill.name} src={skill.avatar} size="large" />)
            : <span className="ua-avatar ua-avatar-large"><Folder /></span>}
        </div>
        <div><h1>{set.name}</h1><p>{count} {count === 1 ? "skill" : "skills"} &middot; {access.label}</p></div>
      </div>
      <div className="ua-set-heading-controls">
      {editable && <IconButton label="Rename set" disabled={disabled} onClick={() => management.rename(set)}><Pencil /></IconButton>}
      {editable ? <Menu theme={theme} label="Set visibility" trigger={
        <button type="button" className="ua-pill" disabled={disabled} aria-label={`Set visibility: ${visibilityLabels[set.visibility]}`}>
          <VisibilityIcon /><span className="ua-set-visibility-label">{visibilityLabels[set.visibility]}</span><ChevronDown />
        </button>
      }>
        {(["public", "restricted", "private"] as const).map(value => <MenuItem key={value} disabled={disabled}
          onSelect={() => management.visibility(set, value)}>
          <span className="ua-visibility-check">{set.visibility === value && <Check />}</span>
          <span className="ua-visibility-option"><strong>{visibilityLabels[value]}</strong><span>{descriptions[value]}</span></span>
        </MenuItem>)}
      </Menu> : <span className="ua-muted">{visibilityLabels[set.visibility]}</span>}
      </div>
    </div>
    {!set.isFavorites && <div className="ua-set-access-bar">
      <div className="ua-set-people" aria-label={`Set access: ${access.label}`}>
        {access.people.slice(0, 5).map((person, index) => <span key={`${index}:${person}`} className="ua-member-initial" title={index === 0 ? `${person} (owner)` : person}>
          {person.slice(0, 2).toUpperCase()}
        </span>)}
        {access.people.length > 5 && <span className="ua-member-initial">+{access.people.length - 5}</span>}
      </div>
      {editable && <button type="button" className="ua-pill ua-invite" disabled={disabled} onClick={() => management.access(set)}>Invite</button>}
    </div>}
    <div className="ua-set-actions">
      {editable && <>
        <button className="ua-pill ua-set-action" type="button" aria-label="Add skill" title="Add skill" disabled={disabled} onClick={() => management.add([], set)}><Plus /><span>Add skill</span></button>
      </>}
      {installLink && !disabled && <a className="ua-pill ua-set-action" href={installLink} title="Install this Set with the OMGSkills Mac app">
        <Download /><span>Install on Mac</span></a>}
      <IconButton label="Copy link" onClick={() => management.copyLink(set)}><Copy /></IconButton>
      {set.hidden && <span className="ua-muted">Hidden from other people</span>}
      {set.role === "owner" && !set.isFavorites && <Menu theme={theme} label="Set options" trigger={<IconButton label="Set options" disabled={disabled}><MoreHorizontal /></IconButton>}>
        <MenuItem icon={EyeOff} disabled={disabled} onSelect={() => management.moderate(set)}>{set.hidden ? "Restore set" : "Hide set"}</MenuItem>
      </Menu>}
      {headingActions}
    </div>
  </>;
}
export function Modal({
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
/** The agents a skill is in, with their logos, for the skill panel. */
function AgentList({ sources }: { sources: string[] }) {
  return (
    <strong className="ua-agent-list">
      {displaySourceNames(sources).map((source) => (
        <span key={source} className="ua-agent-name">
          {agentKind(source) !== "other" && (
            <span className="ua-agent-tile" data-present="true" aria-hidden="true">
              <span className="ua-agent-logo" data-agent={agentKind(source)} />
            </span>
          )}
          {source}
        </span>
      ))}
    </strong>
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
  readOnlyAccount = false,
  onSignIn,
  management,
  accountPages,
  savedSkillMd,
  sharedSkillMd,
  savedVersions,
  cloud,
  additions,
  mySkillsLoading = false,
  publicInstallAction,
  onInstallCancel,
  supportedAccountViews,
  initialNotice = "",
}: Props) {
  // The Mac companion installs skills; elsewhere the copy command is the way to install.
  const [onMac] = useState(() => isMacDevice());
  const supportsView = (view: View) => !supportedAccountViews || isDiscovery(view) || supportedAccountViews.includes(view);
  const [rail, setRail] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    saveTheme(next);
    setTheme(next);
  }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerNavigating = useRef(false);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [dialog, setDialog] = useState<
    "new-set" | "membership" | "signin" | "add-skill" | null
  >(null);
  // "Add skill" starts with the GitHub link pasted in search, if any.
  const [addSkillLink, setAddSkillLink] = useState("");
  const [actionSkills, setActionSkills] = useState<SkillDisplay[]>([]);
  const [setName, setSetName] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  // The agent picker opens from the Install button and closes when another skill is shown.
  const [installOpen, setInstallOpen] = useState(false);
  // Long descriptions start as their "Use when" summary.
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  // Per-Mac scan history stays behind "Show history" at the bottom of the panel.
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => { setInstallOpen(false); setDescriptionOpen(false); setHistoryOpen(false); }, [nav.selected]);
  const [showHidden, setShowHidden] = useState(false);
  const [collectionPageIndex, setCollectionPageIndex] = useState(0);
  const [expandedSearchScope, setExpandedSearchScope] = useState<string | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches,
  );
  // Phones swipe through every collection instead of paging with arrows.
  const [phone, setPhone] = useState(
    () => window.matchMedia("(max-width: 759px)").matches,
  );
  const main = useRef<HTMLElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const models = useMemo(() => skillDisplays(data, catalog), [data, catalog]);
  // Sets still match skills no Mac reports any more; the lists, agents and counts show only what Macs have now.
  const everMine = signedIn ? models.mine : [];
  const mine = useMemo(() => (signedIn ? liveMine(models.mine) : []), [signedIn, models]);
  const cloudRows = useMemo(() => new Map(cloud && signedIn
    ? cloudSkillRows(cloud.state, data.skills).map(row => [row.key, row]) : []), [cloud, signedIn, data.skills]);
  const cloudRow = (skill: SkillDisplay) => cloudRows.size && (skill.installed || skill.cloudKey) ? skillCloudRow(cloudRows, savedSkillKeys(skill)) : null;
  // My skills is every skill you have: the ones on your Macs, then the ones kept only in your account.
  const notInstalled = useMemo(() => notInstalledSkills([...cloudRows.values()], mine, everMine, savedSkillKeys), [cloudRows, mine, everMine]);
  const added = useMemo(() => additions ? addedSkills(additions.skills, models.library, mine) : [], [additions, models, mine]);
  const notInstalledAll = useMemo(() => [...notInstalled, ...added.filter(skill =>
    !notInstalled.some(other => other.catalogId === skill.catalogId))], [notInstalled, added]);
  const allMine = useMemo(() => [...mine, ...notInstalledAll], [mine, notInstalledAll]);
  const inMySkills = (catalogId: string | undefined) => !!catalogId && !!additions?.skills.some(skill => skill.catalogId === catalogId);
  const changeMySkills = (catalogId: string, add: boolean) => {
    if (!additions || additions.pending.includes(catalogId)) return;
    void additions[add ? "add" : "remove"](catalogId).then(
      () => setNotice(add ? "Added to My skills" : "Removed from My skills"),
      error => setNotice(error instanceof PortalApiError && [404, 409].includes(error.status) ? error.message : "Couldn't update My skills. Try again."));
  };
  const attentionLabel = (skill: SkillDisplay) => {
    const status = !discovery ? cloudRow(skill)?.status : undefined;
    return status && needsAttention(status) ? `, ${statusText[status]}` : "";
  };
  // Only an installed skill can be fixed on a Mac.
  const attention = mine.filter(skill => { const row = cloudRow(skill); return !!row && needsAttention(row.status); });
  const sources = useMemo(
    () => displaySourceNames(mine.flatMap((s) => s.installed?.sourceSkills.map((copy) => copy.source) ?? [])),
    [mine],
  );
  const setRows = management?.detail.set ? setSkillDisplays(management.detail.set, everMine, catalog.skills) : [];
  // A Discover skill counts as yours only while a Mac has it, so Favorites and Sets get a live copy.
  const library = useMemo(() => models.library.map((skill) =>
    signedIn ? liveSkill(skill) : { ...skill, installed: undefined }), [signedIn, models]);
  const pendingSelection: SkillDisplay | undefined = publicStatus && nav.selected.startsWith("catalog:")
    ? { key: nav.selected, catalogId: nav.selected.slice(8), name: "Skill details", description: "", author: "", githubUrl: null, tags: [] }
    : undefined;
  const selected = [...mine, ...notInstalledAll, ...library, ...setRows, ...everMine].find((s) => s.key === nav.selected
    || (nav.selected.startsWith("synced:") && s.key.startsWith("synced:")
      && s.installed?.allSkillIds.includes(nav.selected.slice(7)))) || pendingSelection;
  const detailOpen = useRef(false);
  detailOpen.current = !!selected;
  const remoteDetail = !!publicStatus && nav.selected.startsWith("catalog:");
  const detailPending = remoteDetail && publicStatus.detail !== "ready";
  // Keep the last skill rendered while the panel animates out after the selection clears.
  const closingDetail = useRef<{ skill: SkillDisplay; pending: boolean } | null>(null);
  if (selected) closingDetail.current = { skill: selected, pending: detailPending };
  const detail = selected ?? closingDetail.current?.skill;
  const selectedInstallations = detail?.installed?.sourceSkills ?? [];
  // A Set or Favorites row holds the saved copy; versions come from all of that skill's copies Macs have now.
  const liveCopiesOf = (skill: SkillDisplay) => skill.installed && (mine.find(mineSkill =>
    mineSkill.installed?.allSkillIds.includes(skill.installed!.id))?.installed ?? liveSkill(skill).installed);
  const detailLive = detail ? liveCopiesOf(detail) : undefined;
  const detailVersions = detailLive ? skillVersions(detailLive) : [];
  // Installed means a Mac has it now; the install card can still add it for the agent that doesn't.
  const installedAgents = [...new Set((detailLive?.sources ?? []).map(agentKind))].sort().join(",");
  const installedHere = !!detailLive;
  // A synced personal skill no Mac has installs from the account's saved copy (the Mac app checks it's kept).
  const savedInstall = !!(onMac && signedIn && (!readOnlyAccount || management) && detail?.cloudKey && !detail.catalogId);
  const missingAgent = installedHere && !(installedAgents.includes("claude") && installedAgents.includes("codex"));
  // An install that finishes changes where the skill is; close the card and drop its intent.
  const installDone = useRef(installedAgents);
  useEffect(() => {
    if (installDone.current === installedAgents) return;
    installDone.current = installedAgents;
    if (installOpen) onInstallCancel?.();
    setInstallOpen(false);
  }, [installedAgents, installOpen, onInstallCancel]);
  const panelPending = selected ? detailPending : !!closingDetail.current?.pending;
  // List rows already carry the name and avatar; only the direct-link placeholder (no author) waits.
  const detailHeadingKnown = !!detail && !(panelPending && !detail.author);
  const detailParagraphs = detail ? descriptionParagraphs(detail.description) : [];
  const detailSummary = detail ? descriptionSummary(detail.description) : null;
  const relatedSkills = detail?.author
    ? library
        .filter((skill) => skill.author === detail.author && skill.catalogId !== detail.catalogId)
        .slice(0, 3)
    : [];
  const activeSet = signedIn
    ? management?.detail.set ?? data.sets.find((set) => set.id === nav.id)
    : undefined;
  const collection = catalog.collections.find((item) => item.id === nav.id);
  const collectionHeader = nav.view === "collection" && !nav.query ? collection : undefined;
  const showCollectionPager = nav.view === "discover" && !nav.query;
  const trendingHeader = nav.view === "top" && !nav.query;
  const swipeCollections = showCollectionPager && phone;
  const collectionPage = discoverCollectionPage(catalog.collections, collectionPageIndex);
  const collectionsReady = !publicStatus || (publicStatus.metadata ?? publicStatus.list) === "ready";
  const creator = catalog.creators.find((item) => item.handle === nav.id);
  const creatorGroups = useMemo(() => discoveryCreatorGroups(catalog.creators), [catalog.creators]);
  const creatorHeader = nav.view === "creator" && !nav.query;
  const discovery = !signedIn || isDiscovery(nav.view);
  const favorites = mine.filter((skill) => isFavorite(data, skill));
  const sets = signedIn
    ? data.sets.filter((set) => (!set.hidden || (showHidden && nav.view === "sets")) && !set.isFavorites)
    : [];
  // "Add skill" (GitHub link) is for your own My skills.
  // Signed-in accounts that can edit My skills (the live app always passes management).
  const findByGithubLink = signedIn && (!readOnlyAccount || !!management) ? additions?.findByGithubLink : undefined;
  const githubLinkSearch = !!findByGithubLink && looksLikeGithubLink(nav.query);
  const openAddSkill = (link = "") => { setAddSkillLink(link); setDialog("add-skill"); };
  const editableView =
    signedIn && (!readOnlyAccount || !!management) &&
    ["all", "favorites", "set"].includes(nav.view) &&
    (!activeSet || (activeSet.role === "owner" && !activeSet.hidden));
  const matchingMine = allMine.filter((skill) => matchesSearch(skill, nav.query) && (nav.source === "all" || skill.installed?.sources.includes(displaySourceName(nav.source))));
  const remoteRows = catalog.resultIds?.flatMap((id) => library.find((skill) => skill.catalogId === id) || []) || [];
  const matchingLibrary = publicStatus ? remoteRows : library.filter((skill) => matchesSearch(skill, nav.query));
  const privateSearch = readOnlyAccount && !discovery;
  const dataPage = nav.view === "data" && !nav.query.trim();
  const developersPage = nav.view === "developers" && !nav.query.trim();
  const publicList = !!publicStatus && !dataPage && !developersPage && (isDiscovery(nav.view) || (!privateSearch && !!nav.query.trim()));
  const setPage = !!management && ["set", "favorites"].includes(nav.view);
  const progressiveDiscover = publicList && nav.view === "discover" && !nav.query.trim();
  const metadataOnly = !nav.query.trim() && ["creators", "collections"].includes(nav.view);
  const publicListState = metadataOnly ? publicStatus?.metadata ?? publicStatus?.list : publicStatus?.list;
  const publicListError = metadataOnly ? publicStatus?.metadataError : publicStatus?.error;
  const listState = dataPage || developersPage || progressiveDiscover ? "ready" : publicList ? publicListState : setPage && state === "ready" ? management.detail.state
    : nav.view === "all" && state === "ready" && mySkillsLoading ? "loading" : state;
  const myCountReady = state === "ready" && !mySkillsLoading;
  const canManage = !!management && !management.blocked && !management.busy;
  const editableSet = activeSet?.role === "owner" && !activeSet.hidden && !activeSet.isFavorites;
  const scopeKey = `${nav.view}:${nav.id}:${nav.query}:${nav.source}:${signedIn}`;
  const pageKey = `${nav.view}:${nav.id}`;
  const previousPage = useRef(pageKey);
  const accountNavigating = useRef(false);

  useEffect(() => {
    const changed = previousPage.current !== pageKey;
    previousPage.current = pageKey;
    // Page changes need a focus destination; search and detail dialogs own theirs.
    if (changed && !nav.selected) main.current?.focus({ preventScroll: true });
  }, [pageKey, nav.selected]);
  useEffect(() => {
    setEditing(false);
    setPicked([]);
    setDialog(null);
    setExpandedSearchScope(null);
    main.current?.scrollTo(0, 0);
  }, [scopeKey]);
  useEffect(() => {
    setSubmittedQuery(null);
  }, [nav.query, nav.view, nav.id, signedIn]);
  // One event per public search session, not per keystroke.
  const searching = isDiscovery(nav.view) && !!nav.query.trim();
  useEffect(() => {
    if (searching) trackEvent("App Search");
  }, [searching]);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 760px)");
    const change = () => {
      if (mq.matches) { drawerNavigating.current = true; setDrawerOpen(false); }
    };
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const change = () => setWide(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 759px)");
    const change = () => setPhone(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  function go(view: View, id = "") {
    if (!supportsView(view)) return;
    if (drawerOpen) { drawerNavigating.current = true; setDrawerOpen(false); }
    navigate({ view, id, query: "", selected: "", source: "all" });
  }
  function open(skill: SkillDisplay) {
    const trigger = document.activeElement as HTMLElement | null;
    if (!trigger?.closest(".ua-detail")) detailTrigger.current = trigger;
    if (skill.key.startsWith("catalog:")) trackEvent("App Skill Open");
    navigate(openSkillNavigation(nav, skill));
  }
  function closeDetail() {
    navigate({ ...nav, selected: "" });
  }
  function addToSet(skills: SkillDisplay[]) {
    if (management) { management.add(skills); return; }
    if (readOnlyAccount) return;
    setActionSkills(skills);
    setDialog("membership");
  }
  function newSet(skills: SkillDisplay[] = []) {
    if (management) { management.create(skills); return; }
    if (readOnlyAccount) return;
    setActionSkills(skills);
    setSetName("");
    setDialog("new-set");
  }
  function changeQuery(query: string) {
    navigate({ ...nav, query, selected: "" }, true);
  }
  function signIn() {
    if (onSignIn) onSignIn();
    else setDialog("signin");
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
  async function copyInstall(skill: SkillDisplay) {
    if (!skill.installCommand) return;
    try {
      await navigator.clipboard.writeText(skill.installCommand);
      trackEvent("App Copy Install");
      setNotice("Install command copied");
    } catch {
      setNotice("Could not copy the install command.");
    }
  }
  async function share(skill: SkillDisplay) {
    if (!skill.catalogId) return;
    const path = catalogSkillPath(skill.catalogId) ?? `?view=discover&skill=${encodeURIComponent(`catalog:${skill.catalogId}`)}`;
    const url = new URL(`/app/${path}`, window.location.origin).href;
    if (navigator.share) {
      try { await navigator.share({ title: `${skill.name} | omgskills`, url }); return; }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Skill link copied");
    } catch {
      setNotice("Could not copy the link.");
    }
  }
  const search = (mobile = false) => (
    <label className={`ua-search ${mobile ? "ua-search-mobile" : ""}`}>
      <Search />
      <span className="ua-sr">Search skills or creators</span>
      <input
        type="search"
        enterKeyHint="search"
        placeholder="Search skills"
        value={nav.query}
        onChange={(event) => changeQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || !nav.query.trim()) return;
          event.preventDefault();
          setSubmittedQuery(nav.query);
        }}
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
    if (!supportsView(view)) return null;
    const active = !nav.query && (view === "creators"
      ? (nav.view === "creators" && nav.id === id) || (nav.view === "creator" && isCompany(nav.id, creator?.isCompany) === (id === "companies"))
      : nav.view === view && (view === "all" ? nav.id === id : !id || nav.id === id));
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
  const themeToggle = <IconButton
    label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    className="ua-icon ua-theme-toggle"
    onClick={toggleTheme}
  >{theme === "light" ? <Moon /> : <Sun />}</IconButton>;
  const accountMenu = (mobile = false) => (
    <Menu
      theme={theme}
      label="Account"
      side="top"
      className={mobile ? "ua-drawer-account-menu" : ""}
      onCloseAutoFocus={event => {
        if (!accountNavigating.current) return;
        accountNavigating.current = false;
        event.preventDefault();
        main.current?.focus({ preventScroll: true });
      }}
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
              {sources.length} sources{!readOnlyAccount && ` · ${data.devices.length} devices`}
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
      {supportsView("profile") && <MenuItem icon={User} onSelect={() => goFromAccount("profile")}>
        Profile
      </MenuItem>}
      {supportsView("agents") && <MenuItem icon={Bot} onSelect={() => goFromAccount("agents")}>
        Agents <small>{sources.length} observed</small>
      </MenuItem>}
      {(!readOnlyAccount || accountPages) && <>{supportsView("devices") && <MenuItem icon={Monitor} onSelect={() => goFromAccount("devices")}>
        Devices {!readOnlyAccount && <small>{data.devices.length}</small>}
      </MenuItem>}
      {supportsView("github") && <MenuItem icon={Code} onSelect={() => goFromAccount("github")}>
        GitHub sources
      </MenuItem>}
      {supportsView("cloud") && accountPages && <MenuItem icon={Cloud} onSelect={() => goFromAccount("cloud")}>
        Sync
      </MenuItem>}
      {supportsView("mcp") && <MenuItem icon={Server} onSelect={() => goFromAccount("mcp")}>
        MCP server
      </MenuItem>}
      </>}
      <DropdownMenu.Separator className="ua-separator" />
      <MenuItem
        icon={theme === "light" ? Moon : Sun}
        onSelect={toggleTheme}
      >
        {theme === "light" ? "Dark" : "Light"} appearance
      </MenuItem>
      <MenuItem icon={LogOut} onSelect={() => onSession(false)}>
        Sign out
      </MenuItem>
    </Menu>
  );

  function goFromAccount(view: View) {
    accountNavigating.current = nav.view !== view || !!nav.id || !!nav.query || !!nav.selected;
    go(view);
  }

  function renderRow(skill: SkillDisplay, rank?: number, compact = false) {
    const canSelect = editing && !!skill.installed;
    const liveCopies = !discovery ? liveCopiesOf(skill) : undefined;
    const versionCount = liveCopies ? skillVersions(liveCopies).length : 0;
    const fromSets = !discovery && skill.installed ? installedSetNames(skill.installed) : [];
    return (
      <div
        key={skill.key}
        className={`ua-row ${compact ? "ua-row-compact" : ""}`}
        data-selected={selected?.key === skill.key}
        data-letter={!discovery && !compact ? railLetter(skill.name) : undefined}
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
          onClick={event =>
            canSelect
              ? setPicked((old) =>
                  old.includes(skill.key)
                    ? old.filter((id) => id !== skill.key)
                    : [...old, skill.key],
                )
              : event.detail < 2 ? open(skill) : undefined
          }
          aria-label={`Open ${skill.name}${versionCount > 1 ? `, ${versionCount} versions` : ""}${attentionLabel(skill)}`}
          aria-expanded={selected?.key === skill.key}
        >
          <Avatar src={skill.avatar} name={skill.author || skill.name} />
          <span className="ua-row-text">
            <span className="ua-row-heading">
              <span className="ua-row-name">{skill.name}</span>
              {!compact && !creatorHeader && (discovery || nav.query) && skill.author && (
                <span className="ua-row-author">@{skill.author}</span>
              )}
              {!discovery && <CloudAttention status={cloudRow(skill)?.status} />}
              {(skill.cloudKey || skill.added) && <span className="ua-row-versions" title="In My skills, not on any of your Macs">Not installed</span>}
              {versionCount > 1 && <span className="ua-row-versions" title="Your agents have different versions of this skill">
                {versionCount} versions
              </span>}
              {skill.stars !== undefined && (
                <span className="ua-row-stars ua-row-stars-mobile" aria-label={`${starCount(skill.stars)} stars`}>
                  <Star aria-hidden="true" />{starCount(skill.stars)}
                </span>
              )}
            </span>
            <span className="ua-row-description">
              {compact
                ? <>
                    {skill.author && `@${skill.author}`}
                    {skill.stars !== undefined && <>
                      {skill.author && <span className="ua-trending-separator" aria-hidden="true"> · </span>}
                      <span className="ua-trending-stars" aria-label={`${starCount(skill.stars)} stars`}>
                        <Star aria-hidden="true" />{starCount(skill.stars)}
                      </span>
                    </>}
                  </>
                : skill.description || "No description available"}
            </span>
            {fromSets.length > 0 && <span className="ua-row-description" title={`From Set: ${fromSets.join(", ")}`}>
              From Set: {fromSets.join(", ")}
            </span>}
          </span>
        </button>
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
                className="ua-pill ua-link ua-row-open"
                aria-label={`Open ${skill.name} details`}
                title={`Open ${skill.name} details`}
                onClick={event => { if (event.detail < 2) open(skill); }}
              >
                <ChevronRight aria-hidden="true" />
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
              {(!readOnlyAccount || management) && skill.installed && <><MenuItem icon={ListPlus} disabled={!!management && !canManage} onSelect={() => addToSet([skill])}>
                Add to set
              </MenuItem>
              <MenuItem icon={Heart} disabled={!!management && !canManage} onSelect={() => management ? management.favorite(skill) : onFavorite(skill)}>
                {isFavorite(data, skill)
                  ? "Remove from favorites"
                  : "Add to favorites"}
              </MenuItem>
              </>}
              {management && skill.setItemId && activeSet && (editableSet || (activeSet.isFavorites && activeSet.role === "owner")) && <MenuItem icon={X} disabled={!canManage} onSelect={() => management.remove(activeSet, skill)}>
                Remove from set
              </MenuItem>}
              {management?.updateItem && skill.setItemId && skill.setItemUpdateAvailable && activeSet && editableSet && <MenuItem icon={RefreshCw} disabled={!canManage} onSelect={() => management.updateItem!(activeSet, skill.setItemId!)}>
                Update to newest saved version
              </MenuItem>}
              {management && skill.setItemId && activeSet && editableSet && <>
                <MenuItem icon={ArrowUp} disabled={!canManage || activeSet.items[0]?.id === skill.setItemId} onSelect={() => management.reorder(activeSet, skill.setItemId!, -1)}>Move up</MenuItem>
                <MenuItem icon={ArrowDown} disabled={!canManage || activeSet.items.at(-1)?.id === skill.setItemId} onSelect={() => management.reorder(activeSet, skill.setItemId!, 1)}>Move down</MenuItem>
              </>}
              {skill.added && additions && <MenuItem icon={X} onSelect={() => changeMySkills(skill.catalogId!, false)}>
                Remove from My skills
              </MenuItem>}
              <MenuItem
                icon={Copy}
                onSelect={() => void copySource(skill)}
                disabled={!skill.githubUrl}
              >
                Copy source link
              </MenuItem>
              {(!readOnlyAccount || management) && liveCopies && versionCount > 1 && <MenuItem icon={RefreshCw}
                onSelect={() => window.location.assign(matchVersionsLink(liveCopies.name))}>
                Make versions match…
              </MenuItem>}
              {(!readOnlyAccount || management) && liveCopies && <MenuItem icon={Trash2} danger
                onSelect={() => window.location.assign(removeFromMacLink([liveCopies.name]))}>
                Delete from my Mac…
              </MenuItem>}
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
      <Empty title={nav.query ? "Nothing matches" : publicStatus && nav.view === "creator" ? "Creator not found"
        : publicStatus && nav.view === "collection" ? "Collection not found" : "No skills here yet"}>
        {nav.query
          ? "Try a creator or a task."
          : publicStatus && nav.view === "creator" ? `No creator called @${nav.id} is in the catalog.`
          : publicStatus && nav.view === "collection" ? "This collection doesn't exist or was removed."
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
  // Called as functions, not <Components>: inner components remount (and replay their
  // entrance fade and image loads) on every render of UnifiedApp.
  function CollectionCards({ items = catalog.collections, swipe = false }: { items?: CatalogDisplay["collections"]; swipe?: boolean }) {
    return (
      <div className={`ua-collections${swipe ? " ua-collections-swipe" : ""}`}>
        {items.map((item) => (
          <button
            type="button"
            className="ua-collection"
            key={item.id}
            onClick={() => go("collection", item.id)}
          >
            {item.imageUrl && <CollectionCover key={item.imageUrl} src={item.imageUrl} />}
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

  function publicSection(section: "metadata" | "list", label: string, children: ReactNode) {
    const status = section === "metadata" ? publicStatus?.metadata ?? publicStatus?.list : publicStatus?.list;
    const error = section === "metadata" ? publicStatus?.metadataError : publicStatus?.error;
    if (status === "loading") return <div className="ua-skeletons" role="status" aria-label={`Loading ${label}`}>
      {Array.from({ length: 3 }, (_, i) => <div key={i} />)}
    </div>;
    return <>
      {error && <div className="ua-toolbar" role="status">
        <span className="ua-muted">{status === "ready" ? "Could not refresh. Showing saved results." : error}</span>
        <button type="button" className="ua-pill" onClick={publicStatus?.retry}>Retry {label}</button>
      </div>}
      {status !== "error" && children}
    </>;
  }
  function CreatorList({ items, limit }: { items: CatalogDisplay["creators"]; limit?: number }) {
    const shown = limit === undefined ? items : featuredProfiles(items, limit);
    return (
      <div className="ua-creators">
        {shown.map((item) => (
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
  let visible = nav.view === "favorites" ? favorites : nav.view === "all" && nav.id === "attention" ? attention
    : nav.view === "all" ? byInstalled(allMine, nav.show) : mine;
  if (nav.view === "set")
    visible = activeSet
      ? everMine.filter((skill) => isMember(activeSet, skill.installed!))
          .map((skill) => { const live = liveSkill(skill); return live.installed ? live : skill; })
      : [];
  if (setPage) visible = setRows;
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
      skill.installed && displaySourceNames(skill.installed.sources).includes(displaySourceName(nav.source)),
    );
  const origin = !isDiscovery(nav.view) && !setPage && nav.show && ["personal", "public", "origin"].includes(nav.show) ? skillsByOrigin(visible) : null;
  if (origin && nav.show !== "origin") visible = nav.show === "personal" ? origin.personal : origin.public;
  // My own lists are in name order, so a letter index can jump through them.
  const nameOrdered = !discovery && !setPage && ["all", "favorites", "set"].includes(nav.view) && listState === "ready";
  if (nameOrdered) visible = [...visible].sort(byName);
  // The letter index needs one A–Z list on screen: not search results, and not the two By origin groups.
  const railList = nameOrdered && !nav.query.trim() && nav.show !== "origin";
  const attentionView = nav.view === "all" && nav.id === "attention";
  const titles: Record<View, string> = {
    all: attentionView ? "can't sync" : "my skills",
    favorites: "favorites",
    sets: "sets",
    discover: "Discover",
    data: "Data",
    developers: "Developers & Agents",
    top: publicStatus ? "Trending skills" : "Top this week",
    creators: nav.id === "companies" ? "Companies" : "Creators",
    collections: "Collections",
    set: activeSet?.name || "Set not found",
    creator: creator?.name || nav.id,
    collection: collection?.name || (listState === "loading" ? "Collection" : "Collection not found"),
    category: nav.id,
    agents: "agents",
    devices: "devices",
    profile: "profile",
    github: "GitHub sources",
    cloud: "Sync",
    mcp: "MCP server",
  };
  const title = nav.query
    ? submittedQuery === nav.query ? `\u201c${nav.query.trim()}\u201d` : "Search results"
    : titles[nav.view];
  const meta = nav.query
    ? `Results for "${nav.query}"`
    : attentionView
      ? "These can't sync yet. Open one to see why and what to do."
    : nav.view === "all" && listState === "loading"
      ? "Loading skills\u2026"
    : nav.view === "all"
      ? notInstalledAll.length ? `${allMine.length} skills · ${notInstalledAll.length} not installed` : `${mine.length} skills across ${sources.length} sources`
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
                  ? "Trending skills around the world"
                  : "";
  const headingActions = listState === "ready" && !nav.query &&
    (editableView || (readOnlyAccount && signedIn && nav.view === "all")) ? (
    <div className="ua-heading-actions">
      {editableView && <button
        type="button"
        className="ua-pill"
        onClick={() => {
          setEditing(!editing);
          setPicked([]);
          closeDetail();
        }}
      >
        {editing ? "Done" : "Edit"}
      </button>}
      {findByGithubLink && nav.view === "all" && !nav.id && !editing && <button type="button" className="ua-pill ua-add-skill-button"
        aria-label="Add skill" onClick={() => openAddSkill()}><Plus aria-hidden="true" /><span className="ua-add-skill-label">Add skill</span></button>}
      {nav.source !== "all" && <button type="button" className="ua-pill" aria-label={`Stop showing only ${displaySourceName(nav.source)} skills`}
        onClick={() => navigate({ ...nav, source: "all" })}>{displaySourceName(nav.source)} <X aria-hidden="true" /></button>}
      {!setPage && <label className="ua-filter">
        <span className="ua-filter-label">Show</span>
        <select
          aria-label="Show skills"
          value={nav.show ?? "all"}
          onChange={(event) => {
            // A different set of rows: drop selections made in the old one and start at the top.
            setPicked([]);
            main.current?.scrollTo({ top: 0 });
            navigate({ ...nav, show: event.target.value === "all" ? undefined : event.target.value as SkillShow });
          }}
        >
          <option value="all">All</option>
          {nav.view === "all" && nav.id !== "attention" && <option value="installed">Installed</option>}
          {nav.view === "all" && nav.id !== "attention" && <option value="not-installed">Not installed</option>}
          <option value="personal">Personal</option>
          <option value="public">Public</option>
          <option value="origin">By origin</option>
        </select>
      </label>}
    </div>
    ) : null;

  const catalogCount = publicList && publicStatus.page ?
    <span className="ua-muted ua-catalog-count" role="status" aria-live="polite">{publicStatus.loaded} of {publicStatus.page.total}</span> : null;
  const catalogNote = publicList && listState === "ready" ? publicStatus.note : "";
  const catalogSort = publicList && publicStatus.page && publicPageRequest(nav)?.name !== "list_trending" ? <label className="ua-filter ua-sort-filter" title="Sort skills">
    <ArrowUpDown className="ua-sort-icon" aria-hidden="true" />
    <span className="ua-filter-label">Sort</span>
    <select aria-label="Sort skills" value={nav.sort ?? "relevance"} onChange={event => navigate({ ...nav, sort: event.target.value as PublicSort })}>
      {publicSorts.map(value => <option key={value} value={value}>{({ relevance: "Relevance", trending: "Trending", stars: "Stars", updated: "Recently updated", added: "Recently added", name: "Name" })[value]}</option>)}
    </select>
  </label> : null;
  const catalogControls = publicList && publicStatus.page && !trendingHeader ? <div className="ua-catalog-controls">
    {!nav.query && catalogCount}
    {catalogSort}
  </div> : null;

  return (
    <div className="ua-theme ua-root" data-theme={theme}>
      {previewBar}
      <div
        className="ua-workspace"
        data-rail={rail}
        data-detail={!!selected && wide}
      >
        <aside className="ua-sidebar" aria-label="Main navigation">
          {/* The logo is home: My skills when signed in, Discover otherwise. */}
          <button type="button" className="ua-brand" aria-label={signedIn ? "Go to My skills" : "Go to Discover"} onClick={() => go(signedIn ? "all" : "discover")}>
            <span aria-hidden="true">👀</span>
            <strong>omgskills</strong>
          </button>
          {signedIn && (
            <div className="ua-modes" role="group" aria-label="App mode">
              <button
                type="button"
                aria-pressed={!discovery}
                title="My skills"
                onClick={() => go("all")}
              >
                <User />
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
                {navItem("creators", "Companies", Building2, undefined, "companies")}
                {navItem("creators", "Creators", Users)}
                {navItem("collections", "Collections", PlayingCardsFan)}
                {navItem("data", "Data", ChartNoAxesColumn)}
                {navItem("developers", "Developers", CodeXml)}
              </>
            ) : (
              <>
                {navItem("all", "All skills", User, myCountReady ? allMine.length : undefined)}
                {attention.length > 0 && navItem("all", "Can't sync", TriangleAlert, attention.length, "attention")}
                {(!readOnlyAccount || management) && <>{navItem("favorites", "Favorites", Heart, management ? data.sets.find(set => set.isFavorites)?.itemCount ?? 0 : favorites.length)}
                {management && navItem("sets", "All sets", Shapes, sets.length)}
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
                </>}
                {/* Your library over MCP lives on the Developers page too. */}
                <div className="ua-nav-group">{navItem("developers", "Developers", CodeXml)}</div>
              </>
            )}
          </nav>
          <div className="ua-sidebar-bottom">
            {themeToggle}
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
                onClick={signIn}
                data-humblytics="App Sign In"
              >
                <User />
                <span>Sign in</span>
              </button>
              {!publicInstallAction && <a
                className="ua-sidebar-download"
                href="/download"
                data-humblytics="App Get Mac App"
                target="_blank"
                rel="noreferrer"
                aria-label="Get the Mac app for Apple silicon, macOS 14 or later"
                title="OMGSkills 0.0.37 for Apple silicon, macOS 14 or later"
              ><span className="ua-apple-mark" aria-hidden="true">&#63743;</span><span>Get the Mac app<small className="ua-download-requirements">Apple silicon, macOS 14+</small></span></a>}
            </div>
          )}
        </aside>
        <div className="ua-content-column">
          <header className="ua-mobile-header">
            <button type="button" className="ua-mobile-logo" aria-label={signedIn ? "Go to My skills" : "Go to Discover"}
              onClick={() => go(signedIn ? "all" : "discover")}>👀</button>
            {search(true)}
            {signedIn ? <Dialog.Root open={drawerOpen} onOpenChange={open => {
              if (open) drawerNavigating.current = false;
              setDrawerOpen(open);
            }}>
              <Dialog.Trigger asChild>
                <IconButton label="Open navigation" className="ua-icon ua-mobile-menu"><MenuIcon /></IconButton>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="ua-drawer-overlay" />
                <Dialog.Content className="ua-drawer ua-theme" data-theme={theme} aria-describedby={undefined}
                  onCloseAutoFocus={event => {
                    if (drawerNavigating.current) {
                      event.preventDefault();
                      main.current?.focus({ preventScroll: true });
                      drawerNavigating.current = false;
                    }
                  }}>
                  <div className="ua-drawer-header">
                    <Dialog.Title className="ua-drawer-title">Navigation</Dialog.Title>
                    <Dialog.Close asChild><IconButton label="Close navigation"><X /></IconButton></Dialog.Close>
                  </div>
                  <nav aria-label="Mobile navigation">
                    {([
                      ["all", "My Skills", User, true, ""],
                      ["favorites", "Favorites", Heart, false, ""],
                      ["sets", "Sets", Shapes, false, ""],
                      ["discover", "Discover", Compass, true, ""],
                      ["top", "Trending", TrendingUp, false, ""],
                      ["creators", "Companies", Building2, false, "companies"],
                      ["creators", "Creators", Users, false, ""],
                      ["collections", "Collections", PlayingCardsFan, false, ""],
                      ["data", "Data", ChartNoAxesColumn, false, ""],
                      ["developers", "Developers", CodeXml, false, ""],
                    ] as const).filter(([view]) => supportsView(view)).map(([view, label, Icon, heading, id]) => <button type="button" key={`${view}:${id}`}
                      className={`ua-nav-item${heading ? " ua-drawer-section" : ""}`}
                      aria-current={(view === "creators"
                        ? (nav.view === view && nav.id === id) || (nav.view === "creator" && isCompany(nav.id, creator?.isCompany) === (id === "companies"))
                        : nav.view === view || (view === "sets" && nav.view === "set") || (view === "collections" && nav.view === "collection")) && !nav.query ? "page" : undefined}
                      onClick={() => go(view, id)}><Icon /><span>{label}</span></button>)}
                  </nav>
                  <div className="ua-drawer-profile">{themeToggle}{accountMenu(true)}</div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root> : (
              <button
                type="button"
                className="ua-pill ua-primary"
                onClick={signIn}
                data-humblytics="App Sign In"
              >
                Sign in
              </button>
            )}
          </header>
          <main className="ua-main" data-view={nav.view} ref={main} id="unified-main" tabIndex={-1}>
            {railList && <AlphaRail scroller={main} letters={railLetters(visible)} count={visible.length} />}
            <div className="ua-content">
              {!collectionHeader && !creatorHeader && ((["creator", "collection", "category"].includes(nav.view) && !nav.query) ||
                (!signedIn && (nav.view !== "discover" || !!nav.query))) && (
                  <button
                    type="button"
                    className="ua-link ua-back"
                    onClick={() => go("discover")}
                  >
                    <ArrowLeft />
                    Discover
                  </button>
                )}
              {collectionHeader ? (
                <header className="ua-collection-banner">
                  {collectionHeader.imageUrl && <CollectionCover key={collectionHeader.imageUrl} src={collectionHeader.imageUrl} />}
                  <button
                    type="button"
                    className="ua-link ua-back"
                    onClick={() => go("discover")}
                  >
                    <ArrowLeft />
                    Discover
                  </button>
                  <div className="ua-collection-banner-copy">
                    <h1>{title}</h1>
                    {meta && <p>{meta}</p>}
                  </div>
                </header>
              ) : creatorHeader ? (
                <header className="ua-creator-banner">
                  <button
                    type="button"
                    className="ua-link ua-back"
                    onClick={() => go("discover")}
                  >
                    <ArrowLeft />
                    Discover
                  </button>
                  <div className="ua-creator-banner-identity">
                    <Avatar
                      key={nav.id}
                      name={title}
                      src={creator?.avatar || library.find((skill) => skill.author === nav.id)?.avatar}
                      size="large"
                    />
                    <div>
                      <h1>{title}</h1>
                      <p className="ua-creator-tagline">{meta && <span>{meta}</span>}<CreatorSocialLinks handle={nav.id} /></p>
                    </div>
                  </div>
                  <CreatorProfileDetails handle={nav.id} />
                </header>
              ) : management && nav.view === "set" && activeSet && management.detail.state === "ready" ?
                <ManagedSetHeader set={activeSet} skills={setRows} management={management} theme={theme} headingActions={headingActions} /> : dataPage ? null : <div className={`ua-page-heading${headingActions ? " ua-heading-filter" : ""}${showCollectionPager ? " ua-heading-collections" : ""}${trendingHeader ? " ua-heading-trending" : ""}${nav.query ? " ua-heading-search" : ""}`}>
                <div>
                  <h1>{showCollectionPager ? "Today" : title}</h1>
                  {meta && (nav.query ? <p className="ua-search-meta"><span>{meta}</span>{catalogCount}{catalogNote && <span role="status">{catalogNote}</span>}</p> : trendingHeader ? <p className="ua-search-meta"><span>{meta}</span>{catalogCount}</p> : <p>{meta}</p>)}
                </div>
                {headingActions}
                {nav.query && catalogSort}
                {showCollectionPager && !swipeCollections && (
                  <div className="ua-collection-controls" role="group" aria-label="Collection pages">
                    <IconButton
                      label="Previous collections"
                      aria-controls="ua-discover-collections"
                      disabled={!collectionsReady || collectionPage.index === 0}
                      onClick={() => setCollectionPageIndex(collectionPage.index - 1)}
                    >
                      <ChevronLeft />
                    </IconButton>
                    <IconButton
                      label="Next collections"
                      aria-controls="ua-discover-collections"
                      disabled={!collectionsReady || collectionPage.index === collectionPage.lastIndex}
                      onClick={() => setCollectionPageIndex(collectionPage.index + 1)}
                    >
                      <ChevronRight />
                    </IconButton>
                    <span className="ua-sr" role="status">
                      {collectionsReady && `Collections ${collectionPage.start} to ${collectionPage.end} of ${catalog.collections.length}`}
                    </span>
                  </div>
                )}
                {(!readOnlyAccount || management) && nav.view === "sets" && (
                  <button
                    type="button"
                    className="ua-pill"
                    disabled={!!management && !canManage}
                    onClick={() => newSet()}
                  >
                    <Plus />
                    New set
                  </button>
                )}
                {!readOnlyAccount && nav.view === "set" && activeSet && (
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
              </div>}
              {management?.notice && !detail && <p className="ua-muted" role="status">{management.notice}</p>}
              {setPage && management.detail.catalog?.state === "loading" && <p className="ua-muted" role="status">Loading catalog details...</p>}
              {setPage && management.detail.catalog?.note && <div className="ua-toolbar" role="status">
                <span className="ua-muted">{management.detail.catalog.note}</span>
                {management.detail.catalog.state === "error" && <button type="button" className="ua-pill" onClick={management.detail.catalog.retry}>Retry catalog details</button>}
              </div>}
              {!nav.query && catalogControls}
              {!nav.query && catalogNote && <p className="ua-muted ua-catalog-note" role="status">{catalogNote}</p>}
              {publicList && !progressiveDiscover && publicListError && listState === "ready" && <div className="ua-toolbar" role="status">
                <span className="ua-muted">Could not refresh. Showing saved results.</span>
                <button type="button" className="ua-pill" onClick={publicStatus.retry}>Retry</button>
              </div>}
              {githubLinkSearch ? (
                // A pasted GitHub link finds skills by where they live, not by words.
                <button type="button" className="ua-pill ua-primary ua-add-skill-offer"
                  onClick={() => openAddSkill(nav.query.trim())}><Plus aria-hidden="true" />Add skills from this GitHub link</button>
              ) : listState === "loading" ? (
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
                  {publicList && publicListError && <span>{publicListError}<br /></span>}
                  {setPage && <span>{management.detail.error}<br /></span>}
                  <button type="button" className="ua-pill" onClick={publicList ? publicStatus.retry : setPage ? management.detail.retry : retry}>
                    Try again
                  </button>
                </Empty>
              ) : nav.query && setPage ? rows(visible.filter(skill => matchesSearch(skill, nav.query))) : nav.query && privateSearch ? (
                  <section>
                    <SectionHeading title="In my skills" />
                    {signedIn ? (
                      rows(matchingMine)
                    ) : (
                      <p className="ua-muted">Sign in to see your skills.</p>
                    )}
                  </section>
              ) : nav.query ? (
                <div className="ua-search-results">
                  {matchingMine.length > 0 && <details className="ua-search-personal" key={scopeKey}
                    open={expandedSearchScope === scopeKey}
                    onToggle={event => setExpandedSearchScope(event.currentTarget.open ? scopeKey : null)}>
                    <summary className="ua-search-personal-toggle">
                      <span className="ua-search-personal-title">
                        My library
                        <span className="ua-search-personal-count">
                          {matchingMine.length} {matchingMine.length === 1 ? "skill" : "skills"}
                          <ChevronRight aria-hidden="true" />
                        </span>
                      </span>
                      <span className="ua-search-personal-hide">Hide</span>
                    </summary>
                    {rows(matchingMine)}
                  </details>}
                  <section className="ua-search-library">
                    {matchingMine.length > 0 && <h2 className="ua-search-library-label">Library</h2>}
                    {matchingMine.length > 0 && !matchingLibrary.length ? (
                      <Empty title="No library matches">Try a creator or a task.</Empty>
                    ) : rows(matchingLibrary)}
                  </section>
                </div>
              ) : developersPage ? (
                <DevelopersPage />
              ) : dataPage ? (
                <DataPage creators={catalog.creators} onCreator={handle => go("creator", handle)} onSkill={skill => open({
                  key: `catalog:${skill.id}`, catalogId: skill.id, name: skill.name, author: skill.authorHandle,
                  avatar: `https://github.com/${encodeURIComponent(skill.authorHandle)}.png?size=80`,
                  description: "", githubUrl: skill.githubUrl, stars: skill.stars, tags: [],
                })} />
              ) : nav.view === "discover" ? (
                <>
                  <div id="ua-discover-collections">
                    {publicSection("metadata", "collections", CollectionCards({ items: swipeCollections ? catalog.collections : collectionPage.items, swipe: swipeCollections }))}
                  </div>
                  <section>
                    <SectionHeading
                      title={publicStatus ? "Trending skills" : "Top this week"}
                      action={() => go("top")}
                    />
                    {publicSection("list", "trending skills", <div className="ua-trending">
                      {top
                        .slice(0, 9)
                        .map((skill, i) => renderRow(skill, i + 1, true))}
                    </div>)}
                  </section>
                  <section>
                    <SectionHeading
                      title="Companies"
                      action={() => go("creators", "companies")}
                    />
                    {publicSection("metadata", "companies", CreatorList({ items: creatorGroups.companies, limit: 9 }))}
                  </section>
                  <section>
                    <SectionHeading
                      title="Creators"
                      action={() => go("creators")}
                    />
                    {publicSection("metadata", "creators", CreatorList({ items: creatorGroups.creators, limit: 9 }))}
                  </section>
                  <section>
                    <SectionHeading title="Categories" />
                    {CategoryList({})}
                  </section>
                  <SiteFooter />
                </>
              ) : nav.view === "collections" ? (
                CollectionCards({})
              ) : nav.view === "creators" ? (
                CreatorList({ items: nav.id === "companies" ? creatorGroups.companies : creatorGroups.creators })
              ) : nav.view === "sets" ? (
                <div className="ua-set-list">
                  <label className="ua-hidden-filter"><input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)} />Show hidden sets</label>
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
                          {set.itemCount ?? set.items.length} skills ·{" "}
                          {visibilityLabels[set.visibility]}
                          {set.hidden ? " · Hidden" : ""}
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
              ) : ["agents", "devices", "profile", "github", "cloud", "mcp"].includes(
                  nav.view,
                ) ? (
                accountPages?.(nav.view, theme) ?? <div className="ua-account-page">
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
                      {data.profile.handle && <p>@{data.profile.handle}</p>}
                      <p>{data.profile.email}</p>
                      <p className="ua-muted">
                        {data.profile.published
                          ? "Public profile"
                          : "Unpublished profile"}
                      </p>
                    </>
                  )}
                  {nav.view === "cloud" && (
                    <Empty title="Sync">Sign in to sync your skills.</Empty>
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
                  {editing && (
                    <div className="ua-bulk">
                      <button
                        type="button"
                        className="ua-link"
                        onClick={() =>
                          setPicked(
                            visible.filter(s => s.installed).every(s => picked.includes(s.key))
                              ? []
                              : visible.filter(s => s.installed).map((s) => s.key),
                          )
                        }
                      >
                        {visible.filter(s => s.installed).every(s => picked.includes(s.key)) && picked.length
                          ? "Deselect all"
                          : "Select all"}
                      </button>
                      <span>{picked.length} selected</span>
                      <button type="button" className="ua-pill" disabled={!picked.length || (!!management && !canManage)}
                        onClick={() => newSet(visible.filter(skill => picked.includes(skill.key)))}><Plus />New set</button>
                      <button
                        type="button"
                        className="ua-pill"
                        disabled={!picked.length || (!!management && !canManage)}
                        onClick={() =>
                          addToSet(
                            visible.filter((s) => picked.includes(s.key)),
                          )
                        }
                      >
                        <ListPlus />
                        Add to set
                      </button>
                      {(!readOnlyAccount || management) && (() => {
                        const names = [...new Map(visible.filter(skill => picked.includes(skill.key))
                          .flatMap(skill => liveCopiesOf(skill)?.name ?? [])
                          .map(name => [name.trim().toLowerCase(), name] as const)).values()];
                        const tooMany = names.length > maxRemoveFromMac;
                        return <button type="button" className="ua-pill ua-pill-danger" disabled={!names.length || tooMany}
                          title={tooMany ? `Select up to ${maxRemoveFromMac} skills` : undefined}
                          onClick={() => window.location.assign(removeFromMacLink(names))}>
                          <Trash2 />Delete from my Mac
                        </button>;
                      })()}
                    </div>
                  )}
                  {visible.length ||
                  nav.view !== "set" ||
                  !activeSet?.items.length
                    ? origin && nav.show === "origin" && visible.length
                      ? <>
                          {origin.personal.length > 0 && <section className="ua-origin-group"><SectionHeading title="Personal" />{rows(origin.personal)}</section>}
                          {origin.public.length > 0 && <section className="ua-origin-group"><SectionHeading title="Public" />{rows(origin.public)}</section>}
                        </>
                      : rows(visible, nav.view === "top")
                    : null}
                  {!management && nav.view === "set" &&
                    activeSet &&
                    activeSet.items
                      .filter(
                        (item) =>
                          !everMine.some((skill) =>
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
              {publicList && (publicStatus.page?.hasMore || publicStatus.moreError) && <div className="ua-catalog-more">
                {publicStatus.moreError && <p className="ua-muted" role="status">{publicStatus.moreError}</p>}
                <button type="button" className="ua-pill" disabled={publicStatus.moreState === "loading"} onClick={event => { if (event.detail < 2) publicStatus.loadMore?.(); }}>
                  {publicStatus.moreState === "loading" && <LoaderCircle className="ua-page-spinner" aria-hidden="true" />}
                  {publicStatus.restartPages ? "Refresh results" : publicStatus.moreError ? "Retry" : publicStatus.moreState === "loading" ? "Loading" : "Load more"}
                </button>
              </div>}
            </div>
          </main>
        </div>
        {detail && (
          <Dialog.Root
            open={!!selected}
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
                  // Radix remounts content when changing between a pane and a modal.
                  if (detailOpen.current) return;
                  const trigger = detailTrigger.current;
                  const target = trigger?.isConnected && trigger.getClientRects().length ? trigger : main.current;
                  target?.focus({ preventScroll: true });
                  detailTrigger.current = null;
                }}
                onInteractOutside={(event) => {
                  if (wide) event.preventDefault();
                }}
              >
                <div className="ua-detail-header">
                <div className="ua-detail-top">
                  <span className="ua-grabber" />
                  <Dialog.Close asChild>
                    <IconButton label="Close skill details">
                      <X />
                    </IconButton>
                  </Dialog.Close>
                  {!detailHeadingKnown ? <Dialog.Title>{publicStatus?.detailMissing ? "Skill not found" : "Skill details"}</Dialog.Title> : (
                    <div className="ua-detail-heading">
                      <Avatar
                        src={detail.avatar}
                        name={detail.author || detail.name}
                        size="large"
                      />
                      <div className="ua-detail-heading-copy">
                        <Dialog.Title>{detail.name}</Dialog.Title>
                        <div className="ua-detail-meta">
                          {detail.author && (
                            <button
                              type="button"
                              className="ua-link"
                              onClick={() => go("creator", detail.author)}
                            >
                              @{detail.author}
                            </button>
                          )}
                          {detail.stars !== undefined && (
                            <span>
                              <Star />
                              {starCount(detail.stars)}
                            </span>
                          )}
                          {detail.githubUrl && (
                            <a
                              className="ua-detail-source"
                              href={detail.githubUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="View source on GitHub"
                              title="View source on GitHub"
                            >
                              <span className="ua-creator-github-mark" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {!panelPending && <>
                <div className="ua-detail-actions">
                  {/* Already on a Mac: say so instead of offering to install it again. */}
                  {onMac && signedIn && publicInstallAction && detail.catalogId && installedHere && (
                    <span className="ua-pill"><Check aria-hidden="true" />Installed</span>
                  )}
                  {onMac && signedIn && publicInstallAction && detail.catalogId && installedHere && missingAgent && !installOpen && (
                    <button type="button" className="ua-pill ua-detail-copy" aria-expanded={false} onClick={() => setInstallOpen(true)}>
                      Add to another agent
                    </button>
                  )}
                  {onMac && signedIn && publicInstallAction && detail.catalogId && (!installedHere || (missingAgent && installOpen)) && (
                    installOpen ? (
                      <button
                        type="button"
                        className="ua-pill ua-detail-copy"
                        aria-expanded
                        onClick={() => { setInstallOpen(false); onInstallCancel?.(); }}
                      >
                        Cancel <X />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ua-pill ua-primary"
                        aria-expanded={false}
                        onClick={() => setInstallOpen(true)}
                      >
                        Install <Download />
                      </button>
                    )
                  )}
                  {/* A synced personal skill no Mac has: the Mac app installs its newest saved version. */}
                  {savedInstall && (
                    <button type="button" className="ua-pill ua-primary" title="Install with the OMGSkills Mac app"
                      onClick={() => window.location.assign(installSavedLink(detail.name, detail.cloudKey!))}>
                      Install <Download />
                    </button>
                  )}
                  {/* A library skill can join My skills without installing it. */}
                  {signedIn && additions && detail.catalogId && !installedHere && !detail.cloudKey && (inMySkills(detail.catalogId) ? (
                    <button type="button" className="ua-pill ua-detail-copy" aria-label="In My skills. Remove from My skills"
                      title="Remove from My skills" disabled={additions.pending.includes(detail.catalogId)}
                      onClick={() => changeMySkills(detail.catalogId!, false)}>
                      <Check aria-hidden="true" />In My skills
                    </button>
                  ) : (
                    <button type="button" className="ua-pill ua-detail-copy" disabled={additions.pending.includes(detail.catalogId)}
                      onClick={() => changeMySkills(detail.catalogId!, true)}>
                      Add to My skills <Plus aria-hidden="true" />
                    </button>
                  ))}
                  {detail.installCommand ? (
                    <button type="button" className={onMac ? "ua-pill ua-detail-copy" : "ua-pill ua-primary"} aria-label="Copy install command" title="Copy install command" onClick={() => void copyInstall(detail)}>
                      Copy <Copy />
                    </button>
                  ) : !(onMac && signedIn && publicInstallAction && detail.catalogId) && !savedInstall && (
                    <span className="ua-pill">
                      {detail.installed?.isLocalOnly && <User aria-hidden="true" />}
                      {detail.setItemCloudShared ? cloudSharedLabel(detail, activeSet?.role)
                        : detail.cloudKey || detail.added ? "Not installed" : detail.catalogId || detail.setItemKind === "catalog" ? "Catalog skill" : detail.installed?.isLocalOnly ? "Personal skill" : "Source unavailable"}
                    </span>
                  )}
                  <span className="ua-detail-icons">
                  {(!readOnlyAccount || management) && signedIn && (detail.installed || detail.catalogId) && (
                    <>
                      <IconButton
                        label={
                          isFavorite(data, detail)
                            ? "Remove from favorites"
                            : "Add to favorites"
                        }
                        data-favorite={isFavorite(data, detail)}
                        disabled={!!management && !canManage}
                        onClick={() => management ? management.favorite(detail) : onFavorite(detail)}
                      >
                        <Heart />
                      </IconButton>
                      <IconButton
                        label="Add to set"
                        disabled={!!management && !canManage}
                        onClick={() => addToSet([detail])}
                      >
                        <ListPlus />
                      </IconButton>
                    </>
                  )}
                  {detail.catalogId && !detail.installed?.isLocalOnly && (
                    <IconButton label="Share skill" onClick={() => void share(detail)}>
                      <Share />
                    </IconButton>
                  )}
                  </span>
                  {cloud && !detail.setItemReleaseId && (detail.installed || detail.cloudKey) && <CloudStatusBadge row={cloudRow(detail)} notInstalled={!!detail.cloudKey} />}
                  {!signedIn && (
                    <button type="button" className="ua-pill ua-primary ua-detail-signin" onClick={signIn} data-humblytics="App Sign In">
                      Sign in to manage skills
                    </button>
                  )}
                </div>
                {!onMac && detail.installCommand && (
                  <p className="ua-muted ua-detail-copy-hint">
                    Paste in your terminal (macOS, Linux or WSL). <a className="ua-link" href="/developers/">Use with any agent (MCP)</a>
                  </p>
                )}
                {installOpen && selected && signedIn && (
                  <div className="ua-install-card">{publicInstallAction?.(selected, !detailPending)}</div>
                )}
                {management?.notice && <p className="ua-muted" role="status">{management.notice}</p>}
                </>}
                </div>
                <div className="ua-detail-body" role="region" aria-label="Skill content" tabIndex={0}>
                {panelPending ? (
                  <>
                    {publicStatus?.detail === "error" ? <>
                      <p role="status">{publicStatus.detailError}</p>
                      {!publicStatus.detailMissing && <button className="ua-pill" type="button" onClick={publicStatus.retryDetail}>Try again</button>}
                      {/* A skill that left the library can still leave My skills. */}
                      {publicStatus.detailMissing && signedIn && additions && inMySkills(detail?.catalogId) && (
                        <button className="ua-pill" type="button" disabled={additions.pending.includes(detail!.catalogId!)}
                          onClick={() => changeMySkills(detail!.catalogId!, false)}>Remove from My skills</button>
                      )}
                    </> : <div className="ua-detail-skeleton" role="status" aria-label="Loading skill">
                      <span /><span /><span /><span />
                    </div>}
                  </>
                ) : <>
                <div className="ua-description">
                  {(detailSummary && !descriptionOpen ? [detailSummary] : detailParagraphs.length ? detailParagraphs : ["No description available."]).map((paragraph, index) => (
                    <p key={index}><DescriptionParagraph text={paragraph} /></p>
                  ))}
                  {detailSummary && (
                    <button
                      type="button"
                      className="ua-link ua-description-toggle"
                      aria-expanded={descriptionOpen}
                      onClick={() => setDescriptionOpen(open => !open)}
                    >
                      {descriptionOpen ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
                {detail.installed && (
                  <section className="ua-detail-account">
                    <div>
                      <span>Installed on</span>
                      <AgentList sources={detail.installed.sources} />
                    </div>
                    {detailVersions.length > 1 && <div className="ua-detail-versions">
                      <span>{detailVersions.length} versions</span>
                      <strong>{detailVersions.map(sources => sources.join(", ")).join(" · ")}</strong>
                    </div>}
                    {detailVersions.length > 1 && detailLive && (!readOnlyAccount || management) && <button type="button"
                      className="ua-pill ua-detail-match" onClick={() => window.location.assign(matchVersionsLink(detailLive.name))}>
                      <RefreshCw />Make versions match
                    </button>}
                    {(!readOnlyAccount || management) && <div className="ua-set-chips">
                      {data.sets
                        .filter((set) => isMember(set, detail.installed!))
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
                    </div>}
                  </section>
                )}
                <SkillReadme skill={detail} />
                {detail.setItemReleaseId && sharedSkillMd
                  ? <SharedSkillReadme releaseId={detail.setItemReleaseId} load={sharedSkillMd} />
                  : savedSkillMd && <SavedSkillReadme skill={detail} load={savedSkillMd} />}
                {cloud && !detail.setItemReleaseId && detail.installed && <CloudStatusSection key={detail.key} row={cloudRow(detail)}
                  confirm={!readOnlyAccount || management ? cloud.confirm : undefined} />}
                {!detail.setItemReleaseId && savedVersions && <SavedVersionsList skill={detail}
                  liveName={!readOnlyAccount || management ? detailLive?.name : undefined} load={savedVersions} />}
                {detail.publicUrl && (
                  <a className="ua-link" href={detail.publicUrl} target="_blank" rel="noreferrer">
                    View public skill page <ArrowUpRight />
                  </a>
                )}
                {relatedSkills.length > 0 && (
                  <section className="ua-more">
                    <h3>More from @{detail.author}</h3>
                    {relatedSkills.map((skill) => (
                        <button
                          type="button"
                          key={skill.key}
                          onClick={() => open(skill)}
                        >
                          <Avatar src={skill.avatar} name={skill.author || skill.name} size="small" />
                          <span className="ua-more-copy">
                            <strong>{skill.name}</strong>
                            <small>{skill.description}</small>
                          </span>
                          <ChevronRight />
                        </button>
                      ))}
                  </section>
                )}
                {selectedInstallations.some(installation => inventorySummary(installation)) && (
                  <section className="ua-detail-history">
                    <button
                      type="button"
                      className="ua-link"
                      aria-expanded={historyOpen}
                      onClick={() => setHistoryOpen(open => !open)}
                    >
                      {historyOpen ? "Hide history" : "Show history"}
                    </button>
                    {historyOpen && selectedInstallations.map(installation => {
                      const inventory = inventorySummary(installation);
                      return inventory && <div key={installation.id} className="ua-installation">
                        <div><span>Mac / agent</span><strong>{inventory.location}</strong></div>
                        <p>{inventory.report}</p>
                        {inventory.latestReport && <p>{inventory.latestReport}</p>}
                        {installation.installationFolder && <div><span>Folder</span><strong>{installation.installationFolder}</strong></div>}
                      </div>;
                    })}
                  </section>
                )}
                </>}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>
      {management?.dialog(theme)}
      {!readOnlyAccount && dialog === "new-set" && (
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
      {!readOnlyAccount && dialog === "membership" && (
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
      {findByGithubLink && additions && dialog === "add-skill" && (
        <Modal title="Add skill" theme={theme} close={() => setDialog(null)}>
          <AddSkillForm additions={{ ...additions, findByGithubLink }} initialLink={addSkillLink} notify={setNotice} />
        </Modal>
      )}
      {!onSignIn && dialog === "signin" && (
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
