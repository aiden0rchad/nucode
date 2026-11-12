import { SettingsButton, SettingsCallout, SettingsEmpty, SettingsGroup, SettingsIconButton, SettingsKeycaps, SettingsPage, SettingsRow, SettingsRowText, SettingsTextField } from "@/features/design-system/components/settings/SettingsPrimitives";
import Search from "lucide-react/dist/esm/icons/search";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import X from "lucide-react/dist/esm/icons/x";
import { useMemo, useState, type KeyboardEvent } from "react";
import { formatShortcut, getDefaultInterruptShortcut } from "@utils/shortcuts";
import { isMacPlatform } from "@utils/platformPaths";
import type {
  ShortcutDraftKey,
  ShortcutDrafts,
  ShortcutSettingKey,
} from "@settings/components/settingsTypes";

type ShortcutItem = {
  label: string;
  draftKey: ShortcutDraftKey;
  settingKey: ShortcutSettingKey;
  /** The raw default value, for example "cmd+n". */
  defaultValue: string;
  /** Extra words the search matches. */
  searchHint?: string;
};

type ShortcutGroup = {
  title: string;
  subtitle: string;
  items: ShortcutItem[];
};

type SettingsShortcutsSectionProps = {
  shortcutDrafts: ShortcutDrafts;
  onShortcutKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    key: ShortcutSettingKey,
  ) => void;
  onClearShortcut: (key: ShortcutSettingKey) => void;
  /** Sets a shortcut to a raw value; used to restore a default. */
  onSetShortcut?: (key: ShortcutSettingKey, value: string) => void;
};

const MODIFIER_GLYPHS = "⌃⌥⇧⌘";

/** One keycap per key: macOS glyphs are one character each, other platforms join keys with "+". */
export function shortcutKeys(label: string): string[] {
  const cap = (key: string) => key.length > 1 && /^[a-z]/.test(key) ? key[0].toUpperCase() + key.slice(1) : key;
  if (label.includes("+") && label.length > 1) return label.split("+").filter(Boolean).map(cap);
  const modifiers = [...label].filter((char, index) => MODIFIER_GLYPHS.includes(char) && [...label].slice(0, index).every(c => MODIFIER_GLYPHS.includes(c)));
  const rest = label.slice(modifiers.join("").length);
  return [...modifiers, ...(rest ? [cap(rest)] : [])];
}

function ShortcutRow({
  item,
  shortcutDrafts,
  onShortcutKeyDown,
  onClearShortcut,
  onSetShortcut,
}: {
  item: ShortcutItem;
  shortcutDrafts: ShortcutDrafts;
  onShortcutKeyDown: SettingsShortcutsSectionProps["onShortcutKeyDown"];
  onClearShortcut: (key: ShortcutSettingKey) => void;
  onSetShortcut?: SettingsShortcutsSectionProps["onSetShortcut"];
}) {
  const [recording, setRecording] = useState(false);
  const value = shortcutDrafts[item.draftKey];
  const label = formatShortcut(value);
  const defaultLabel = formatShortcut(item.defaultValue);
  const changed = formatShortcut(value) !== formatShortcut(item.defaultValue);
  return (
    <SettingsRow className="settings-shortcut-row">
      <SettingsRowText title={item.label} />
      <div className="settings-row-controls">
        {value && <SettingsIconButton className="settings-reveal" aria-label={`Clear ${item.label}`} title="Clear shortcut" onClick={() => onClearShortcut(item.settingKey)}><X aria-hidden /></SettingsIconButton>}
        {onSetShortcut && changed && <SettingsIconButton aria-label={`Reset ${item.label}`} title={`Reset to ${defaultLabel}`} onClick={() => onSetShortcut(item.settingKey, item.defaultValue)}><RotateCcw aria-hidden /></SettingsIconButton>}
        <span className={`settings-shortcut-editor${recording ? " is-recording" : ""}${changed ? " is-changed" : ""}`}>
          <SettingsTextField
            className="settings-input--shortcut"
            value={formatShortcut(value)}
            onKeyDown={(event) => onShortcutKeyDown(event, item.settingKey)}
            onFocus={() => setRecording(true)}
            onBlur={() => setRecording(false)}
            placeholder="Type shortcut"
            aria-label={item.label}
            title={`Click, then press the new keys (default ${defaultLabel})`}
            readOnly
          />
          <span aria-hidden="true">{recording ? <span className="settings-shortcut-placeholder is-recording">Press keys…</span> : value ? <SettingsKeycaps keys={shortcutKeys(label)} /> : <span className="settings-shortcut-placeholder">Not set</span>}</span>
        </span>
      </div>
    </SettingsRow>
  );
}

