import { SettingsFieldRow, SettingsGroup, SettingsPage, SettingsTextArea, SettingsButton, SettingsSelect, SettingsSwitchRow } from "@/features/design-system/components/settings/SettingsPrimitives";
import type { AppSettings, ModelOption } from "@/types";

type SettingsGitSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  models: ModelOption[];
  commitMessagePromptDraft: string;
  commitMessagePromptDirty: boolean;
  commitMessagePromptSaving: boolean;
  onSetCommitMessagePromptDraft: (value: string) => void;
  onSaveCommitMessagePrompt: () => Promise<void>;
  onResetCommitMessagePrompt: () => Promise<void>;
};

export function SettingsGitSection({
  appSettings,
  onUpdateAppSettings,
  models,
  commitMessagePromptDraft,
  commitMessagePromptDirty,
  commitMessagePromptSaving,
  onSetCommitMessagePromptDraft,
  onSaveCommitMessagePrompt,
  onResetCommitMessagePrompt,
}: SettingsGitSectionProps) {
  const flip = (key: "preloadGitDiffs" | "gitDiffIgnoreWhitespaceChanges") => () => void onUpdateAppSettings({ ...appSettings, [key]: !appSettings[key] });
  return (
    <SettingsPage title="Git" subtitle="How diffs load in the Git sidebar and how commit messages are written.">
      <SettingsGroup title="Diffs">
        <SettingsSwitchRow title="Preload git diffs" subtitle="Loads diffs ahead of time so the Git sidebar opens faster." pressed={appSettings.preloadGitDiffs} onClick={flip("preloadGitDiffs")} />
        <SettingsSwitchRow title="Ignore whitespace changes" subtitle="Hides whitespace-only changes in local and commit diffs." pressed={appSettings.gitDiffIgnoreWhitespaceChanges} onClick={flip("gitDiffIgnoreWhitespaceChanges")} />
      </SettingsGroup>
      <SettingsGroup
        title="Commit messages"
        actions={<>
          <SettingsButton type="button" onClick={() => { void onResetCommitMessagePrompt(); }} disabled={commitMessagePromptSaving || !commitMessagePromptDirty}>Reset</SettingsButton>
          <SettingsButton type="button" className="primary" onClick={() => { void onSaveCommitMessagePrompt(); }} disabled={commitMessagePromptSaving || !commitMessagePromptDirty}>{commitMessagePromptSaving ? "Saving…" : "Save"}</SettingsButton>
        </>}
      >
        {models.length > 0 && (
          <SettingsFieldRow title="Commit message model" subtitle="The model that writes commit messages. Default uses the project's model.">
            <SettingsSelect
              value={appSettings.commitMessageModelId ?? ""}
              onChange={(event) => {
                const value = event.target.value || null;
                void onUpdateAppSettings({ ...appSettings, commitMessageModelId: value });
              }}
            >
              <option value="">Default</option>
              {models.map((model) => (
                <option key={model.id} value={model.model}>{model.displayName?.trim() || model.model}</option>
              ))}
            </SettingsSelect>
          </SettingsFieldRow>
        )}
        <SettingsFieldRow stacked title="Commit message prompt" subtitle={<>Instructions for writing commit messages. Include <code>{"{diff}"}</code> where the git diff should go.</>}>
          <SettingsTextArea
            value={commitMessagePromptDraft}
            onChange={(event) => onSetCommitMessagePromptDraft(event.target.value)}
            spellCheck={false}
            disabled={commitMessagePromptSaving}
          />
        </SettingsFieldRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
