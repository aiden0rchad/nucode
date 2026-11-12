import { SettingsFieldRow, SettingsGroup, SettingsPage, SettingsRow, SettingsRowText, SettingsSelect, SettingsButton, SettingsStatus, SettingsToggleRow, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";
import type { AppSettings, DictationModelStatus } from "@/types";
import { formatDownloadSize } from "@utils/formatting";

type DictationModelOption = {
  id: string;
  label: string;
  size: string;
  note: string;
};

type SettingsDictationSectionProps = {
  appSettings: AppSettings;
  optionKeyLabel: string;
  metaKeyLabel: string;
  dictationModels: DictationModelOption[];
  selectedDictationModel: DictationModelOption;
  dictationModelStatus?: DictationModelStatus | null;
  dictationReady: boolean;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onDownloadDictationModel?: () => void;
  onCancelDictationDownload?: () => void;
  onRemoveDictationModel?: () => void;
};

export function SettingsDictationSection({
  appSettings,
  optionKeyLabel,
  metaKeyLabel,
  dictationModels,
  selectedDictationModel,
  dictationModelStatus,
  dictationReady,
  onUpdateAppSettings,
  onDownloadDictationModel,
  onCancelDictationDownload,
  onRemoveDictationModel,
}: SettingsDictationSectionProps) {
  const dictationProgress = dictationModelStatus?.progress ?? null;

  const statusText = dictationModelStatus
    ? dictationModelStatus.state === "ready" ? "Ready for dictation"
      : dictationModelStatus.state === "missing" ? "Not downloaded yet"
      : dictationModelStatus.state === "downloading" ? "Downloading…"
      : dictationModelStatus.error ?? "Download error"
    : "";
  const statusTone = dictationModelStatus?.state === "ready" ? "ready" : dictationModelStatus?.state === "error" ? "error" : dictationModelStatus?.state === "downloading" ? "busy" : "idle";
  return (
    <SettingsPage title="Dictation" subtitle="Speak into the composer. Transcription runs on this computer.">
      <SettingsGroup>
        <SettingsToggleRow
          title="Enable dictation"
          subtitle="Downloads the selected speech model the first time you turn it on."
        >
          <SettingsToggleSwitch
            pressed={appSettings.dictationEnabled}
            onClick={() => {
              const nextEnabled = !appSettings.dictationEnabled;
              void onUpdateAppSettings({
                ...appSettings,
                dictationEnabled: nextEnabled,
              });
              if (!nextEnabled && dictationModelStatus?.state === "downloading" && onCancelDictationDownload) {
                onCancelDictationDownload();
              }
              if (nextEnabled && dictationModelStatus?.state === "missing" && onDownloadDictationModel) {
                onDownloadDictationModel();
              }
            }}
          />
        </SettingsToggleRow>
        <SettingsFieldRow title="Hold-to-dictate key" subtitle="Hold the key to record and release it to transcribe.">
          <SettingsSelect
            value={appSettings.dictationHoldKey ?? ""}
            onChange={(event) =>
              void onUpdateAppSettings({
                ...appSettings,
                dictationHoldKey: event.target.value,
              })
            }
          >
            <option value="">Off</option>
            <option value="alt">{optionKeyLabel}</option>
            <option value="shift">Shift</option>
            <option value="control">Control</option>
            <option value="meta">{metaKeyLabel}</option>
          </SettingsSelect>
        </SettingsFieldRow>
        <SettingsFieldRow title="Preferred language" subtitle="The language is still detected automatically; this nudges the result toward yours.">
          <SettingsSelect
            value={appSettings.dictationPreferredLanguage ?? ""}
            onChange={(event) =>
              void onUpdateAppSettings({
                ...appSettings,
                dictationPreferredLanguage: event.target.value || null,
              })
            }
          >
            <option value="">Auto-detect only</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
            <option value="pt">Portuguese</option>
            <option value="nl">Dutch</option>
            <option value="sv">Swedish</option>
            <option value="no">Norwegian</option>
            <option value="da">Danish</option>
            <option value="fi">Finnish</option>
            <option value="pl">Polish</option>
            <option value="tr">Turkish</option>
            <option value="ru">Russian</option>
            <option value="uk">Ukrainian</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
            <option value="zh">Chinese</option>
          </SettingsSelect>
        </SettingsFieldRow>
      </SettingsGroup>
      <SettingsGroup title="Speech model" subtitle="Bigger models are more accurate but take longer to download and run.">
        <SettingsFieldRow title="Dictation model" subtitle={<>{selectedDictationModel.note} Download size: {selectedDictationModel.size}.</>}>
          <SettingsSelect
            value={appSettings.dictationModelId}
            onChange={(event) =>
              void onUpdateAppSettings({
                ...appSettings,
                dictationModelId: event.target.value,
              })
            }
          >
            {dictationModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} ({model.size})
              </option>
            ))}
          </SettingsSelect>
        </SettingsFieldRow>
        {dictationModelStatus && (
          <SettingsRow>
            <div>
              <SettingsRowText title={`Model status (${selectedDictationModel.label})`} subtitle={<SettingsStatus tone={statusTone}>{statusText}</SettingsStatus>} />
              {dictationProgress && (
                <div className="settings-download-progress">
                  <div className="settings-download-bar">
                    <div
                      className="settings-download-fill"
                      style={{
                        width: dictationProgress.totalBytes
                          ? `${Math.min(100, (dictationProgress.downloadedBytes / dictationProgress.totalBytes) * 100)}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <div className="settings-download-meta">{formatDownloadSize(dictationProgress.downloadedBytes)}</div>
                </div>
              )}
            </div>
            <div className="settings-field-actions">
              {dictationModelStatus.state === "missing" && (
                <SettingsButton type="button" className="primary" onClick={onDownloadDictationModel} disabled={!onDownloadDictationModel}>
                  Download
                </SettingsButton>
              )}
              {dictationModelStatus.state === "downloading" && (
                <SettingsButton type="button" onClick={onCancelDictationDownload} disabled={!onCancelDictationDownload}>
                  Cancel
                </SettingsButton>
              )}
              {dictationReady && (
                <SettingsButton type="button" className="danger" onClick={onRemoveDictationModel} disabled={!onRemoveDictationModel}>
                  Remove
                </SettingsButton>
              )}
            </div>
          </SettingsRow>
        )}
      </SettingsGroup>
    </SettingsPage>
  );
}