export function SettingsShortcutsSection({
  shortcutDrafts,
  onShortcutKeyDown,
  onClearShortcut,
  onSetShortcut,
}: SettingsShortcutsSectionProps) {
  const isMac = isMacPlatform();
  const [searchQuery, setSearchQuery] = useState("");

  const groups = useMemo<ShortcutGroup[]>(
    () => [
      {
        title: "File",
        subtitle: "Create agents and worktrees from the keyboard.",
        items: [
          {
            label: "New Agent",
            draftKey: "newAgent",
            settingKey: "newAgentShortcut",
            defaultValue: "cmd+n",
          },
          {
            label: "New Worktree Agent",
            draftKey: "newWorktreeAgent",
            settingKey: "newWorktreeAgentShortcut",
            defaultValue: "cmd+shift+n",
          },
          {
            label: "New Clone Agent",
            draftKey: "newCloneAgent",
            settingKey: "newCloneAgentShortcut",
            defaultValue: "cmd+alt+n",
          },
        ],
      },
      {
        title: "Threads",
        subtitle: "Act on the thread that is open.",
        items: [
          {
            label: "Rename thread",
            draftKey: "renameThread",
            settingKey: "renameThreadShortcut",
            defaultValue: isMac ? "cmd+alt+r" : "ctrl+alt+r",
          },
          {
            label: "Pin or unpin thread",
            draftKey: "pinThread",
            settingKey: "pinThreadShortcut",
            defaultValue: isMac ? "cmd+alt+p" : "ctrl+alt+p",
          },
          {
            label: "Mark thread as unread",
            draftKey: "markThreadUnread",
            settingKey: "markThreadUnreadShortcut",
            defaultValue: isMac ? "cmd+shift+u" : "ctrl+shift+u",
          },
          {
            label: "Archive thread",
            draftKey: "archiveThread",
            settingKey: "archiveThreadShortcut",
            defaultValue: isMac ? "cmd+ctrl+a" : "ctrl+alt+a",
            searchHint: "archive active thread",
          },
        ],
      },
      {
        title: "Composer",
        subtitle: "Cycle between model, access, reasoning, and collaboration modes.",
        items: [
          {
            label: "Cycle model",
            draftKey: "model",
            settingKey: "composerModelShortcut",
            defaultValue: "cmd+shift+m",
            searchHint: "press a new shortcut while focused",
          },
          {
            label: "Cycle access mode",
            draftKey: "access",
            settingKey: "composerAccessShortcut",
            defaultValue: "cmd+shift+a",
          },
          {
            label: "Cycle reasoning mode",
            draftKey: "reasoning",
            settingKey: "composerReasoningShortcut",
            defaultValue: "cmd+shift+r",
          },
          {
            label: "Cycle collaboration mode",
            draftKey: "collaboration",
            settingKey: "composerCollaborationShortcut",
            defaultValue: "shift+tab",
          },
          {
            label: "Stop active run",
            draftKey: "interrupt",
            settingKey: "interruptShortcut",
            defaultValue: getDefaultInterruptShortcut(),
          },
        ],
      },
      {
        title: "Panels",
        subtitle: "Toggle sidebars and panels.",
        items: [
          {
            label: "Toggle projects sidebar",
            draftKey: "projectsSidebar",
            settingKey: "toggleProjectsSidebarShortcut",
            defaultValue: "cmd+shift+p",
          },
          {
            label: "Toggle git sidebar",
            draftKey: "gitSidebar",
            settingKey: "toggleGitSidebarShortcut",
            defaultValue: "cmd+shift+g",
          },
          {
            label: "Branch switcher",
            draftKey: "branchSwitcher",
            settingKey: "branchSwitcherShortcut",
            defaultValue: "cmd+b",
          },
          {
            label: "Toggle debug panel",
            draftKey: "debugPanel",
            settingKey: "toggleDebugPanelShortcut",
            defaultValue: "cmd+shift+d",
          },
          {
            label: "Toggle terminal panel",
            draftKey: "terminal",
            settingKey: "toggleTerminalShortcut",
            defaultValue: "cmd+shift+t",
          },
        ],
      },
      {
        title: "Navigation",
        subtitle: "Cycle between agents and workspaces.",
        items: [
          {
            label: "Next agent",
            draftKey: "cycleAgentNext",
            settingKey: "cycleAgentNextShortcut",
            defaultValue: isMac ? "cmd+ctrl+down" : "ctrl+alt+down",
          },
          {
            label: "Previous agent",
            draftKey: "cycleAgentPrev",
            settingKey: "cycleAgentPrevShortcut",
            defaultValue: isMac ? "cmd+ctrl+up" : "ctrl+alt+up",
          },
          {
            label: "Next workspace",
            draftKey: "cycleWorkspaceNext",
            settingKey: "cycleWorkspaceNextShortcut",
            defaultValue: isMac ? "cmd+shift+down" : "ctrl+alt+shift+down",
          },
          {
            label: "Previous workspace",
            draftKey: "cycleWorkspacePrev",
            settingKey: "cycleWorkspacePrevShortcut",
            defaultValue: isMac ? "cmd+shift+up" : "ctrl+alt+shift+up",
          },
        ],
      },
    ],
    [isMac],
  );

  const [confirmReset, setConfirmReset] = useState(false);
  const changedItems = groups.flatMap(group => group.items).filter(item => formatShortcut(shortcutDrafts[item.draftKey]) !== formatShortcut(item.defaultValue));
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!normalizedSearchQuery) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const searchValue = `${group.title} ${group.subtitle} ${item.label} ${formatShortcut(item.defaultValue)} ${item.searchHint ?? ""}`.toLowerCase();
          return searchValue.includes(normalizedSearchQuery);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, normalizedSearchQuery]);

  return (
    <SettingsPage
      title="Shortcuts"
      subtitle="Click a shortcut, then press the keys you want. Backspace clears it."
    >
      <div className="settings-shortcuts-bar">
        <div className="settings-shortcuts-search">
          <Search aria-hidden />
          <SettingsTextField
            type="search"
            aria-label="Search shortcuts"
            placeholder="Search shortcuts"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        {onSetShortcut && <SettingsButton type="button" disabled={!changedItems.length} title={changedItems.length ? undefined : "Every shortcut is at its default"} onClick={() => setConfirmReset(true)}>Reset all…</SettingsButton>}
      </div>
      {confirmReset && onSetShortcut && (
        <SettingsCallout tone="warning" role="alertdialog" aria-label="Reset all shortcuts?" className="settings-shortcuts-confirm">
          Reset {changedItems.length} {changedItems.length === 1 ? "shortcut" : "shortcuts"} to the defaults?
          <div className="settings-callout-actions"><SettingsButton type="button" onClick={() => setConfirmReset(false)}>Cancel</SettingsButton><SettingsButton type="button" className="primary" onClick={() => { for (const item of changedItems) onSetShortcut(item.settingKey, item.defaultValue); setConfirmReset(false); }}>Reset all</SettingsButton></div>
        </SettingsCallout>
      )}
      {filteredGroups.map((group) => (
        <SettingsGroup key={group.title} title={group.title} subtitle={group.subtitle}>
          {group.items.map((item) => (
            <ShortcutRow
              key={item.settingKey}
              item={item}
              shortcutDrafts={shortcutDrafts}
              onShortcutKeyDown={onShortcutKeyDown}
              onClearShortcut={onClearShortcut}
              onSetShortcut={onSetShortcut}
            />
          ))}
        </SettingsGroup>
      ))}
      {filteredGroups.length === 0 && (
        <SettingsGroup><SettingsEmpty action={searchQuery ? <SettingsButton type="button" onClick={() => setSearchQuery("")}>Clear</SettingsButton> : undefined}>
          No shortcuts match {normalizedSearchQuery ? `"${searchQuery.trim()}"` : "your search"}.
        </SettingsEmpty></SettingsGroup>
      )}
    </SettingsPage>
  );
}
