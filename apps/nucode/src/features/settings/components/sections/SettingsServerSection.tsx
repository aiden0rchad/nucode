import { SettingsBadge, SettingsButton, SettingsCallout, SettingsEmpty, SettingsFieldRow, SettingsGroup, SettingsIconButton, SettingsListRow, SettingsPage, SettingsRow, SettingsRowText, SettingsSelect, SettingsStatus, SettingsSwitchRow, SettingsTextField } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import X from "lucide-react/dist/esm/icons/x";
import Plus from "lucide-react/dist/esm/icons/plus";
import Copy from "lucide-react/dist/esm/icons/copy";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type {
  AppSettings,
  TailscaleDaemonCommandPreview,
  TailscaleStatus,
  TcpDaemonStatus,
} from "@/types";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";

type AddRemoteBackendDraft = {
  name: string;
  host: string;
  token: string;
};

type SettingsServerSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  isMobilePlatform: boolean;
  mobileConnectBusy: boolean;
  mobileConnectStatusText: string | null;
  mobileConnectStatusError: boolean;
  remoteBackends: AppSettings["remoteBackends"];
  activeRemoteBackendId: string | null;
  remoteStatusText: string | null;
  remoteStatusError: boolean;
  remoteNameError: string | null;
  remoteHostError: string | null;
  remoteNameDraft: string;
  remoteHostDraft: string;
  remoteTokenDraft: string;
  nextRemoteNameSuggestion: string;
  tailscaleStatus: TailscaleStatus | null;
  tailscaleStatusBusy: boolean;
  tailscaleStatusError: string | null;
  tailscaleCommandPreview: TailscaleDaemonCommandPreview | null;
  tailscaleCommandBusy: boolean;
  tailscaleCommandError: string | null;
  tcpDaemonStatus: TcpDaemonStatus | null;
  tcpDaemonBusyAction: "start" | "stop" | "status" | null;
  onSetRemoteNameDraft: Dispatch<SetStateAction<string>>;
  onSetRemoteHostDraft: Dispatch<SetStateAction<string>>;
  onSetRemoteTokenDraft: Dispatch<SetStateAction<string>>;
  onCommitRemoteName: () => Promise<void>;
  onCommitRemoteHost: () => Promise<void>;
  onCommitRemoteToken: () => Promise<void>;
  onSelectRemoteBackend: (id: string) => Promise<void>;
  onAddRemoteBackend: (draft: AddRemoteBackendDraft) => Promise<void>;
  onMoveRemoteBackend: (id: string, direction: "up" | "down") => Promise<void>;
  onDeleteRemoteBackend: (id: string) => Promise<void>;
  onRefreshTailscaleStatus: () => void;
  onRefreshTailscaleCommandPreview: () => void;
  onUseSuggestedTailscaleHost: () => Promise<void>;
  onTcpDaemonStart: () => Promise<void>;
  onTcpDaemonStop: () => Promise<void>;
  onTcpDaemonStatus: () => Promise<void>;
  onMobileConnectTest: () => void;
};

