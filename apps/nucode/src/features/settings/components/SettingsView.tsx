import { IconButton } from "@/features/design-system/components/IconButton";
import { EvalsView } from "@/features/evals/EvalsView";
import { DiagnosticsSettings } from "@/features/diagnostics/DiagnosticsSettings";
import { DiagnosticBoundary } from "@/features/diagnostics/DiagnosticBoundary";
import { FeatureSettings } from "@settings/features";
import { SettingsNucodeFeaturesSection } from "./sections/SettingsNucodeFeaturesSection";
import { SettingsEnginesSection } from "./sections/SettingsEnginesSection";
import { useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import { SettingsGroup, SettingsSegmented } from "@/features/design-system/components/settings/SettingsPrimitives";
import { SettingsProvidersSection, SettingsAgentPolicySection, ProjectAgentPolicy } from "./sections/SettingsRegistrySections";
import { SettingsConnectorsSection } from "./sections/SettingsConnectorsSection";
import { SettingsImportSection } from "./sections/SettingsImportSection";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import X from "lucide-react/dist/esm/icons/x";
import type {
  AppSettings,
  CodexDoctorResult,
  CodexUpdateResult,
  DictationModelStatus,
  WorkspaceSettings,
  WorkspaceGroup,
  WorkspaceInfo,
} from "@/types";
import { useSettingsViewCloseShortcuts } from "@settings/hooks/useSettingsViewCloseShortcuts";
import { useSettingsViewNavigation } from "@settings/hooks/useSettingsViewNavigation";
import { useSettingsViewOrchestration } from "@settings/hooks/useSettingsViewOrchestration";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import { SettingsNav } from "./SettingsNav";
import type { CodexSection } from "./settingsTypes";
import { SETTINGS_SECTION_LABELS, STAGED_SETTINGS_SECTIONS } from "./settingsViewConstants";
import { SettingsSectionContainers } from "./sections/SettingsSectionContainers";
import { SettingsComputerSection } from "./sections/SettingsComputerSection";
import { SettingsBrowserSection } from "./sections/SettingsBrowserSection";

export type SettingsViewProps = {
  activeWorkspace?: WorkspaceInfo | null;
  workspaceGroups: WorkspaceGroup[];
  groupedWorkspaces: Array<{
    id: string | null;
    name: string;
    workspaces: WorkspaceInfo[];
  }>;
  ungroupedLabel: string;
  onClose: () => void;
  onMoveWorkspace: (id: string, direction: "up" | "down") => void;
  onDeleteWorkspace: (id: string) => void;
  onCreateWorkspaceGroup: (name: string) => Promise<WorkspaceGroup | null>;
  onRenameWorkspaceGroup: (id: string, name: string) => Promise<boolean | null>;
  onMoveWorkspaceGroup: (id: string, direction: "up" | "down") => Promise<boolean | null>;
  onDeleteWorkspaceGroup: (id: string) => Promise<boolean | null>;
  onAssignWorkspaceGroup: (
    workspaceId: string,
    groupId: string | null,
  ) => Promise<boolean | null>;
  appSettings: AppSettings;
  openAppIconById: Record<string, string>;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onToggleAutomaticAppUpdateChecks?: () => void;
  onRunDoctor: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexDoctorResult>;
  onRunCodexUpdate?: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexUpdateResult>;
  onUpdateWorkspaceSettings: (
    id: string,
    settings: Partial<WorkspaceSettings>,
  ) => Promise<void>;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  onTestNotificationSound: () => void;
  onTestSystemNotification: () => void;
  onMobileConnectSuccess?: () => Promise<void> | void;
  dictationModelStatus?: DictationModelStatus | null;
  onDownloadDictationModel?: () => void;
  onCancelDictationDownload?: () => void;
  onRemoveDictationModel?: () => void;
  initialSection?: CodexSection;
};

export function SettingsView({
  activeWorkspace,
  workspaceGroups,
  groupedWorkspaces,
  ungroupedLabel,
  onClose,
  onMoveWorkspace,
  onDeleteWorkspace,
  onCreateWorkspaceGroup,
  onRenameWorkspaceGroup,
  onMoveWorkspaceGroup,
  onDeleteWorkspaceGroup,
  onAssignWorkspaceGroup,
  appSettings,
  openAppIconById,
  onUpdateAppSettings,
  onToggleAutomaticAppUpdateChecks,
  onRunDoctor,
  onRunCodexUpdate,
  onUpdateWorkspaceSettings,
  scaleShortcutTitle,
  scaleShortcutText,
  onTestNotificationSound,
  onTestSystemNotification,
  onMobileConnectSuccess,
  dictationModelStatus,
  onDownloadDictationModel,
  onCancelDictationDownload,
  onRemoveDictationModel,
  initialSection,
}: SettingsViewProps) {
  const {
    activeSection,
    showMobileDetail,
    setShowMobileDetail,
    useMobileMasterDetail,
    handleSelectSection,
  } = useSettingsViewNavigation({ initialSection });

  const orchestration = useSettingsViewOrchestration({
    workspaceGroups,
    groupedWorkspaces,
    ungroupedLabel,
    appSettings,
    openAppIconById,
    onUpdateAppSettings,
    onToggleAutomaticAppUpdateChecks,
    onRunDoctor,
    onRunCodexUpdate,
    onUpdateWorkspaceSettings,
    scaleShortcutTitle,
    scaleShortcutText,
    onTestNotificationSound,
    onTestSystemNotification,
    onMoveWorkspace,
    onDeleteWorkspace,
    onCreateWorkspaceGroup,
    onRenameWorkspaceGroup,
    onMoveWorkspaceGroup,
    onDeleteWorkspaceGroup,
    onAssignWorkspaceGroup,
    onMobileConnectSuccess,
    dictationModelStatus,
    onDownloadDictationModel,
    onCancelDictationDownload,
    onRemoveDictationModel,
  });

  useSettingsViewCloseShortcuts(onClose);

  const [agentTab, setAgentTab] = useState("defaults");
  const [justSaved, setJustSaved] = useState(false);
  const firstSettings = useRef(appSettings);
  useEffect(() => {
    if (appSettings === firstSettings.current) return;
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [appSettings]);
  const manageEngines = () => { handleSelectSection("engines"); };
  const activeSectionLabel = SETTINGS_SECTION_LABELS[activeSection];
  const settingsBodyClassName = `settings-body${
    useMobileMasterDetail ? " settings-body-mobile-master-detail" : ""
  }${useMobileMasterDetail && showMobileDetail ? " is-detail-visible" : ""}`;

  return (
    <FeatureSettings.Provider value={appSettings}><ModalShell
      className="settings-overlay"
      cardClassName="settings-window squircle-clip"
      squircle
      onBackdropClick={onClose}
      ariaLabelledBy="settings-modal-title"
    >
      <div className="settings-titlebar">
        <div className="settings-title" id="settings-modal-title">
          Settings
        </div>
        <div className="settings-titlebar-end">
        <span className="settings-saving-line" aria-live="polite">{justSaved ? <><Check aria-hidden />Saved</> : STAGED_SETTINGS_SECTIONS.includes(activeSection) ? "Edits here apply when you save" : "Changes save automatically"}</span>
        <IconButton
          type="button"
          className="ghost settings-close"
          onClick={onClose}
          aria-label="Close settings"
        >
          <X aria-hidden />
        </IconButton>
        </div>
      </div>
      <div className={settingsBodyClassName}>
        {(!useMobileMasterDetail || !showMobileDetail) && (
          <div className="settings-master">
            <SettingsNav
              activeSection={activeSection}
              onSelectSection={handleSelectSection}
              showDisclosure={useMobileMasterDetail}
            />
          </div>
        )}
        {(!useMobileMasterDetail || showMobileDetail) && (
          <div className="settings-detail">
            {useMobileMasterDetail && (
              <div className="settings-mobile-detail-header">
                <button
                  type="button"
                  className="settings-mobile-back"
                  onClick={() => setShowMobileDetail(false)}
                  aria-label="Back to settings sections"
                >
                  <ChevronLeft aria-hidden />
                  Sections
                </button>
                <div className="settings-mobile-detail-title">{activeSectionLabel}</div>
              </div>
            )}
            <div className="settings-content">
              {activeSection === "evals" ? <EvalsView appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} onOpenFull={runId => { window.dispatchEvent(new CustomEvent("nucode:evals-full", {detail:{runId}})); onClose(); }} /> : activeSection === "diagnostics" ? <DiagnosticBoundary panel="settings"><DiagnosticsSettings appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} /></DiagnosticBoundary> : activeSection === "features" ? <SettingsNucodeFeaturesSection appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} /> :
               activeSection === "engines" ? <SettingsEnginesSection appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} onOpenCodexFlags={() => handleSelectSection("codex-flags")} onOpenCodexSetup={() => handleSelectSection("codex")} /> :
               activeSection === "computer" ? <SettingsComputerSection onManageEngines={manageEngines} appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} /> : activeSection === "browser" ? <SettingsBrowserSection onManageEngines={manageEngines} appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} /> :
               activeSection === "import" ? <SettingsImportSection /> :
               activeSection === "providers" ? <SettingsProvidersSection appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} /> :
               activeSection === "connectors" ? <SettingsConnectorsSection appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} workspace={activeWorkspace} onUpdateWorkspaceSettings={onUpdateWorkspaceSettings} /> :
               activeSection === "agents" ? <SettingsAgentPolicySection key={`${activeWorkspace?.id ?? "global"}-${agentTab}`} onUpdateWorkspaceSettings={onUpdateWorkspaceSettings} tab={agentTab as "defaults" | "subagents" | "roles"} appSettings={appSettings} onUpdateAppSettings={onUpdateAppSettings} workspace={activeWorkspace} onManageEngines={manageEngines}
                 pageTabs={<SettingsSegmented tabs label="Models & Agents tabs" value={agentTab} options={["defaults", "subagents", "roles"].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={setAgentTab} />} /> :
               <SettingsSectionContainers
                activeSection={activeSection}
                orchestration={orchestration}
                projectsExtra={groupedWorkspaces.some(g => g.workspaces.length) ? <SettingsGroup title="Project overrides" subtitle="Override the app defaults from Models & Agents for a single project.">{groupedWorkspaces.flatMap(g => g.workspaces).map(w => <ProjectAgentPolicy key={w.id} workspace={w} appSettings={appSettings} onUpdate={onUpdateWorkspaceSettings} />)}</SettingsGroup> : null}
              />}
            </div>
          </div>
        )}
      </div>
    </ModalShell></FeatureSettings.Provider>
  );
}
