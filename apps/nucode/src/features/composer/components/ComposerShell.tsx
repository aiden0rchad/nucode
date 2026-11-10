import { IconButton } from "@/features/design-system/components/IconButton";
import { Squircle } from "@/features/design-system/components/squircle/Squircle";
import { ReasoningControl, type ReasoningControlProps } from "./ReasoningControl";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowUp, ChevronDown, Lock, LockOpen, Paperclip, ShieldCheck, Square } from "lucide-react";
import { useMenuController } from "@app/hooks/useMenuController";
import { AnchoredPopover } from "@/features/design-system/components/popover/AnchoredPopover";

export function ComposerShell({ children, menu, toolbar, controls, reasoning, actions, className = "" }: {
  children: ReactNode; menu?: ReactNode; toolbar?: ReactNode; controls?: ReactNode; reasoning?: ReasoningControlProps; actions: ReactNode; className?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const add = useMenuController({ popoverRef: popover, onDismiss: () => trigger.current?.focus() });
  useEffect(() => {
    if (add.isOpen) popover.current?.querySelector<HTMLButtonElement>(".composer-add-menu button:not(:disabled)")?.focus();
  }, [add.isOpen]);
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const input = root.current?.querySelector("textarea");
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 44), 260)}px`;
  });
  // Settings read left to right (model · effort · access); attach and send sit together on the right.
  return <Squircle className={`composer-shell ${className}`} ref={root}>
    {children}
    <div className="composer-shell-toolbar">
      <div className="composer-shell-left">{reasoning && <ReasoningControl {...reasoning} />}{controls}{toolbar}</div>
      <div className="composer-shell-actions">
      {menu && <div className="composer-add" ref={add.containerRef}>
        <IconButton ref={trigger} type="button" aria-haspopup="dialog" className="ghost" title="Add attachments and tools" aria-label="Add attachments and tools" aria-expanded={add.isOpen} onClick={add.toggle}><Paperclip aria-hidden /></IconButton>
        {add.isOpen && <AnchoredPopover anchorRef={trigger} surfaceRef={popover} role="dialog" aria-label="Attachments and tools" className="composer-add-menu" onClick={event => { if ((event.target as HTMLElement).closest("button")) { add.close(); trigger.current?.focus(); } }}>{menu}</AnchoredPopover>}
      </div>}
      {actions}</div>
    </div>
  </Squircle>;
}

export function ComposerSendButton({ running, disabled, disabledReason, onSend, onStop, label = "Send", runningHint }: {
  running?: boolean; disabled?: boolean; disabledReason: string; onSend: () => void; onStop?: () => void; label?: string; runningHint?: string;
}) {
  const title = running ? `Stop${runningHint ? " · " + runningHint : ""}` : disabled ? disabledReason : `${label} · Enter to send, Shift+Enter for a new line`;
  return <span title={title}><IconButton type="button" className={`composer-action ${running ? "is-stop" : "is-send"}`} aria-label={running ? "Stop" : label} title={title} disabled={!running && disabled} onClick={running ? onStop : onSend}>{running ? <Square aria-hidden /> : <ArrowUp aria-hidden />}</IconButton></span>;
}

export function ComposerAccessControl({ value, onChange, disabled, title, label }: { value: "ask" | "read-only" | "full-access"; onChange?: (value: "ask" | "read-only" | "full-access") => void; disabled?: boolean; title?: string; label?: string }) {
  const Icon = { ask: ShieldCheck, "read-only": Lock, "full-access": LockOpen }[value];
  const labels = { ask: "Ask first", "read-only": "Read-only", "full-access": "Full access" };
  const fixed = disabled || !onChange;
  // The visible label sizes the chip; the native select sits invisibly on top so keyboard and menus stay native.
  return <div className={`composer-chip composer-access-chip is-${value}${fixed ? " is-fixed" : ""}${disabled ? " is-disabled" : ""}`} title={title ?? `Access: ${labels[value]}`}><Icon size={16} aria-hidden /><span className="composer-access-label" aria-hidden>{label ?? labels[value]}</span><select aria-label="Access mode" value={value} disabled={fixed} onChange={event => { onChange?.(event.target.value as typeof value); event.currentTarget.blur(); }}>{(Object.keys(labels) as (keyof typeof labels)[]).map(key => <option key={key} value={key}>{labels[key]}</option>)}</select>{!fixed && <ChevronDown className="composer-access-chevron" size={14} aria-hidden />}</div>;
}
