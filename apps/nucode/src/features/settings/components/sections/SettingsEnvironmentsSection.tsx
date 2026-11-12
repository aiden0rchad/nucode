import { SettingsCallout, SettingsEmpty, SettingsFieldRow, SettingsGroup, SettingsPage, SettingsTextField, SettingsButton, SettingsSelect, SettingsTextArea, SettingsUnsaved } from "@/features/design-system/components/settings/SettingsPrimitives";
import type { Dispatch, SetStateAction } from "react";
import type { WorkspaceInfo } from "@/types";
import { pushErrorToast } from "@services/toasts";

type SettingsEnvironmentsSectionProps = {
  mainWorkspaces: WorkspaceInfo[];
  environmentWorkspace: WorkspaceInfo | null;
  environmentSaving: boolean;
  environmentError: string | null;
  environmentDraftScript: string;
  environmentSavedScript: string | null;
  environmentDirty: boolean;
  globalWorktreesFolderDraft: string;
  globalWorktreesFolderSaved: string | null;
  globalWorktreesFolderDirty: boolean;
  worktreesFolderDraft: string;
  worktreesFolderSaved: string | null;
  worktreesFolderDirty: boolean;
  onSetEnvironmentWorkspaceId: Dispatch<SetStateAction<string | null>>;
  onSetEnvironmentDraftScript: Dispatch<SetStateAction<string>>;
  onSetGlobalWorktreesFolderDraft: Dispatch<SetStateAction<string>>;
  onSetWorktreesFolderDraft: Dispatch<SetStateAction<string>>;
  onSaveEnvironmentSetup: () => Promise<void>;
};

export function SettingsEnvironmentsSection({
  mainWorkspaces,
  environmentWorkspace,
  environmentSaving,
  environmentError,
  environmentDraftScript,
  environmentSavedScript,
  environmentDirty,
  globalWorktreesFolderDraft,
  globalWorktreesFolderSaved: _globalWorktreesFolderSaved,
  globalWorktreesFolderDirty,
  worktreesFolderDraft,
  worktreesFolderSaved: _worktreesFolderSaved,
  worktreesFolderDirty,
  onSetEnvironmentWorkspaceId,
  onSetEnvironmentDraftScript,
  onSetGlobalWorktreesFolderDraft,
  onSetWorktreesFolderDraft,
  onSaveEnvironmentSetup,
}: SettingsEnvironmentsSectionProps) {
  const hasAnyChanges =
    environmentDirty || globalWorktreesFolderDirty || worktreesFolderDirty;
  const hasProjects = mainWorkspaces.length > 0;

  const browse = async (title: string, set: (value: string) => void) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title });
      if (selected && typeof selected === "string") set(selected);
    } catch (error) {
      pushErrorToast({
        title: "Failed to open folder picker",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const copyScript = () => {
    const clipboard = typeof navigator === "undefined" ? null : navigator.clipboard;
    if (!clipboard?.writeText) {
      pushErrorToast({ title: "Copy failed", message: "Clipboard access is unavailable in this environment. Copy the script manually instead." });
      return;
    }
    void clipboard.writeText(environmentDraftScript).catch(() => {
      pushErrorToast({ title: "Copy failed", message: "Could not write to the clipboard. Copy the script manually instead." });
    });
  };
  const discard = () => {
    onSetGlobalWorktreesFolderDraft(_globalWorktreesFolderSaved ?? "");
    onSetWorktreesFolderDraft(_worktreesFolderSaved ?? "");
    onSetEnvironmentDraftScript(environmentSavedScript ?? "");
  };
  const saveDisabled = environmentSaving || (hasProjects ? !hasAnyChanges : !globalWorktreesFolderDirty);
  return (
    <SettingsPage
      title="Environments"
      subtitle="Where new worktrees are created and what runs in them first."
      actions={<SettingsUnsaved dirty={hasProjects ? hasAnyChanges : globalWorktreesFolderDirty} saving={environmentSaving} disabled={saveDisabled} onSave={() => { void onSaveEnvironmentSetup(); }} onDiscard={discard} />}
    >
      {environmentError && <SettingsCallout tone="error" style={{ marginBottom: 16 }}>{environmentError}</SettingsCallout>}
      {!hasProjects ? (
        <SettingsGroup title="Worktrees">        <SettingsFieldRow stacked title="Global worktrees root" subtitle="Where new worktrees go unless a project sets its own. Each project gets a subfolder.">
          <div className="settings-field-actions">
            <SettingsTextField identifier className="is-fill is-mono" type="text" value={globalWorktreesFolderDraft} onChange={(event) => onSetGlobalWorktreesFolderDraft(event.target.value)} placeholder="/path/to/worktrees-root" disabled={environmentSaving} />
            <SettingsButton type="button" onClick={() => void browse("Select global worktrees root", onSetGlobalWorktreesFolderDraft)} disabled={environmentSaving}>Browse…</SettingsButton>
          </div>
        </SettingsFieldRow>
<SettingsEmpty>No projects yet.</SettingsEmpty></SettingsGroup>
      ) : (
        <SettingsGroup
          title="Worktrees"
          subtitle="Choose a project to give it its own worktrees folder and setup script."
        >
        <SettingsFieldRow stacked title="Global worktrees root" subtitle="Where new worktrees go unless a project sets its own. Each project gets a subfolder.">
          <div className="settings-field-actions">
            <SettingsTextField identifier className="is-fill is-mono" type="text" value={globalWorktreesFolderDraft} onChange={(event) => onSetGlobalWorktreesFolderDraft(event.target.value)} placeholder="/path/to/worktrees-root" disabled={environmentSaving} />
            <SettingsButton type="button" onClick={() => void browse("Select global worktrees root", onSetGlobalWorktreesFolderDraft)} disabled={environmentSaving}>Browse…</SettingsButton>
          </div>
        </SettingsFieldRow>

          <SettingsFieldRow title="Project" subtitle={environmentWorkspace?.path}>
            <SettingsSelect
              value={environmentWorkspace?.id ?? ""}
              onChange={(event) => onSetEnvironmentWorkspaceId(event.target.value)}
              disabled={environmentSaving}
            >
              {mainWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </SettingsSelect>
          </SettingsFieldRow>
          <SettingsFieldRow stacked title="Worktrees folder" subtitle="Where this project's worktrees go. Leave empty to use the global root or the default.">
            <div className="settings-field-actions">
              <SettingsTextField identifier className="is-fill is-mono" type="text" value={worktreesFolderDraft} onChange={(event) => onSetWorktreesFolderDraft(event.target.value)} placeholder="/path/to/worktrees" disabled={environmentSaving} />
              <SettingsButton type="button" onClick={() => void browse("Select worktrees folder", onSetWorktreesFolderDraft)} disabled={environmentSaving}>Browse…</SettingsButton>
            </div>
          </SettingsFieldRow>
          <SettingsFieldRow stacked title="Setup script" subtitle="Runs once in its own terminal after each new worktree is created.">
            <SettingsTextArea className="is-mono" value={environmentDraftScript} onChange={(event) => onSetEnvironmentDraftScript(event.target.value)} placeholder="pnpm install" spellCheck={false} disabled={environmentSaving} />
            <div className="settings-field-actions">
              <SettingsButton type="button" onClick={copyScript} disabled={environmentSaving || environmentDraftScript.length === 0}>Copy</SettingsButton>
              <SettingsButton type="button" onClick={() => onSetEnvironmentDraftScript(environmentSavedScript ?? "")} disabled={environmentSaving || !environmentDirty}>Reset</SettingsButton>
            </div>
          </SettingsFieldRow>
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
