import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Dialog as PrimitiveDialog, DropdownMenu } from "radix-ui";
import {
  Bot,
  LayoutGrid,
  Layers,
  Menu,
  Plus,
  ChevronLeft,
  Copy,
  MoreHorizontal,
  EyeOff,
  Pencil,
  Trash2,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import {
  groupSyncedSkills,
  type GroupedSyncedSkill,
} from "../synced-skill-grouping";
import {
  type LoadState,
  type PortalActions,
  type PortalData,
  type PortalSet,
  type Visibility,
  visibilityLabels,
} from "./model";
import { parseRoute } from "./routes";
import {
  Action,
  Avatar,
  EmptyState,
  IconAction,
  Modal,
  TextInput,
  AgentTiles,
  SourceLink,
} from "./ui";
import { SkillsPage } from "./SkillsPage";
import { SetsPage, type LinkRenderer } from "./SetsPage";
import { SetDetailPage } from "./SetDetailPage";
import { AgentsPage, HomePage } from "./AccountPages";

type DialogState =
  | { kind: "new-set"; skills: GroupedSyncedSkill[] }
  | { kind: "edit-set"; set: PortalSet }
  | { kind: "profile" }
  | { kind: "inspect"; skill: GroupedSyncedSkill }
  | { kind: "add-skills"; set: PortalSet }
  | { kind: "message"; title: string; description: string }
  | {
      kind: "confirm";
      title: string;
      description: string;
      action: () => void;
      label: string;
    };

export function PortalApp({
  data,
  actions,
  state,
  base,
  previewBar,
  notice,
  notify,
  readOnly = false,
  renderDetail,
  accountControls,
  refreshControl,
  profileControls,
  setControls,
  detailSet,
  membership,
  onNavigate,
}: {
  data: PortalData;
  actions: PortalActions;
  state: LoadState;
  base: string;
  previewBar: ReactNode;
  notice: string;
  notify: (text: string) => void;
  readOnly?: boolean;
  renderDetail?: (groupId: string, edit: boolean) => ReactNode;
  accountControls?: import("./model").AccountControls;
  refreshControl?: ReactNode;
  profileControls?: import("./model").ProfileControls;
  setControls?: (page: string, groupId: string | undefined, navigate: (path: string) => void) => ReactNode;
  detailSet?: PortalSet | null;
  membership?: import("./model").MembershipControls;
  onNavigate?: () => void;
}) {
  const [locationKey, setLocationKey] = useState(
    location.pathname + location.search,
  );
  const [edit, setEdit] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [favoritesAcknowledged, setFavoritesAcknowledged] = useState(false);
  const route = parseRoute(location.pathname, location.search, base);
  const skills = useMemo(() => groupSyncedSkills(data.skills), [data.skills]);
  const activeSet = detailSet?.id === route.groupId ? detailSet : data.sets.find((set) => set.id === route.groupId);
  const sources = [...new Set(data.skills.map((skill) => skill.source))];
  const [pathname] = locationKey.split("?");
  useEffect(() => {
    const changed = () => setLocationKey(location.pathname + location.search);
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  useEffect(() => {
    setEdit(false);
    setDrawer(false);
    setDialog(null);
  }, [pathname]);
  const navigate = (path: string) => {
    onNavigate?.();
    history.pushState(null, "", base + path);
    setLocationKey(location.pathname + location.search);
    setDrawer(false);
  };
  const link: LinkRenderer = (path, children, className) => (
    <a
      className={className}
      href={base + path}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        navigate(path);
      }}
    >
      {children}
    </a>
  );
  const unavailable = (title: string, description: string) =>
    setDialog({ kind: "message", title, description });
  const newSet = (selected: GroupedSyncedSkill[] = []) =>
    setDialog({ kind: "new-set", skills: selected });
  const removeSet = (set: PortalSet) =>
    setDialog({
      kind: "confirm",
      title: `Delete ${set.name}?`,
      description: "This removes the sample set, not any installed skills.",
      label: "Delete set",
      action: () => {
        actions.deleteSet(set.id);
        if (route.page === "detail") navigate("sets");
      },
    });
  const star = (selected: GroupedSyncedSkill[], add: boolean) => {
    const perform = () => actions.membership("favorites", selected, add);
    if (add && !favoritesAcknowledged)
      setDialog({
        kind: "confirm",
        title: "Add to public Favorites?",
        description:
          "Favorites is a public set. Anyone with its link can view its published skills.",
        label: "Add to Favorites",
        action: () => {
          setFavoritesAcknowledged(true);
          perform();
        },
      });
    else perform();
  };
  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(
        new URL(base + path, location.origin).href,
      );
      notify("Local preview link copied");
    } catch {
      notify("Could not copy. Please try again.");
    }
  };
  const nav = (
    <>
      <div className="rd-logo" role="img" aria-label="omgskills">
        👀
      </div>
      <nav aria-label="Main navigation">
        {[
          {
            page: "skills",
            path: "",
            name: "Skills",
            icon: LayoutGrid,
            count: skills.length,
          },
          {
            page: "agents",
            path: "agents",
            name: "Agents",
            icon: Bot,
            count: sources.length,
          },
          {
            page: "sets",
            path: "sets",
            name: "Sets",
            icon: Layers,
            count: data.sets.length,
          },
        ].map((item) => (
          <div
            key={item.page}
            data-active={
              route.page === item.page ||
              (route.page === "detail" && item.page === "sets")
            }
          >
            {link(
              item.path,
              <>
                <item.icon />
                <span>{item.name}</span>
                <small>{item.count}</small>
              </>,
              "rd-nav-link",
            )}
          </div>
        ))}
      </nav>
      <div className="rd-home-link" data-active={route.page === "home"}>
        {link(
          "home",
          <>
            <Avatar name={data.profile.name} />
            <span>
              Home
              <small>
                {data.profile.handle ? `/${data.profile.handle}` : "No handle"}
              </small>
            </span>
          </>,
          "rd-nav-link",
        )}
      </div>
    </>
  );
  const title =
    route.page === "detail"
      ? activeSet?.name || (renderDetail ? "Set" : "Set not found")
      : (
          {
            skills: "Skills",
            agents: "Agents",
            sets: "Sets",
            home: "Home",
            missing: "Page not found",
          } as const
        )[route.page];
  const canEdit =
    (!readOnly || Boolean(membership)) &&
    state === "ready" &&
    (route.page === "skills" ||
      (!readOnly && route.page === "sets") ||
      (route.page === "detail" && activeSet?.role === "owner"));
  return (
    <div className="portal-design rd-root">
      {previewBar}
      <div className="rd-layout">
        <aside className="rd-sidebar">{nav}</aside>
        <main className="rd-main" id="main-content">
          <header className="rd-header">
            {route.page === "detail" ? (
              <IconAction
                label="Back to Sets"
                className="rd-mobile"
                onClick={() => navigate("sets")}
              >
                <ChevronLeft />
              </IconAction>
            ) : (
              <PrimitiveDialog.Root open={drawer} onOpenChange={setDrawer}>
                <PrimitiveDialog.Trigger asChild>
                  <IconAction label="Open navigation" className="rd-mobile">
                    <Menu />
                  </IconAction>
                </PrimitiveDialog.Trigger>
                <PrimitiveDialog.Portal>
                  <PrimitiveDialog.Overlay className="rd-overlay" />
                  <PrimitiveDialog.Content
                    className="portal-design rd-drawer"
                    aria-describedby={undefined}
                  >
                    <PrimitiveDialog.Title className="rd-sr-only">
                      Navigation
                    </PrimitiveDialog.Title>
                    <PrimitiveDialog.Close asChild>
                      <IconAction
                        label="Close navigation"
                        className="rd-drawer-close"
                      >
                        <X />
                      </IconAction>
                    </PrimitiveDialog.Close>
                    {nav}
                  </PrimitiveDialog.Content>
                </PrimitiveDialog.Portal>
              </PrimitiveDialog.Root>
            )}
            {route.page === "detail" && (
              <span className="rd-breadcrumb rd-desktop">
                {link("sets", "Sets")}
                <span>/</span>
              </span>
            )}
            <h1>{title}</h1>
            <div className="rd-header-actions">
              {refreshControl}
              {state === "ready" && setControls?.(route.page, route.groupId, navigate)}
              {route.page === "detail" && activeSet && !readOnly && (
                <>
                  {activeSet.role === "owner" && !activeSet.isFavorites && (
                    <select
                      aria-label="Set visibility"
                      value={activeSet.visibility}
                      onChange={(event) =>
                        actions.updateSet(activeSet.id, {
                          visibility: event.target.value as Visibility,
                        })
                      }
                    >
                      {Object.entries(visibilityLabels).map(
                        ([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  )}
                  <Action
                    onClick={() => void copy(`groups/${activeSet.id}`)}
                    aria-label="Copy set link"
                  >
                    <Copy data-icon="inline-start" />
                    <span className="rd-desktop">Copy link</span>
                  </Action>
                  {activeSet.role === "owner" && !activeSet.isFavorites && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <IconAction label="Set options">
                          <MoreHorizontal />
                        </IconAction>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="portal-design rd-menu"
                          align="end"
                          sideOffset={5}
                        >
                          <DropdownMenu.Group>
                            <DropdownMenu.Item
                              onSelect={() =>
                                setDialog({ kind: "edit-set", set: activeSet })
                              }
                            >
                              <Pencil />
                              Edit details
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              onSelect={() =>
                                actions.updateSet(activeSet.id, {
                                  hidden: !activeSet.hidden,
                                })
                              }
                            >
                              <EyeOff />
                              {activeSet.hidden ? "Restore" : "Hide"} set
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="rd-danger"
                              onSelect={() => removeSet(activeSet)}
                            >
                              <Trash2 />
                              Delete set
                            </DropdownMenu.Item>
                          </DropdownMenu.Group>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  )}
                </>
              )}
              {canEdit && (
                <Action disabled={membership && (membership.busy || membership.blocked)} onClick={() => setEdit((value) => !value)}>
                  {edit ? "Done" : "Edit"}
                </Action>
              )}
              {route.page === "agents" && (
                <Action
                  variant="default"
                  disabled={readOnly}
                  title={
                    readOnly
                      ? "Not connected in this read-only view"
                      : undefined
                  }
                  onClick={() =>
                    unavailable(
                      "Add agent",
                      "Independent agent connections are not available yet. You can view observed sources and manage device connections here.",
                    )
                  }
                >
                  <Plus data-icon="inline-start" />
                  Add agent
                </Action>
              )}
              {route.page === "sets" && state === "ready" && !readOnly && (
                <Action variant="default" onClick={() => newSet()}>
                  <Plus data-icon="inline-start" />
                  New set
                </Action>
              )}
            </div>
          </header>
          <div className="rd-content" data-page={route.page} key={pathname}>
            {state === "loading" ? (
              <div className="rd-loading" role="status">
                <RefreshCw className="rd-spin" />
                Loading your library...
              </div>
            ) : state === "error" ? (
              <EmptyState
                title="Couldn't load your library"
                description="Your saved skills haven't been changed."
              >
                <Action onClick={actions.retry}>
                  <RefreshCw data-icon="inline-start" />
                  Try again
                </Action>
              </EmptyState>
            ) : (
              <>
                {route.page === "skills" && (
                  <SkillsPage
                    readOnly={readOnly}
                    membership={membership ? { ...membership, create: async (chosen) => {
                      const origin = location.pathname;
                      const result = await membership.create(chosen);
                      if (result.groupId && location.pathname === origin) navigate(`groups/${result.groupId}`);
                      return result;
                    } } : undefined}
                    skills={skills}
                    sets={data.sets}
                    actions={actions}
                    source={route.source}
                    setSource={(source) =>
                      navigate(
                        source === "all"
                          ? ""
                          : `?source=${encodeURIComponent(source)}`,
                      )
                    }
                    edit={edit}
                    newSet={newSet}
                    star={star}
                    inspect={(skill) => setDialog({ kind: "inspect", skill })}
                  />
                )}
                {route.page === "sets" && (
                  <SetsPage
                    sets={data.sets}
                    edit={edit}
                    link={link}
                    remove={removeSet}
                  />
                )}
                {route.page === "agents" && (
                  <AgentsPage
                    readOnly={readOnly}
                    skills={skills}
                    data={data}
                    link={link}
                    unavailable={unavailable}
                    revoke={(device) =>
                      setDialog({
                        kind: "confirm",
                        title: `Revoke ${device.name}?`,
                        description:
                          "This changes the sample device only. Installed skills stay in place.",
                        label: "Revoke connection",
                        action: () => actions.revoke(device.id),
                      })
                    }
                  />
                )}
                {route.page === "home" && (
                  <HomePage
                    accountControls={accountControls}
                    profileControls={profileControls}
                    readOnly={readOnly}
                    data={data}
                    actions={actions}
                    editProfile={() => setDialog({ kind: "profile" })}
                    unavailable={unavailable}
                    copy={() => void copy("home")}
                  />
                )}
                {route.page === "detail" &&
                  renderDetail &&
                  route.groupId &&
                  renderDetail(route.groupId, edit)}
                {route.page === "detail" && activeSet && !renderDetail && (
                  <SetDetailPage
                    readOnly={readOnly}
                    set={activeSet}
                    sets={data.sets}
                    actions={actions}
                    edit={edit}
                    skills={skills}
                    addSkills={() =>
                      setDialog({ kind: "add-skills", set: activeSet })
                    }
                    notify={notify}
                    star={star}
                    newSet={newSet}
                  />
                )}
                {(route.page === "missing" ||
                  (route.page === "detail" && !activeSet && !renderDetail)) && (
                  <EmptyState title="Page not found">
                    <Action onClick={() => navigate("")}>Go to Skills</Action>
                  </EmptyState>
                )}
              </>
            )}
          </div>
        </main>
      </div>
      {notice && (
        <div role="status" className="rd-toast">
          {notice}
        </div>
      )}
      {dialog && (
        <AppDialog
          dialog={dialog}
          data={data}
          skills={skills}
          actions={actions}
          close={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function AppDialog({
  dialog,
  data,
  skills,
  actions,
  close,
}: {
  dialog: DialogState;
  data: PortalData;
  skills: GroupedSyncedSkill[];
  actions: PortalActions;
  close: () => void;
}) {
  const [name, setName] = useState(
    dialog.kind === "edit-set"
      ? dialog.set.name
      : dialog.kind === "profile"
        ? data.profile.handle
        : "",
  );
  const [description, setDescription] = useState(
    dialog.kind === "edit-set" ? dialog.set.description : "",
  );
  const [selected, setSelected] = useState<string[]>([]);
  if (dialog.kind === "message")
    return (
      <Modal
        title={dialog.title}
        description={dialog.description}
        close={close}
      >
        <div className="rd-dialog-footer">
          <Action onClick={close}>Done</Action>
        </div>
      </Modal>
    );
  if (dialog.kind === "confirm")
    return (
      <Modal
        title={dialog.title}
        description={dialog.description}
        close={close}
      >
        <div className="rd-dialog-footer">
          <Action onClick={close}>Cancel</Action>
          <Action
            variant={
              dialog.label === "Add to Favorites" ? "default" : "destructive"
            }
            onClick={() => {
              dialog.action();
              close();
            }}
          >
            {dialog.label}
          </Action>
        </div>
      </Modal>
    );
  if (dialog.kind === "inspect")
    return (
      <Modal
        title={dialog.skill.name}
        description={dialog.skill.description || "No description available."}
        close={close}
      >
        <AgentTiles sources={dialog.skill.sources} />
        <SourceLink url={dialog.skill.githubUrl} />
        <p className="rd-muted">
          {dialog.skill.allSkillIds.length} physical{" "}
          {dialog.skill.allSkillIds.length === 1 ? "install" : "installs"}
        </p>
        <div className="rd-dialog-footer">
          <Action onClick={close}>Done</Action>
        </div>
      </Modal>
    );
  if (dialog.kind === "add-skills")
    return (
      <Modal
        title="Add skills"
        description={`Choose skills for ${dialog.set.name}.`}
        close={close}
      >
        <div className="rd-skill-picker">
          {skills.map((skill) => (
            <label className="rd-check-row" key={skill.id}>
              <input
                type="checkbox"
                checked={selected.includes(skill.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, skill.id]
                      : current.filter((id) => id !== skill.id),
                  )
                }
              />
              <span>{skill.name}</span>
            </label>
          ))}
        </div>
        <div className="rd-dialog-footer">
          <Action onClick={close}>Cancel</Action>
          <Action
            variant="default"
            disabled={!selected.length}
            onClick={() => {
              actions.membership(
                dialog.set.id,
                skills.filter((skill) => selected.includes(skill.id)),
                true,
              );
              close();
            }}
          >
            Add skills
          </Action>
        </div>
      </Modal>
    );
  const title =
    dialog.kind === "new-set"
      ? "New set"
      : dialog.kind === "edit-set"
        ? "Edit set"
        : "Edit profile";
  return (
    <Modal
      title={title}
      description={
        dialog.kind === "new-set"
          ? "Group skills to share with people. New sets start as Only me."
          : undefined
      }
      close={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          if (dialog.kind === "new-set")
            actions.createSet(name.trim(), dialog.skills);
          if (dialog.kind === "edit-set")
            actions.updateSet(dialog.set.id, {
              name: name.trim(),
              description: description.trim(),
            });
          if (dialog.kind === "profile")
            actions.updateProfile({ handle: name.trim().toLowerCase() });
          close();
        }}
      >
        <label>
          {dialog.kind === "profile" ? "Handle" : "Name"}
          <TextInput
            required
            maxLength={dialog.kind === "profile" ? 39 : 120}
            pattern={dialog.kind === "profile" ? "[a-zA-Z0-9_-]+" : undefined}
            placeholder={
              dialog.kind === "new-set" ? "e.g. Marketing skills" : undefined
            }
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {dialog.kind === "edit-set" && (
          <label>
            Description
            <textarea
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        )}
        {dialog.kind === "new-set" && dialog.skills.length > 0 && (
          <p className="rd-muted">
            {dialog.skills.length} selected skills will be included.
          </p>
        )}
        {dialog.kind === "profile" && (
          <p className="rd-muted">
            Availability is not checked in the local preview.
          </p>
        )}
        <div className="rd-dialog-footer">
          <Action onClick={close}>Cancel</Action>
          <Action variant="default" type="submit" disabled={!name.trim()}>
            {dialog.kind === "new-set" ? "Create set" : "Save changes"}
          </Action>
        </div>
      </form>
    </Modal>
  );
}
