import { useFeatures } from "@settings/features";
import { Fragment, useEffect, useRef, useState } from "react";
import { FlaskConical, Activity, KeyRound, Bot, Plug, SquarePen, Palette, Monitor, Keyboard, Mic, GitBranch, AppWindow, Folder, Box, Globe, MousePointer2, Server, Download, Info, SlidersHorizontal, Flag, Workflow } from "lucide-react";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Search from "lucide-react/dist/esm/icons/search";
import type { CodexSection } from "./settingsTypes";
import { SETTINGS_SECTION_LABELS } from "./settingsViewConstants";
export const SETTINGS_GROUPS: { label: string; sections: CodexSection[] }[] = [
  { label: "General", sections: ["appearance", "display", "composer", "shortcuts", "dictation", "features"] },
  { label: "Models", sections: ["providers", "agents", "engines", "connectors"] },
  { label: "Projects", sections: ["projects", "environments", "git", "open-apps"] },
  { label: "Tools", sections: ["browser", "computer"] },
  { label: "Advanced", sections: ["codex-flags", "server", "evals", "diagnostics", "import", "about"] },
];
export const SETTINGS_ICONS = { evals: FlaskConical, diagnostics: Activity, features: SlidersHorizontal, engines: Workflow, "codex-flags": Flag, "providers": KeyRound, "agents": Bot, "connectors": Plug, "composer": SquarePen, "appearance": Palette, "display": Monitor, "shortcuts": Keyboard, "dictation": Mic, "git": GitBranch, "open-apps": AppWindow, "projects": Folder, "environments": Box, "browser": Globe, "computer": MousePointer2, "server": Server, "import": Download, "about": Info };
export function SettingsNav({ activeSection, onSelectSection, showDisclosure = false }: { activeSection: CodexSection; onSelectSection: (section: CodexSection) => void; showDisclosure?: boolean }) {
  const features = useFeatures();
  const [query, setQuery] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const root = useRef<HTMLElement>(null);
  // The active item scrolls fully into view inside the list; the search field stays pinned above it.
  useEffect(() => {
    const list = root.current?.querySelector<HTMLElement>(".settings-nav-list");
    root.current?.querySelector<HTMLElement>(".is-active")?.scrollIntoView?.({ block: "nearest" });
    // Never leave a group label half-cut under the search field.
    if (list) for (const label of list.querySelectorAll<HTMLElement>(".settings-nav-group")) {
      const top = label.getBoundingClientRect().top - list.getBoundingClientRect().top;
      if (top < 0 && top + label.offsetHeight > 0) list.scrollTop = Math.max(0, list.scrollTop + top - 6);
    }
  }, [activeSection]);
  const search = query.trim().toLocaleLowerCase();
  const visible = (section: CodexSection) => (({ git: features.git, browser: features.browser, computer: features.computerUse, connectors: features.connectors, import: features.importTools, dictation: features.dictation } as Record<string, boolean>)[section] ?? true);
  const groups = SETTINGS_GROUPS.map(group => ({ ...group, sections: group.sections.filter(section => visible(section) && `${group.label} ${SETTINGS_SECTION_LABELS[section]}`.toLocaleLowerCase().includes(search)) })).filter(group => group.sections.length);
  return <aside className="settings-sidebar" ref={root}>
    <label className="settings-nav-search"><Search aria-hidden /><input type="search" aria-label="Find settings section" placeholder="Find a section…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); } }} /></label>
    {!groups.length && <p className="settings-nav-empty" role="status">No matching sections</p>}
    <div className={`settings-nav-scroll${scrolled ? " is-scrolled" : ""}`}><nav className="settings-nav-list" aria-label="Settings sections" onScroll={event => setScrolled(event.currentTarget.scrollTop > 0)}>{groups.map(group => <Fragment key={group.label}><h2 className="settings-nav-group">{group.label}</h2>{group.sections.map(section => { const Icon = SETTINGS_ICONS[section as keyof typeof SETTINGS_ICONS]; const active = activeSection === section; return <button key={section} type="button" className={`settings-nav${active ? " is-active" : ""}`} title={SETTINGS_SECTION_LABELS[section]} aria-current={active ? "page" : undefined} onClick={() => onSelectSection(section)}><Icon aria-hidden /><span className="settings-nav-label">{SETTINGS_SECTION_LABELS[section]}</span>{showDisclosure && <ChevronRight className="settings-nav-disclosure" aria-hidden />}</button>; })}</Fragment>)}</nav></div>
  </aside>;
}
