import { useRef, type ComponentProps, type ReactNode } from "react";
import {
  Dialog as PrimitiveDialog,
  Popover,
  Switch as PrimitiveSwitch,
} from "radix-ui";
import { X, GitFork, SearchX } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { sourceLabel } from "./model";

export function Action({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn("rd-action", className)}
      {...props}
    />
  );
}
export function IconAction({
  label,
  ...props
}: ComponentProps<typeof Action> & { label: string }) {
  return (
    <Action
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      {...props}
    />
  );
}
export function TextInput(props: ComponentProps<typeof Input>) {
  return <Input {...props} className={cn("rd-input", props.className)} />;
}
export function StatusBadge({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="rd-badge">
      {children}
    </Badge>
  );
}
export function Avatar({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  const initials = name
    .split(/[ @.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={cn("rd-avatar", large && "rd-avatar-large")}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
export function SourceLink({ url }: { url: string | null }) {
  const label = sourceLabel(url);
  return label ? (
    <a className="rd-source" href={url!} target="_blank" rel="noreferrer">
      <GitFork />
      {label}
    </a>
  ) : (
    <span className="rd-muted">Local</span>
  );
}
export function AgentTiles({ sources }: { sources: string[] }) {
  return (
    <div className="rd-agent-tiles">
      {sources.map((source) => (
        <span
          key={source}
          className="rd-agent-tile"
          title={source}
          aria-label={source}
        >
          {source === "Codex" ? "O" : source[0]}
        </span>
      ))}
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <PrimitiveSwitch.Root
      className="rd-switch"
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      aria-label={label}
    >
      <PrimitiveSwitch.Thumb />
    </PrimitiveSwitch.Root>
  );
}
export function Modal({
  title,
  description,
  close,
  children,
}: {
  title: string;
  description?: string;
  close: () => void;
  children: ReactNode;
}) {
  const trigger = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <PrimitiveDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PrimitiveDialog.Portal>
        <PrimitiveDialog.Overlay className="rd-overlay" />
        <PrimitiveDialog.Content
          className="portal-design rd-dialog"
          {...(!description ? { "aria-describedby": undefined } : {})}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
          }}
        >
          <PrimitiveDialog.Title>{title}</PrimitiveDialog.Title>
          {description && (
            <PrimitiveDialog.Description>
              {description}
            </PrimitiveDialog.Description>
          )}
          <PrimitiveDialog.Close asChild>
            <IconAction label="Close" className="rd-dialog-close">
              <X />
            </IconAction>
          </PrimitiveDialog.Close>
          {children}
        </PrimitiveDialog.Content>
      </PrimitiveDialog.Portal>
    </PrimitiveDialog.Root>
  );
}
export function PanelPopover({
  trigger,
  children,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={label}
          className="portal-design rd-popover"
          align="end"
          sideOffset={5}
          collisionPadding={12}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rd-empty">
      <SearchX aria-hidden="true" />
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