export function SettingsServerSection({
  appSettings,
  onUpdateAppSettings,
  isMobilePlatform,
  mobileConnectBusy,
  mobileConnectStatusText,
  mobileConnectStatusError,
  remoteBackends,
  activeRemoteBackendId,
  remoteStatusText,
  remoteStatusError,
  remoteNameError,
  remoteHostError,
  remoteNameDraft,
  remoteHostDraft,
  remoteTokenDraft,
  nextRemoteNameSuggestion,
  tailscaleStatus,
  tailscaleStatusBusy,
  tailscaleStatusError,
  tailscaleCommandPreview,
  tailscaleCommandBusy,
  tailscaleCommandError,
  tcpDaemonStatus,
  tcpDaemonBusyAction,
  onSetRemoteNameDraft,
  onSetRemoteHostDraft,
  onSetRemoteTokenDraft,
  onCommitRemoteName,
  onCommitRemoteHost,
  onCommitRemoteToken,
  onSelectRemoteBackend,
  onAddRemoteBackend,
  onMoveRemoteBackend,
  onDeleteRemoteBackend,
  onRefreshTailscaleStatus,
  onRefreshTailscaleCommandPreview,
  onUseSuggestedTailscaleHost,
  onTcpDaemonStart,
  onTcpDaemonStop,
  onTcpDaemonStatus,
  onMobileConnectTest,
}: SettingsServerSectionProps) {
  const [pendingDeleteRemoteId, setPendingDeleteRemoteId] = useState<string | null>(
    null,
  );
  const [addRemoteOpen, setAddRemoteOpen] = useState(false);
  const [addRemoteBusy, setAddRemoteBusy] = useState(false);
  const [addRemoteError, setAddRemoteError] = useState<string | null>(null);
  const [addRemoteNameDraft, setAddRemoteNameDraft] = useState("");
  const [addRemoteHostDraft, setAddRemoteHostDraft] = useState("");
  const [addRemoteTokenDraft, setAddRemoteTokenDraft] = useState("");
  const isMobileSimplified = isMobilePlatform;
  const pendingDeleteRemote = useMemo(
    () =>
      pendingDeleteRemoteId == null
        ? null
        : remoteBackends.find((entry) => entry.id === pendingDeleteRemoteId) ?? null,
    [pendingDeleteRemoteId, remoteBackends],
  );
  const tcpRunning = tcpDaemonStatus?.state === "running";
  const tcpStatusTone = tcpRunning ? "ready" : tcpDaemonStatus?.state === "error" ? "error" : "idle";
  const tcpStatusLabel = (() => {
    if (!tcpDaemonStatus) return "Status unknown";
    if (tcpRunning) return tcpDaemonStatus.pid ? `Running (pid ${tcpDaemonStatus.pid})` : "Running";
    if (tcpDaemonStatus.state === "error") return tcpDaemonStatus.lastError ?? "Error";
    return "Stopped";
  })();
  const tcpAddress = tcpDaemonStatus?.listenAddr ?? "the configured port";
  const copyCommand = (command: string) => { void navigator.clipboard?.writeText(command).catch(() => {}); };
  const lastConnected = (ms?: number | null) => typeof ms === "number" ? new Date(ms).toLocaleString() : "Never";

  const openAddRemoteModal = () => {
    setAddRemoteError(null);
    setAddRemoteNameDraft(nextRemoteNameSuggestion);
    setAddRemoteHostDraft(remoteHostDraft);
    setAddRemoteTokenDraft("");
    setAddRemoteOpen(true);
  };

  const closeAddRemoteModal = () => {
    if (addRemoteBusy) {
      return;
    }
    setAddRemoteOpen(false);
    setAddRemoteError(null);
  };

  const handleAddRemoteConfirm = () => {
    void (async () => {
      if (addRemoteBusy) {
        return;
      }
      setAddRemoteBusy(true);
      setAddRemoteError(null);
      try {
        await onAddRemoteBackend({
          name: addRemoteNameDraft,
          host: addRemoteHostDraft,
          token: addRemoteTokenDraft,
        });
        setAddRemoteOpen(false);
      } catch (error) {
        setAddRemoteError(error instanceof Error ? error.message : "Unable to add remote.");
      } finally {
        setAddRemoteBusy(false);
      }
    })();
  };

  const hostField = (
    <SettingsFieldRow
      title="Host"
      subtitle={remoteHostError ? <span className="settings-help-error">{remoteHostError}</span> : isMobileSimplified ? "Use the Tailscale host from your desktop nucode app, for example macbook.your-tailnet.ts.net:4732." : "The server's address and port, for example 127.0.0.1:4732."}
    >
      <SettingsTextField
        identifier
        className="is-mono"
        value={remoteHostDraft}
        placeholder="127.0.0.1:4732"
        onChange={(event) => onSetRemoteHostDraft(event.target.value)}
        onBlur={() => { void onCommitRemoteHost(); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onCommitRemoteHost(); } }}
        aria-label="Remote backend host"
      />
    </SettingsFieldRow>
  );
  const tokenField = (
    <SettingsFieldRow title="Token" subtitle="The secret that mobile clients and remote mode use to sign in.">
      <SettingsTextField
        type="password"
        value={remoteTokenDraft}
        placeholder="Token (required)"
        onChange={(event) => onSetRemoteTokenDraft(event.target.value)}
        onBlur={() => { void onCommitRemoteToken(); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onCommitRemoteToken(); } }}
        aria-label="Remote backend token"
      />
    </SettingsFieldRow>
  );
  const tokenMissing = !remoteTokenDraft.trim();
  return (
    <SettingsPage
      title="Server"
      subtitle={isMobileSimplified ? "Connect this device to your desktop nucode, then run a connection test." : "Connect to another computer running nucode, or let your phone connect to this one."}
    >
      {isMobileSimplified ? (
        <>
          <SettingsGroup
            title="Saved remotes"
            subtitle="Switch the active remote here. The fields below edit the active one."
            actions={<SettingsButton type="button" onClick={openAddRemoteModal}><Plus aria-hidden />Add remote</SettingsButton>}
          >
            <div role="list" aria-label="Saved remotes" className="settings-list">{remoteBackends.map((entry, index) => {
              const isActive = entry.id === activeRemoteBackendId;
              return (
                <SettingsListRow role="listitem" key={entry.id} title={entry.name} badge={isActive ? <SettingsBadge className="is-accent">Active</SettingsBadge> : undefined} meta={<><span>TCP · {entry.host}</span><span>Last connected: {lastConnected(entry.lastConnectedAtMs)}</span></>}>
                  <SettingsButton type="button" onClick={() => { void onSelectRemoteBackend(entry.id); }} disabled={isActive} aria-label={`Use ${entry.name} remote`}>{isActive ? "Using" : "Use"}</SettingsButton>
                  <SettingsIconButton className="settings-reveal" onClick={() => { void onMoveRemoteBackend(entry.id, "up"); }} disabled={index === 0} aria-label={`Move ${entry.name} up`}><ChevronUp aria-hidden /></SettingsIconButton>
                  <SettingsIconButton className="settings-reveal" onClick={() => { void onMoveRemoteBackend(entry.id, "down"); }} disabled={index === remoteBackends.length - 1} aria-label={`Move ${entry.name} down`}><ChevronDown aria-hidden /></SettingsIconButton>
                  <SettingsIconButton className="is-danger" onClick={() => setPendingDeleteRemoteId(entry.id)} aria-label={`Delete ${entry.name}`}><Trash2 aria-hidden /></SettingsIconButton>
                </SettingsListRow>
              );
            })}</div>
            {!remoteBackends.length && <SettingsEmpty>No saved remotes yet.</SettingsEmpty>}
            {remoteStatusText && <div className={`settings-card-block${remoteStatusError ? " settings-help-error" : ""}`}>{remoteStatusText}</div>}
          </SettingsGroup>
          <SettingsGroup title="Active remote">
            <SettingsFieldRow title="Remote name" subtitle={remoteNameError ? <span className="settings-help-error">{remoteNameError}</span> : undefined}>
              <SettingsTextField
                value={remoteNameDraft}
                placeholder="My desktop"
                onChange={(event) => onSetRemoteNameDraft(event.target.value)}
                onBlur={() => { void onCommitRemoteName(); }}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onCommitRemoteName(); } }}
              />
            </SettingsFieldRow>
            {hostField}
            {tokenField}
            <SettingsRow>
              <SettingsRowText title="Connection test" subtitle={mobileConnectStatusText ? <span className={mobileConnectStatusError ? "settings-help-error" : undefined}>{mobileConnectStatusText}</span> : "Make sure the desktop daemon is running and reachable on Tailscale, then retry."} />
              <SettingsButton type="button" onClick={onMobileConnectTest} disabled={mobileConnectBusy}>{mobileConnectBusy ? "Connecting…" : "Connect & test"}</SettingsButton>
            </SettingsRow>
          </SettingsGroup>
        </>
      ) : (
        <>
          <SettingsGroup title="Connect to a remote server" subtitle="Local keeps everything on this computer. Remote sends requests to the server below, the same way mobile clients connect.">
            <SettingsFieldRow title="Backend mode">
              <SettingsSelect
                value={appSettings.backendMode}
                onChange={(event) => void onUpdateAppSettings({ ...appSettings, backendMode: event.target.value as AppSettings["backendMode"] })}
              >
                <option value="local">Local (default)</option>
                <option value="remote">Remote (daemon)</option>
              </SettingsSelect>
            </SettingsFieldRow>
            {hostField}
            {tokenField}
            {tokenMissing && <SettingsCallout tone="warning">A token is required. Set one before connecting or letting devices connect to this computer.</SettingsCallout>}
          </SettingsGroup>
          <SettingsGroup title="Allow mobile connections" subtitle="Lets devices on your network connect to this computer with the host and token above.">
            <SettingsSwitchRow
              title="Keep daemon running after app closes"
              subtitle="When off, nucode stops its mobile daemon when you quit."
              pressed={appSettings.keepDaemonRunningAfterAppClose}
              onClick={() => void onUpdateAppSettings({ ...appSettings, keepDaemonRunningAfterAppClose: !appSettings.keepDaemonRunningAfterAppClose })}
            />
            <SettingsRow>
              <SettingsRowText
                title="Mobile access"
                subtitle={<><SettingsStatus tone={tcpStatusTone}>{tcpStatusLabel}</SettingsStatus>{" "}Lets devices on your network connect ({tcpAddress}). Start it before connecting from iOS.{tcpDaemonStatus?.startedAtMs ? ` Started ${new Date(tcpDaemonStatus.startedAtMs).toLocaleString()}.` : ""}</>}
              />
              <div className="settings-row-controls">
                <SettingsIconButton aria-label="Refresh status" title="Refresh status" onClick={() => { void onTcpDaemonStatus(); }} disabled={tcpDaemonBusyAction !== null}><RefreshCw aria-hidden className={tcpDaemonBusyAction === "status" ? "settings-spin" : undefined} /></SettingsIconButton>
                {tcpRunning
                  ? <SettingsButton type="button" onClick={() => { void onTcpDaemonStop(); }} disabled={tcpDaemonBusyAction !== null}>{tcpDaemonBusyAction === "stop" ? "Stopping…" : "Stop"}</SettingsButton>
                  : <SettingsButton type="button" className="primary" onClick={() => { void onTcpDaemonStart(); }} disabled={tcpDaemonBusyAction !== null}>{tcpDaemonBusyAction === "start" ? "Starting…" : "Start"}</SettingsButton>}
              </div>
            </SettingsRow>
            <SettingsRow className={tailscaleStatusError ? "is-disabled" : undefined}>
              <SettingsRowText
                title="Tailscale"
                subtitle={tailscaleStatusError ?? (tailscaleStatus ? <>{tailscaleStatus.message} {tailscaleStatus.installed ? `Version ${tailscaleStatus.version ?? "unknown"}.` : "Install Tailscale on both desktop and iOS to continue."}{tailscaleStatus.tailnetName && <> Tailnet: <code>{tailscaleStatus.tailnetName}</code>.</>}{tailscaleStatus.suggestedRemoteHost && <> Suggested host: <code>{tailscaleStatus.suggestedRemoteHost}</code>.</>}</> : "Finds this computer's Tailscale address so your phone can reach it.")}
              />
              <div className="settings-row-controls">
                {tailscaleStatus?.suggestedRemoteHost && <SettingsButton type="button" onClick={() => { void onUseSuggestedTailscaleHost(); }}>Use host</SettingsButton>}
                <SettingsButton type="button" onClick={onRefreshTailscaleStatus} disabled={tailscaleStatusBusy}>{tailscaleStatusBusy ? "Checking…" : "Detect"}</SettingsButton>
              </div>
            </SettingsRow>
            <SettingsFieldRow
              stacked
              title="Command to start the daemon by hand"
              subtitle={tailscaleCommandError ? <span className="settings-help-error">{tailscaleCommandError}</span> : tailscaleCommandPreview && !tailscaleCommandPreview.tokenConfigured ? <span className="settings-help-error">The token is empty. Set one before exposing daemon access.</span> : "A fallback if Start does not work."}
            >
              {tailscaleCommandPreview
                ? <div className="settings-command-block"><pre className="settings-command-preview"><code>{tailscaleCommandPreview.command}</code></pre><SettingsIconButton aria-label="Copy command" title="Copy command" onClick={() => copyCommand(tailscaleCommandPreview.command)}><Copy aria-hidden /></SettingsIconButton></div>
                : <div className="settings-field-actions"><SettingsButton type="button" onClick={onRefreshTailscaleCommandPreview} disabled={tailscaleCommandBusy}>{tailscaleCommandBusy ? "Loading…" : "Show command"}</SettingsButton></div>}
            </SettingsFieldRow>
          </SettingsGroup>
        </>
      )}
      <p className="settings-footnote">{isMobileSimplified ? "Use your own infrastructure only. On iOS, get the Tailscale hostname and token from your desktop nucode setup." : "Keep mobile access on your own network (for example your tailnet). nucode does not provide hosted backend services."}</p>
      {addRemoteOpen && (
        <ModalShell
          className="settings-add-remote-overlay"
          cardClassName="settings-add-remote-card"
          onBackdropClick={closeAddRemoteModal}
          ariaLabel="Add remote"
        >
          <div className="settings-add-remote-header">
            <div className="settings-add-remote-title">Add remote</div>
            <SettingsIconButton
              type="button"
              className="ghost settings-add-remote-close"
              onClick={closeAddRemoteModal}
              aria-label="Close add remote modal"
              disabled={addRemoteBusy}
            >
              <X aria-hidden />
            </SettingsIconButton>
          </div>
          <SettingsRow className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-name">
              New remote name
            </label>
            <SettingsTextField
              id="settings-add-remote-name"
              className="settings-input settings-input--compact"
              value={addRemoteNameDraft}
              onChange={(event) => setAddRemoteNameDraft(event.target.value)}
              disabled={addRemoteBusy}
            />
          </SettingsRow>
          <SettingsRow className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-host">
              New remote host
            </label>
            <SettingsTextField
              id="settings-add-remote-host"
              className="settings-input settings-input--compact"
              value={addRemoteHostDraft}
              placeholder="macbook.your-tailnet.ts.net:4732"
              onChange={(event) => setAddRemoteHostDraft(event.target.value)}
              disabled={addRemoteBusy}
            />
          </SettingsRow>
          <SettingsRow className="settings-field">
            <label className="settings-field-label" htmlFor="settings-add-remote-token">
              New remote token
            </label>
            <SettingsTextField
              id="settings-add-remote-token"
              type="password"
              className="settings-input settings-input--compact"
              value={addRemoteTokenDraft}
              placeholder="Token"
              onChange={(event) => setAddRemoteTokenDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddRemoteConfirm();
                }
              }}
              disabled={addRemoteBusy}
            />
          </SettingsRow>
          {addRemoteError && <div className="settings-help settings-help-error">{addRemoteError}</div>}
          <div className="settings-add-remote-actions">
            <SettingsButton type="button" className="ghost" onClick={closeAddRemoteModal} disabled={addRemoteBusy}>
              Cancel
            </SettingsButton>
            <SettingsButton
              type="button"
              className="primary"
              onClick={handleAddRemoteConfirm}
              disabled={addRemoteBusy}
            >
              {addRemoteBusy ? "Connecting..." : "Connect & add"}
            </SettingsButton>
          </div>
        </ModalShell>
      )}
      {pendingDeleteRemote && (
        <ModalShell
          className="settings-delete-remote-overlay"
          cardClassName="settings-delete-remote-card"
          onBackdropClick={() => setPendingDeleteRemoteId(null)}
          ariaLabel="Delete remote confirmation"
        >
          <div className="settings-delete-remote-title">Delete remote?</div>
          <div className="settings-delete-remote-message">
            Remove <strong>{pendingDeleteRemote.name}</strong> from saved remotes? This only
            removes the profile from this device.
          </div>
          <div className="settings-delete-remote-actions">
            <SettingsButton
              type="button"
              className="ghost"
              onClick={() => setPendingDeleteRemoteId(null)}
            >
              Cancel
            </SettingsButton>
            <SettingsButton
              type="button"
              className="danger"
              onClick={() => {
                void onDeleteRemoteBackend(pendingDeleteRemote.id);
                setPendingDeleteRemoteId(null);
              }}
            >
              Delete remote
            </SettingsButton>
          </div>
        </ModalShell>
      )}
    </SettingsPage>
  );
}
