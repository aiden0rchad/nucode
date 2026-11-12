import { SettingsIconButton } from "@/features/design-system/components/settings/SettingsPrimitives";
import { SettingsGroup, SettingsPage, SettingsRow, SettingsTextField, SettingsSelect, SettingsButton, SettingsStatus, SettingsToggleRow, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Plus from "lucide-react/dist/esm/icons/plus";
import type { OpenAppTarget } from "@/types";
import {
  fileManagerName,
  isMacPlatform,
} from "@utils/platformPaths";
import {
  GENERIC_APP_ICON,
  getKnownOpenAppIcon,
} from "@app/utils/openAppIcons";
import type { OpenAppDraft } from "@settings/components/settingsTypes";

type SettingsOpenAppsSectionProps = {
  openAppDrafts: OpenAppDraft[];
  openAppSelectedId: string;
  openAppIconById: Record<string, string>;
  onOpenAppDraftChange: (index: number, updates: Partial<OpenAppDraft>) => void;
  onOpenAppKindChange: (index: number, kind: OpenAppTarget["kind"]) => void;
  onCommitOpenApps: () => void;
  onMoveOpenApp: (index: number, direction: "up" | "down") => void;
  onDeleteOpenApp: (index: number) => void;
  onAddOpenApp: () => void;
  onSelectOpenAppDefault: (id: string) => void;
  showOpenInEditor?: boolean;
  onShowOpenInEditorChange?: (show: boolean) => void;
};

const isOpenAppLabelValid = (label: string) => label.trim().length > 0;

export function SettingsOpenAppsSection({
  openAppDrafts,
  openAppSelectedId,
  openAppIconById,
  onOpenAppDraftChange,
  onOpenAppKindChange,
  onCommitOpenApps,
  onMoveOpenApp,
  onDeleteOpenApp,
  onAddOpenApp,
  onSelectOpenAppDefault,
  showOpenInEditor = false,
  onShowOpenInEditorChange,
}: SettingsOpenAppsSectionProps) {
  return (
    <SettingsPage
      title="Open in apps"
      subtitle="The apps offered by the Open in menu in the title bar and in file previews."
    >
      {onShowOpenInEditorChange && (
        <SettingsGroup>
          <SettingsToggleRow title="Show in the title bar" subtitle="Adds an Open in button to each thread's title bar. File previews always offer it.">
            <SettingsToggleSwitch aria-label="Show Open in button in the title bar" pressed={showOpenInEditor} onClick={() => onShowOpenInEditorChange(!showOpenInEditor)} />
          </SettingsToggleRow>
        </SettingsGroup>
      )}
      <SettingsGroup
        title="Apps"
        subtitle={<>The Default app opens when you click Open in. A command receives the selected path as its last argument. {isMacPlatform() ? "An app is started with open -a and your optional arguments." : "An app is started as an executable with your optional arguments."}</>}
        actions={<SettingsButton type="button" onClick={onAddOpenApp}><Plus aria-hidden />Add app</SettingsButton>}
      >
        {openAppDrafts.map((target, index) => {
          const iconSrc = getKnownOpenAppIcon(target.id) ?? openAppIconById[target.id] ?? GENERIC_APP_ICON;
          const labelValid = isOpenAppLabelValid(target.label);
          const appNameValid = target.kind !== "app" || Boolean(target.appName?.trim());
          const commandValid = target.kind !== "command" || Boolean(target.command?.trim());
          const isComplete = labelValid && appNameValid && commandValid;
          const incompleteHint = !labelValid
            ? "Label required"
            : target.kind === "app"
              ? "App name required"
              : target.kind === "command"
                ? "Command required"
                : "Complete required fields";
          return (
            <div key={target.id} className="settings-open-app">
              <SettingsRow className="settings-list-row">
                <div className="settings-list-identity">
                  <span className="settings-list-icon" aria-hidden>
                    <img className="settings-open-app-icon" src={iconSrc} alt="" width={18} height={18} />
                  </span>
                  <label className="settings-open-app-field">
                    <span className="settings-visually-hidden">Label</span>
                    <SettingsTextField
                      className="settings-open-app-input--label"
                      value={target.label}
                      placeholder="Label"
                      onChange={(event) => onOpenAppDraftChange(index, { label: event.target.value })}
                      onBlur={onCommitOpenApps}
                      aria-label={`Open app label ${index + 1}`}
                      data-invalid={!labelValid || undefined}
                    />
                  </label>
                  {!isComplete && <SettingsStatus tone="error" title={incompleteHint} aria-label={incompleteHint}>Incomplete</SettingsStatus>}
                </div>
                <div className="settings-list-actions">
                  <SettingsButton className="settings-open-app-default" aria-pressed={target.id === openAppSelectedId}
                    onClick={() => onSelectOpenAppDefault(target.id)} disabled={!isComplete}>Default</SettingsButton>
                  <SettingsIconButton className="settings-reveal" aria-label="Move up" title="Move up" onClick={() => onMoveOpenApp(index, "up")} disabled={index === 0}><ChevronUp aria-hidden /></SettingsIconButton>
                  <SettingsIconButton className="settings-reveal" aria-label="Move down" title="Move down" onClick={() => onMoveOpenApp(index, "down")} disabled={index === openAppDrafts.length - 1}><ChevronDown aria-hidden /></SettingsIconButton>
                  <SettingsIconButton className="is-danger" aria-label="Remove app" title="Remove app" onClick={() => onDeleteOpenApp(index)} disabled={openAppDrafts.length <= 1}><Trash2 aria-hidden /></SettingsIconButton>
                </div>
              </SettingsRow>
              <div className="settings-open-app-fields">
                <label className="settings-open-app-field">
                  <span className="settings-visually-hidden">Type</span>
                  <SettingsSelect
                    value={target.kind}
                    onChange={(event) => onOpenAppKindChange(index, event.target.value as OpenAppTarget["kind"])}
                    aria-label={`Open app type ${index + 1}`}
                  >
                    <option value="app">App</option>
                    <option value="command">Command</option>
                    <option value="finder">{fileManagerName()}</option>
                  </SettingsSelect>
                </label>
                {target.kind === "app" && (
                  <label className="settings-open-app-field">
                    <span className="settings-visually-hidden">App name</span>
                    <SettingsTextField
                      value={target.appName ?? ""}
                      placeholder="App name"
                      onChange={(event) => onOpenAppDraftChange(index, { appName: event.target.value })}
                      onBlur={onCommitOpenApps}
                      aria-label={`Open app name ${index + 1}`}
                      data-invalid={!appNameValid || undefined}
                    />
                  </label>
                )}
                {target.kind === "command" && (
                  <label className="settings-open-app-field">
                    <span className="settings-visually-hidden">Command</span>
                    <SettingsTextField
                      identifier
                      className="is-mono"
                      value={target.command ?? ""}
                      placeholder="Command"
                      onChange={(event) => onOpenAppDraftChange(index, { command: event.target.value })}
                      onBlur={onCommitOpenApps}
                      aria-label={`Open app command ${index + 1}`}
                      data-invalid={!commandValid || undefined}
                    />
                  </label>
                )}
                {target.kind !== "finder" && (
                  <label className="settings-open-app-field">
                    <span className="settings-visually-hidden">Args</span>
                    <SettingsTextField
                      identifier
                      className="is-mono"
                      value={target.argsText}
                      placeholder="Arguments"
                      onChange={(event) => onOpenAppDraftChange(index, { argsText: event.target.value })}
                      onBlur={onCommitOpenApps}
                      aria-label={`Open app args ${index + 1}`}
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </SettingsGroup>
    </SettingsPage>
  );
}
