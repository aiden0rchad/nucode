import { SettingsFieldRow, SettingsGroup, SettingsPage, SettingsSelect, SettingsSegmented, SettingsSwitchRow } from "@/features/design-system/components/settings/SettingsPrimitives";
import type { AppSettings } from "@/types";

type ComposerPreset = AppSettings["composerEditorPreset"];

type SettingsComposerSectionProps = {
  appSettings: AppSettings;
  optionKeyLabel: string;
  followUpShortcutLabel: string;
  composerPresetLabels: Record<ComposerPreset, string>;
  onComposerPresetChange: (preset: ComposerPreset) => void;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

export function SettingsComposerSection({
  appSettings,
  optionKeyLabel,
  followUpShortcutLabel,
  composerPresetLabels,
  onComposerPresetChange,
  onUpdateAppSettings,
}: SettingsComposerSectionProps) {
  const steerUnavailable = !appSettings.steerEnabled;
  const flip = (key: keyof AppSettings) => () => void onUpdateAppSettings({ ...appSettings, [key]: !appSettings[key] });
  return (
    <SettingsPage title="Composer" subtitle="How the message editor handles follow-ups, pasted code and lists.">
      <SettingsGroup title="Conversation" subtitle="What happens when you send a message and how agents answer.">
        <SettingsFieldRow
          title="Follow-up behavior"
          subtitle={<>Queue: send after the current run. Steer: redirect the run in progress. Press {followUpShortcutLabel} to use the other one for a single message.{steerUnavailable && " Steer is unavailable in the current Codex config, so follow-ups will queue."}</>}
        >
          <SettingsSegmented label="Follow-up behavior" value={appSettings.followUpMessageBehavior}
            options={[{ value: "queue", label: "Queue" }, { value: "steer", label: "Steer", disabled: steerUnavailable }]}
            onChange={value => void onUpdateAppSettings({ ...appSettings, followUpMessageBehavior: value as "queue" | "steer" })} />
        </SettingsFieldRow>
        <SettingsSwitchRow
          title="Show follow-up hint while processing"
          subtitle="Shows the Queue and Steer shortcuts above the composer while a run is active."
          pressed={appSettings.composerFollowUpHintEnabled}
          onClick={flip("composerFollowUpHintEnabled")}
        />
        <SettingsFieldRow title="Response style" subtitle="How much agents explain and how far they carry a task before stopping. Applies from the next turn.">
          <SettingsSelect
            value={appSettings.responseStyle ?? "standard"}
            onChange={(event) =>
              void onUpdateAppSettings({
                ...appSettings,
                responseStyle: event.target.value as NonNullable<AppSettings["responseStyle"]>,
              })
            }
          >
            <option value="concise">Concise</option>
            <option value="standard">Standard</option>
            <option value="detailed">In depth</option>
          </SettingsSelect>
        </SettingsFieldRow>
      </SettingsGroup>
      <SettingsGroup title="Editor helpers" subtitle="Code fences, pasting and lists in the message editor.">
        <SettingsFieldRow title="Preset" subtitle="Sets the switches below to a starting point. You can still change any of them afterwards.">
          <SettingsSelect
            value={appSettings.composerEditorPreset}
            onChange={(event) => onComposerPresetChange(event.target.value as ComposerPreset)}
          >
            {Object.entries(composerPresetLabels).map(([preset, label]) => (
              <option key={preset} value={preset}>{label}</option>
            ))}
          </SettingsSelect>
        </SettingsFieldRow>
        <SettingsSwitchRow title="Expand fences on Space" subtitle="Typing ``` then Space inserts a fenced block." pressed={appSettings.composerFenceExpandOnSpace} onClick={flip("composerFenceExpandOnSpace")} />
        <SettingsSwitchRow title="Expand fences on Enter" subtitle="Pressing Enter on a ``` line also inserts a fenced block." pressed={appSettings.composerFenceExpandOnEnter} onClick={flip("composerFenceExpandOnEnter")} />
        <SettingsSwitchRow title="Support language tags" subtitle="Lets ```lang then Space start a fence in that language." pressed={appSettings.composerFenceLanguageTags} onClick={flip("composerFenceLanguageTags")} />
        <SettingsSwitchRow title="Wrap selection in fences" subtitle="Wraps the selected text when you start a fence." pressed={appSettings.composerFenceWrapSelection} onClick={flip("composerFenceWrapSelection")} />
        <SettingsSwitchRow title="Copy blocks without fences" subtitle={<>Copy gives plain text. Hold {optionKeyLabel} to include the ``` fences.</>} pressed={appSettings.composerCodeBlockCopyUseModifier} onClick={flip("composerCodeBlockCopyUseModifier")} />
        <SettingsSwitchRow title="Auto-wrap multi-line paste" subtitle="Puts pasted text that spans several lines inside a fenced block." pressed={appSettings.composerFenceAutoWrapPasteMultiline} onClick={flip("composerFenceAutoWrapPasteMultiline")} />
        <SettingsSwitchRow title="Auto-wrap code-like single lines" subtitle="Puts a pasted single line that looks like code inside a fenced block." pressed={appSettings.composerFenceAutoWrapPasteCodeLike} onClick={flip("composerFenceAutoWrapPasteCodeLike")} />
        <SettingsSwitchRow title="Continue lists on Shift+Enter" subtitle="Shift+Enter on a numbered or bulleted line starts the next item." pressed={appSettings.composerListContinuation} onClick={flip("composerListContinuation")} />
      </SettingsGroup>
    </SettingsPage>
  );
}
