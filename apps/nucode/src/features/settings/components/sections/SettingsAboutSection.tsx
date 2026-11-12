import { SettingsButton, SettingsGroup, SettingsPage, SettingsRow, SettingsRowText, SettingsStatus, SettingsToggleRow, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useEffect, useState } from "react";
import type { AppSettings } from "@/types";
import {
  checkAppUpdate,
  getAppBuildType,
  type AppBuildType,
  type AppUpdateCheck,
} from "@services/tauri";
import { readLastUpdateCheck, recordUpdateCheck } from "@/features/update/hooks/useUpdater";
import { UpdateDownload } from "@/features/update/components/UpdateDownload";
import { ReleaseNotes } from "@/features/update/components/ReleaseNotes";
import { IssueReportDialog } from "@/features/report/IssueReportDialog";

type SettingsAboutSectionProps = {
  appSettings: AppSettings;
  onToggleAutomaticAppUpdateChecks?: () => void;
};

export function updateCheckSummary(result: AppUpdateCheck) {
  switch (result.status) {
    case "available": return `nucode ${result.latestVersion} is available. You have ${result.currentVersion}.`;
    case "latest": return "You're up to date.";
    case "noReleases": return "No releases published yet.";
    default: return result.message ?? "Couldn't check for updates. Try again later.";
  }
}

export function SettingsAboutSection({ appSettings, onToggleAutomaticAppUpdateChecks }: SettingsAboutSectionProps) {
  const [appBuildType, setAppBuildType] = useState<AppBuildType | "unknown">("unknown");
  const [update, setUpdate] = useState<AppUpdateCheck | null>(() => readLastUpdateCheck()?.result ?? null);
  const [checking, setChecking] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let active = true;
    const loadBuildType = async () => {
      try {
        const value = await getAppBuildType();
        if (active) {
          setAppBuildType(value);
        }
      } catch {
        if (active) {
          setAppBuildType("unknown");
        }
      }
    };
    void loadBuildType();
    return () => {
      active = false;
    };
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      const result = await checkAppUpdate();
      recordUpdateCheck(result);
      setUpdate(result);
    } catch {
      setUpdate({ status: "unavailable", currentVersion: __APP_VERSION__, message: "Couldn't check for updates. Try again later." });
    } finally {
      setChecking(false);
    }
  };

  const buildDateValue = __APP_BUILD_DATE__.trim();
  const parsedBuildDate = Date.parse(buildDateValue);
  const buildDateLabel = Number.isNaN(parsedBuildDate)
    ? buildDateValue || "unknown"
    : new Date(parsedBuildDate).toLocaleString();

  const summary = checking ? "Checking GitHub…" : update ? updateCheckSummary(update) : "Not checked yet.";
  return (
    <SettingsPage title="About" subtitle="Version, updates and help.">
      <div className="settings-about-header">
        <span className="settings-about-name">nucode</span>
        <SettingsStatus tone={update?.status === "available" ? "warning" : "ready"}>Version {__APP_VERSION__}</SettingsStatus>
      </div>
      <SettingsGroup title="App updates" subtitle="Download an update here, then open the installer to finish.">
        <SettingsToggleRow title="Check for updates automatically" subtitle="At most once a day, when nucode starts.">
          <SettingsToggleSwitch pressed={appSettings.automaticAppUpdateChecksEnabled} onClick={onToggleAutomaticAppUpdateChecks} />
        </SettingsToggleRow>
        <SettingsRow className="settings-update-row">
          <div role="status" className="settings-update-summary">{summary}</div>
          <div className="settings-row-controls">
            {update?.status === "available" && <UpdateDownload key={update.latestVersion} version={update.latestVersion ?? ""} available={!!update.downloadUrl} />}
            <SettingsButton disabled={checking} onClick={() => void checkNow()}>Check for updates</SettingsButton>
          </div>
        </SettingsRow>
        {update?.status === "available" && update.notes && <div className="settings-card-block"><ReleaseNotes className="update-toast-notes" notes={update.notes} /></div>}
      </SettingsGroup>
      <SettingsGroup title="Help">
        <SettingsRow>
          <SettingsRowText title="Run setup" subtitle="Walk through the first-run setup again." />
          <SettingsButton onClick={() => window.dispatchEvent(new Event("nucode:run-setup"))}>Run setup</SettingsButton>
        </SettingsRow>
        <SettingsRow>
          <SettingsRowText title="Report an issue" subtitle="Opens a prefilled GitHub issue that you can review and edit before posting." />
          <SettingsButton onClick={() => setReporting(true)}>Report an issue…</SettingsButton>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Build">
        {Object.entries({ Version: __APP_VERSION__, "Build type": appBuildType, Branch: __APP_GIT_BRANCH__ || "unknown", Commit: __APP_COMMIT_HASH__ || "unknown", "Build date": buildDateLabel }).map(([label, value]) =>
          <SettingsRow key={label}><div className="settings-toggle-title">{label}</div><code className="settings-build-value">{value}</code></SettingsRow>)}
      </SettingsGroup>
      {reporting && <IssueReportDialog onClose={() => setReporting(false)} />}
    </SettingsPage>
  );
}
