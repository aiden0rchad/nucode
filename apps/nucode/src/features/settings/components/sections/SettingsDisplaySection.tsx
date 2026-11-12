import { useSidebarDensity } from "../../hooks/useSidebarDensity";
import { SettingsFieldRow, SettingsGroup, SettingsPage, SettingsSelect, SettingsTextField, SettingsButton, SettingsToggleRow, SettingsToggleSwitch, SettingsSwitchRow } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { AppSettings } from "@/types";
import {
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_DEFAULT,
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@utils/fonts";

import {
  CHAT_SCROLLBACK_DEFAULT,
  CHAT_SCROLLBACK_MAX,
  CHAT_SCROLLBACK_MIN,
  CHAT_SCROLLBACK_PRESETS,
  clampChatScrollbackItems,
  isChatScrollbackPreset,
} from "@utils/chatScrollback";

type SettingsDisplaySectionProps = {
  appSettings: AppSettings;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  scaleDraft: string;
  uiFontDraft: string;
  codeFontDraft: string;
  codeFontSizeDraft: number;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onSetScaleDraft: Dispatch<SetStateAction<string>>;
  onCommitScale: () => Promise<void>;
  onResetScale: () => Promise<void>;
  onSetUiFontDraft: Dispatch<SetStateAction<string>>;
  onCommitUiFont: () => Promise<void>;
  onSetCodeFontDraft: Dispatch<SetStateAction<string>>;
  onCommitCodeFont: () => Promise<void>;
  onSetCodeFontSizeDraft: Dispatch<SetStateAction<number>>;
  onCommitCodeFontSize: (nextSize: number) => Promise<void>;
  onTestNotificationSound: () => void;
  onTestSystemNotification: () => void;
};

export function SettingsDisplaySection({
  appSettings,
  scaleShortcutTitle,
  scaleShortcutText,
  scaleDraft,
  uiFontDraft,
  codeFontDraft,
  codeFontSizeDraft,
  onUpdateAppSettings,
  onSetScaleDraft,
  onCommitScale,
  onResetScale,
  onSetUiFontDraft,
  onCommitUiFont,
  onSetCodeFontDraft,
  onCommitCodeFont,
  onSetCodeFontSizeDraft,
  onCommitCodeFontSize,
  onTestNotificationSound,
  onTestSystemNotification,
}: SettingsDisplaySectionProps) {
  const [density, setDensity] = useSidebarDensity();
  const scrollbackUnlimited = appSettings.chatHistoryScrollbackItems === null;
  const [scrollbackDraft, setScrollbackDraft] = useState(() => {
    const value = appSettings.chatHistoryScrollbackItems;
    return typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : String(CHAT_SCROLLBACK_DEFAULT);
  });

  useEffect(() => {
    const value = appSettings.chatHistoryScrollbackItems;
    if (typeof value === "number" && Number.isFinite(value)) {
      setScrollbackDraft(String(value));
    }
  }, [appSettings.chatHistoryScrollbackItems]);

  const scrollbackPresetValue = (() => {
    const value = appSettings.chatHistoryScrollbackItems;
    if (typeof value === "number" && isChatScrollbackPreset(value)) {
      return String(value);
    }
    return "custom";
  })();

  const commitScrollback = () => {
    if (scrollbackUnlimited) {
      return;
    }
    const trimmed = scrollbackDraft.trim();
    const parsed = trimmed ? Number(trimmed) : Number.NaN;
    if (!Number.isFinite(parsed)) {
      const current = appSettings.chatHistoryScrollbackItems;
      const fallback =
        typeof current === "number" && Number.isFinite(current)
          ? current
          : CHAT_SCROLLBACK_DEFAULT;
      setScrollbackDraft(String(fallback));
      return;
    }
    const nextValue = clampChatScrollbackItems(parsed);
    setScrollbackDraft(String(nextValue));
    if (appSettings.chatHistoryScrollbackItems === nextValue) {
      return;
    }
    void onUpdateAppSettings({
      ...appSettings,
      chatHistoryScrollbackItems: nextValue,
    });
  };

  const toggleUnlimitedScrollback = () => {
    const nextUnlimited = !scrollbackUnlimited;
    if (nextUnlimited) {
      void onUpdateAppSettings({
        ...appSettings,
        chatHistoryScrollbackItems: null,
      });
      return;
    }
    const trimmed = scrollbackDraft.trim();
    const parsed = trimmed ? Number(trimmed) : Number.NaN;
    const nextValue = Number.isFinite(parsed)
      ? clampChatScrollbackItems(parsed)
      : CHAT_SCROLLBACK_DEFAULT;
    setScrollbackDraft(String(nextValue));
    void onUpdateAppSettings({
      ...appSettings,
      chatHistoryScrollbackItems: nextValue,
    });
  };

  const selectScrollbackPreset = (rawValue: string) => {
    if (scrollbackUnlimited) {
      return;
    }
    if (rawValue === "custom") {
      return;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const nextValue = clampChatScrollbackItems(parsed);
    setScrollbackDraft(String(nextValue));
    void onUpdateAppSettings({
      ...appSettings,
      chatHistoryScrollbackItems: nextValue,
    });
  };

  const flip = (key: keyof AppSettings) => () => void onUpdateAppSettings({ ...appSettings, [key]: !appSettings[key] });
  const commitOnEnter = (commit: () => void) => (event: { key: string; preventDefault: () => void }) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };
  return (
    <SettingsPage title="Display & Sound" subtitle="Interface size and fonts, how much chat history to keep, and alerts.">
      <SettingsGroup title="Interface">
        <SettingsFieldRow title="Sidebar density">
          <SettingsSelect value={density} onChange={event => setDensity(event.target.value)}>
            <option value="compact">Compact (default)</option>
            <option value="comfortable">Comfortable</option>
          </SettingsSelect>
        </SettingsFieldRow>
        <SettingsToggleRow title="Interface scale" subtitle={<span title={scaleShortcutTitle}>{scaleShortcutText}</span>}>
          <div className="settings-field-actions">
            <SettingsButton type="button" className="ghost" onClick={() => { void onResetScale(); }}>Reset</SettingsButton>
            <SettingsTextField
              id="ui-scale"
              type="text"
              inputMode="decimal"
              className="settings-input--scale"
              value={scaleDraft}
              aria-label="Interface scale"
              onChange={(event) => onSetScaleDraft(event.target.value)}
              onBlur={() => { void onCommitScale(); }}
              onKeyDown={commitOnEnter(() => { void onCommitScale(); })}
            />
          </div>
        </SettingsToggleRow>
        <SettingsFieldRow stacked title="UI font family" subtitle="Used for all interface text. Leave empty for the system font.">
          <div className="settings-field-actions">
            <SettingsTextField
              type="text"
              className="is-fill is-mono"
              value={uiFontDraft}
              onChange={(event) => onSetUiFontDraft(event.target.value)}
              onBlur={() => { void onCommitUiFont(); }}
              onKeyDown={commitOnEnter(() => { void onCommitUiFont(); })}
            />
            <SettingsButton type="button" className="ghost" onClick={() => {
              onSetUiFontDraft(DEFAULT_UI_FONT_FAMILY);
              void onUpdateAppSettings({ ...appSettings, uiFontFamily: DEFAULT_UI_FONT_FAMILY });
            }}>Reset</SettingsButton>
          </div>
        </SettingsFieldRow>
        <SettingsFieldRow stacked title="Code font family" subtitle="Used for diffs and other monospaced text.">
          <div className="settings-field-actions">
            <SettingsTextField
              type="text"
              className="is-fill is-mono"
              value={codeFontDraft}
              onChange={(event) => onSetCodeFontDraft(event.target.value)}
              onBlur={() => { void onCommitCodeFont(); }}
              onKeyDown={commitOnEnter(() => { void onCommitCodeFont(); })}
            />
            <SettingsButton type="button" className="ghost" onClick={() => {
              onSetCodeFontDraft(DEFAULT_CODE_FONT_FAMILY);
              void onUpdateAppSettings({ ...appSettings, codeFontFamily: DEFAULT_CODE_FONT_FAMILY });
            }}>Reset</SettingsButton>
          </div>
        </SettingsFieldRow>
        <SettingsFieldRow title="Code font size" subtitle="Size of code and diff text.">
          <div className="settings-field-actions">
            <SettingsTextField
              type="range"
              min={CODE_FONT_SIZE_MIN}
              max={CODE_FONT_SIZE_MAX}
              step={1}
              className="settings-input--range"
              value={codeFontSizeDraft}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                onSetCodeFontSizeDraft(nextValue);
                void onCommitCodeFontSize(nextValue);
              }}
            />
            <div className="settings-scale-value">{codeFontSizeDraft}px</div>
            <SettingsButton type="button" className="ghost" onClick={() => {
              onSetCodeFontSizeDraft(CODE_FONT_SIZE_DEFAULT);
              void onCommitCodeFontSize(CODE_FONT_SIZE_DEFAULT);
            }}>Reset</SettingsButton>
          </div>
        </SettingsFieldRow>
      </SettingsGroup>
      <SettingsGroup title="Messages">
        <SettingsSwitchRow title="Show file path in messages" subtitle="Shows the parent folder next to file links." pressed={appSettings.showMessageFilePath} onClick={flip("showMessageFilePath")} />
        <SettingsSwitchRow title="Split chat and diff center panes" subtitle="Shows chat and diff side by side instead of switching between them." pressed={appSettings.splitChatDiffView} onClick={flip("splitChatDiffView")} />
        <SettingsSwitchRow title="Auto-generate new thread titles" subtitle="Names a thread from your first message. Uses a few extra tokens." pressed={appSettings.threadTitleAutogenerationEnabled} onClick={flip("threadTitleAutogenerationEnabled")} />
      </SettingsGroup>
      <SettingsGroup title="Chat history" subtitle="How many messages each thread keeps loaded.">
        <SettingsToggleRow title="Unlimited chat history" subtitle="Keeps the whole thread loaded. Long threads may slow the app down.">
          <SettingsToggleSwitch pressed={scrollbackUnlimited} onClick={toggleUnlimitedScrollback} data-scrollback-control="true" />
        </SettingsToggleRow>
        <SettingsFieldRow title="Scrollback preset" subtitle="Higher values keep more history and use more memory. Use Sync from server on a thread to fetch older messages." disabled={scrollbackUnlimited}>
          <SettingsSelect
            value={scrollbackPresetValue}
            onChange={(event) => selectScrollbackPreset(event.target.value)}
            data-scrollback-control="true"
            disabled={scrollbackUnlimited}
          >
            <option value="custom">Custom</option>
            {CHAT_SCROLLBACK_PRESETS.map((value) => (
              <option key={value} value={value}>{value === CHAT_SCROLLBACK_DEFAULT ? `${value} (Default)` : value}</option>
            ))}
          </SettingsSelect>
        </SettingsFieldRow>
        <SettingsFieldRow title="Max items per thread" subtitle={`From ${CHAT_SCROLLBACK_MIN} to ${CHAT_SCROLLBACK_MAX}. Counts messages, tool calls and other conversation items.`} disabled={scrollbackUnlimited}>
          <div className="settings-field-actions">
            <SettingsButton
              type="button"
              className="ghost"
              data-scrollback-control="true"
              disabled={scrollbackUnlimited}
              onClick={() => {
                setScrollbackDraft(String(CHAT_SCROLLBACK_DEFAULT));
                void onUpdateAppSettings({ ...appSettings, chatHistoryScrollbackItems: CHAT_SCROLLBACK_DEFAULT });
              }}
            >
              Reset
            </SettingsButton>
            <SettingsTextField
              type="text"
              inputMode="numeric"
              className="is-short"
              value={scrollbackDraft}
              disabled={scrollbackUnlimited}
              onChange={(event) => setScrollbackDraft(event.target.value)}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof HTMLElement && nextTarget.dataset.scrollbackControl === "true") return;
                commitScrollback();
              }}
              onKeyDown={commitOnEnter(commitScrollback)}
            />
          </div>
        </SettingsFieldRow>
      </SettingsGroup>
      <SettingsGroup
        title="Sounds & notifications"
        subtitle="Alerts when a long-running agent finishes while the window is unfocused."
        actions={<>
          <SettingsButton type="button" onClick={onTestNotificationSound}>Test sound</SettingsButton>
          <SettingsButton type="button" onClick={onTestSystemNotification}>Test notification</SettingsButton>
        </>}
      >
        <SettingsSwitchRow title="Notification sounds" subtitle="Plays a sound." pressed={appSettings.notificationSoundsEnabled} onClick={flip("notificationSoundsEnabled")} />
        <SettingsSwitchRow title="System notifications" subtitle="Shows a system notification." pressed={appSettings.systemNotificationsEnabled} onClick={flip("systemNotificationsEnabled")} />
        <SettingsSwitchRow title="Sub-agent notifications" subtitle="Also notifies when a spawned sub-agent thread finishes." pressed={appSettings.subagentSystemNotificationsEnabled} onClick={flip("subagentSystemNotificationsEnabled")} />
      </SettingsGroup>
    </SettingsPage>
  );
}
