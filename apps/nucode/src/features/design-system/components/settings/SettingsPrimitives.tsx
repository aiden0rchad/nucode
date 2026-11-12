import { Children, isValidElement, createContext, useContext, useId, useState, useRef, useEffect, useLayoutEffect, type CSSProperties, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PopoverSurface } from "../popover/PopoverPrimitives";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import Info from "lucide-react/dist/esm/icons/info";
const Disabled = createContext(false);
const ControlId = createContext<string | undefined>(undefined);
const ToggleLabel = createContext<string | undefined>(undefined);
import { joinClassNames } from "../classNames";
import { IconButton, type IconButtonProps } from "../IconButton";

export function SettingsIconButton({ disabled, ...props }: IconButtonProps) {
  const inherited = useContext(Disabled);
  return <IconButton {...props} disabled={disabled || inherited} />;
}

type SettingsSectionProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned on the title line (for example a page's primary action). */
  actions?: ReactNode;
  /** Embeds a wide tool (tables, logs): the column grows from 720px to 880px. */
  wide?: boolean;
  className?: string;
  children: ReactNode;
};

export function SettingsPage({
  title,
  subtitle,
  actions,
  wide = false,
  className,
  children,
}: SettingsSectionProps) {
  return (
    <section className={joinClassNames("settings-section settings-page", wide && "is-wide", className)}>
      <header className="settings-page-header">
        <div className="settings-page-heading">
          <h2 className="settings-section-title">{title}</h2>
          {subtitle ? <div className="settings-section-subtitle">{subtitle}</div> : null}
        </div>
        {actions ? <div className="settings-page-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A page whose settings form one untitled group: the page title is enough. */
export function SettingsSection({ children, ...props }: SettingsSectionProps) {
  return <SettingsPage {...props}><SettingsGroup>{children}</SettingsGroup></SettingsPage>;
}

export function SettingsGroup({ title, subtitle, children, actions, disabled = false, collapsible = false, className, ...props }: Omit<ComponentPropsWithoutRef<"div">, "title"> & { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; disabled?: boolean; collapsible?: boolean }) {
  const inherited = useContext(Disabled);
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const header = title || subtitle || actions;
  return <Disabled.Provider value={disabled || inherited}><div {...props} className={joinClassNames("settings-group", className)}>
    {header && <div className="settings-group-header">
      <div className="settings-group-heading">
        {title && <h3 className="settings-group-title">{collapsible ? <button type="button" className="settings-group-disclosure" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)}><ChevronRight size={14} aria-hidden />{title}</button> : title}</h3>}
        {subtitle && <p className="settings-group-description">{subtitle}</p>}
      </div>
      {actions && <div className="settings-group-actions">{actions}</div>}
    </div>}
    <div id={contentId} className="settings-group-card" aria-disabled={disabled || inherited || undefined} hidden={collapsible && !expanded}>{children}</div>
  </div></Disabled.Provider>;
}

/** The one row recipe: text on the left, the control on the right. `stacked` puts the control under the text. */
export function SettingsRow({ children, className, stacked = false, ...props }: ComponentPropsWithoutRef<"div"> & { stacked?: boolean }) {
  return <div {...props} className={joinClassNames("settings-row", stacked && "is-stacked", className)}>{children}</div>;
}

/** Label and description of a row. */
export function SettingsRowText({ title, subtitle, titleId, className }: { title: ReactNode; subtitle?: ReactNode; titleId?: string; className?: string }) {
  return <div className={joinClassNames("settings-row-text", className)}>
    <div id={titleId} className="settings-toggle-title">{title}</div>
    {subtitle ? <div className="settings-toggle-subtitle">{subtitle}</div> : null}
  </div>;
}

export function SettingsSelect({ children, className, onChange, value, defaultValue, disabled, multiple, ...props }: ComponentPropsWithoutRef<"select">) {
  const inherited = useContext(Disabled);
  const id = useContext(ControlId);
  const [selected, setSelected] = useState(defaultValue);
  const anchor = useRef<HTMLSelectElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: 0, top: 0, width: 320, maxHeight: 300 });
  const options: { value: string; label: ReactNode; description?: string; recommended?: boolean; disabled?: boolean }[] = [];
  const collect = (nodes: ReactNode) => Children.forEach(nodes, node => {
    if (!isValidElement<{ value?: string; children?: ReactNode; label?: string; disabled?: boolean; "data-description"?: string; "data-recommended"?: boolean }>(node)) return;
    if (node.type === "option") options.push({ value: String(node.props.value ?? node.props.children ?? ""), label: node.props.label ?? node.props.children, description: node.props["data-description"], recommended: node.props["data-recommended"], disabled: node.props.disabled });
    else collect(node.props.children);
  });
  collect(children);
  const selectedIndex = options.findIndex(option => option.value === String(value ?? selected ?? options[0]?.value));
  const option = options[selectedIndex];
  const text = (nodes: ReactNode): string => Children.toArray(nodes).map(node => isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : String(node)).join("");
  const open = active !== null && !disabled && !inherited;
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" }); }, [active, listId, open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const height = Math.min(320, Math.max(rect.top - 16, window.innerHeight - rect.bottom - 16));
      const width = Math.min(Math.max(rect.width, 360), window.innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), ...(window.innerHeight - rect.bottom >= height ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }), width, maxHeight: height });
    };
    const dismiss = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setActive(null); };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", dismiss);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", dismiss); };
  }, [open]);
  const choose = (index: number) => {
    if (!anchor.current || options[index]?.disabled) return;
    anchor.current.value = options[index].value;
    anchor.current.dispatchEvent(new Event("change", { bubbles: true }));
    setActive(null);
    anchor.current.focus();
  };
  const longest = options.map(item => text(item.label)).reduce((a, b) => b.length > a.length ? b : a, "");
  return <span className={joinClassNames("settings-select-control", multiple && "is-multiple")} data-longest={multiple ? undefined : longest}>
    {!multiple && <span className="settings-select-value" aria-hidden="true"><span className="settings-select-label">{option?.label}</span><ChevronRight className="settings-select-chevron" size={14} /></span>}
    <select id={id} {...props} ref={anchor} title={[text(option?.label), option?.recommended && "Recommended", option?.description].filter(Boolean).join(" — ")} aria-expanded={multiple ? undefined : open} aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${listId}-${active}` : undefined} className={joinClassNames("settings-select", className)} value={value} defaultValue={defaultValue} multiple={multiple} disabled={disabled || inherited}
      onMouseDown={event => { if (!multiple) { event.preventDefault(); anchor.current?.focus(); setActive(open ? null : Math.max(0, selectedIndex)); } }}
      onBlur={() => setActive(null)}
      onKeyDown={event => {
        if (multiple) return;
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setActive(null); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const enabled = options.map((item, index) => item.disabled ? -1 : index).filter(index => index >= 0);
          const current = enabled.indexOf(active ?? selectedIndex);
          setActive(enabled[event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length] ?? null);
        } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) choose(active!); else setActive(Math.max(0, selectedIndex)); }
      }} onChange={event => { setSelected(event.target.value); setActive(null); onChange?.(event); }}>{children}</select>
    {open && createPortal(<PopoverSurface ref={list} id={listId} role="listbox" aria-label={props["aria-label"] ?? anchor.current?.labels?.[0]?.textContent ?? "Options"} className="settings-select-options" style={{ position: "fixed", ...position, zIndex: anchor.current?.closest(".ds-modal") ? "var(--z-tooltip)" : "var(--z-popover)" }} onMouseDown={event => event.preventDefault()}>{options.map((item, index) => <div key={item.value} id={`${listId}-${index}`} role="option" aria-selected={index === selectedIndex} aria-disabled={item.disabled || undefined} data-active={index === active} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}><span>{item.label}{item.recommended && <small className="settings-option-pill">Recommended</small>}</span>{item.description && <small className="settings-option-description">{item.description}</small>}</div>)}</PopoverSurface>, document.body)}
  </span>;
}

/** `identifier` is for exact values such as IDs, slugs, commands and variable names: macOS
 * would otherwise capitalize or correct them (a role named "scout" became "Scout"). */
export function SettingsTextField({ className, disabled, identifier, ...props }: ComponentPropsWithoutRef<"input"> & { identifier?: boolean }) {
  const inherited = useContext(Disabled);
  const id = useContext(ControlId);
  const exact = identifier ? { autoCapitalize: "off", autoCorrect: "off", spellCheck: false } : {};
  return <input id={id} {...exact} {...props} disabled={disabled || inherited} className={joinClassNames("settings-input", className)} />;
}
export function SettingsTextArea({ className, disabled, ...props }: ComponentPropsWithoutRef<"textarea">) {
  const inherited = useContext(Disabled);
  const id = useContext(ControlId);
  return <textarea id={id} {...props} disabled={disabled || inherited} className={joinClassNames("settings-textarea", className)} />;
}
export function SettingsButton({ className, disabled, type = "button", ...props }: ComponentPropsWithoutRef<"button">) {
  const inherited = useContext(Disabled);
  return <button {...props} type={type} disabled={disabled || inherited} className={joinClassNames("settings-button", className)} />;
}
export function SettingsNumberStepper(props: ComponentPropsWithoutRef<"input">) {
  return <SettingsTextField {...props} type="number" />;
}
export function SettingsSegmented({ label, value, options, onChange, tabs = false }: { label: string; value: string; options: { value: string; label: string; disabled?: boolean }[]; onChange: (value: string) => void; tabs?: boolean }) {
  return <div className="settings-segmented" role={tabs ? "tablist" : "group"} aria-label={label} onKeyDown={event => {
    if (!tabs || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = options.filter(option => !option.disabled);
    const index = enabled.findIndex(option => option.value === value);
    const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
    onChange(enabled[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")[next]?.focus();
  }}>{options.map(option => <SettingsButton key={option.value} role={tabs ? "tab" : undefined} tabIndex={tabs && value !== option.value ? -1 : 0} className="settings-segmented-option" aria-selected={tabs ? value === option.value : undefined} aria-pressed={tabs ? undefined : value === option.value} disabled={option.disabled} onClick={() => onChange(option.value)}>{option.label}</SettingsButton>)}</div>;
}

type SettingsSubsectionProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
};

export function SettingsSubsection({ title, subtitle, className }: SettingsSubsectionProps) {
  return (
    <div className={className}>
      <div className="settings-subsection-title">{title}</div>
      {subtitle ? <div className="settings-subsection-subtitle">{subtitle}</div> : null}
    </div>
  );
}

type SettingsToggleRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  /** Dependent rows are disabled, not hidden. */
  disabled?: boolean;
  children: ReactNode;
};

export function SettingsToggleRow({
  title,
  subtitle,
  className,
  disabled = false,
  children,
}: SettingsToggleRowProps) {
  const labelId = useId();
  const inherited = useContext(Disabled);
  return (
    <Disabled.Provider value={disabled || inherited}>
    <ToggleLabel.Provider value={labelId}>
    <SettingsRow className={joinClassNames("settings-toggle-row", (disabled || inherited) && "is-disabled", className)}>
      <SettingsRowText title={title} subtitle={subtitle} titleId={labelId} />
      {children}
    </SettingsRow></ToggleLabel.Provider></Disabled.Provider>
  );
}

/** A row with one switch: the most common setting. */
export function SettingsSwitchRow({ title, subtitle, pressed, onClick, disabled, className, switchProps }: { title: ReactNode; subtitle?: ReactNode; pressed: boolean; onClick: () => void; disabled?: boolean; className?: string; switchProps?: Omit<ComponentPropsWithoutRef<"button">, "onClick" | "type" | "children" | "className" | "aria-pressed"> }) {
  return <SettingsToggleRow title={title} subtitle={subtitle} disabled={disabled} className={className}><SettingsToggleSwitch {...switchProps} pressed={pressed} onClick={onClick} /></SettingsToggleRow>;
}

type SettingsToggleSwitchProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "type" | "children" | "className" | "aria-pressed"
> & {
  pressed: boolean;
  className?: string;
};

export function SettingsToggleSwitch({
  pressed,
  className,
  ...props
}: SettingsToggleSwitchProps) {
  const labelId = useContext(ToggleLabel);
  const disabled = useContext(Disabled);
  return (
    <button
      type="button"
      className={joinClassNames("settings-toggle", pressed && "on", className)}
      aria-pressed={pressed}
      aria-labelledby={props["aria-label"] ? undefined : labelId}
      {...props}
      disabled={disabled || props.disabled}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

export function SettingsFieldRow({ title, subtitle, help, children, className, stacked = false, disabled = false, ...props }: Omit<ComponentPropsWithoutRef<"label">, "title"> & { title: ReactNode; subtitle?: ReactNode; help?: ReactNode; stacked?: boolean; disabled?: boolean }) {
  const generatedId = useId();
  const id = props.htmlFor ?? generatedId;
  const inherited = useContext(Disabled);
  return <Disabled.Provider value={disabled || inherited}><SettingsRow className={joinClassNames("settings-control-row", (disabled || inherited) && "is-disabled")}><div className={joinClassNames("settings-field-row", stacked && "settings-field-row-long", className)}><div className="settings-field-info"><label {...props} htmlFor={id} className="settings-toggle-title">{title}</label>{subtitle && <span className="settings-toggle-subtitle">{subtitle}</span>}{help && <span className="settings-toggle-subtitle">{help}</span>}</div><ControlId.Provider value={id}>{children}</ControlId.Provider></div></SettingsRow></Disabled.Provider>;
}

type Tone = "info" | "warning" | "error";
/** Only for something that needs attention: a warning, an error or a required next step. */
export function SettingsCallout({ tone = "warning", children, className, ...props }: ComponentPropsWithoutRef<"div"> & { tone?: Tone }) {
  const Icon = tone === "info" ? Info : tone === "error" ? CircleAlert : TriangleAlert;
  return <div role={tone === "error" ? "alert" : "status"} {...props} className={joinClassNames("settings-callout", `is-${tone}`, className)}><Icon size={16} aria-hidden /><div>{children}</div></div>;
}

/** One small dot plus a short text: "Ready · v1.4.0", "Not tested", "Stopped". */
export function SettingsStatus({ tone = "idle", children, className, ...props }: ComponentPropsWithoutRef<"span"> & { tone?: "ready" | "idle" | "busy" | "warning" | "error" }) {
  return <span {...props} className={joinClassNames("settings-status", `is-${tone}`, className)}><span className="settings-status-dot" aria-hidden />{children}</span>;
}

/** A list row for engines, providers, connectors, projects and apps. */
export function SettingsListRow({ icon, title, badge, meta, children, className, ...props }: Omit<ComponentPropsWithoutRef<"div">, "title"> & { icon?: ReactNode; title: ReactNode; badge?: ReactNode; meta?: ReactNode }) {
  return <div {...props} className={joinClassNames("settings-row settings-list-row", className)}>
    <div className="settings-list-identity">
      {icon ? <span className="settings-list-icon" aria-hidden>{icon}</span> : null}
      <div className="settings-list-copy">
        <div className="settings-list-name"><span className="settings-list-title">{title}</span>{badge}</div>
        {meta ? <div className="settings-list-meta">{meta}</div> : null}
      </div>
    </div>
    {children ? <div className="settings-list-actions">{children}</div> : null}
  </div>;
}

export function SettingsBadge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={joinClassNames("settings-badge", className)}>{children}</span>;
}

/** Empty list: one calm sentence and (optionally) one secondary action. */
export function SettingsEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="settings-empty-state"><p>{children}</p>{action}</div>;
}

/** A shortcut as one keycap per key. */
export function SettingsKeycaps({ keys, className }: { keys: string[]; className?: string }) {
  return <span className={joinClassNames("settings-keycaps", className)}>{keys.map((key, index) => <kbd key={`${key}-${index}`} className="settings-keycap">{key}</kbd>)}</span>;
}
