import { SettingsBadge, SettingsButton, SettingsCallout, SettingsEmpty, SettingsFieldRow, SettingsGroup, SettingsIconButton, SettingsListRow, SettingsPage, SettingsRow, SettingsRowText, SettingsSelect, SettingsStatus, SettingsSwitchRow, SettingsTextField } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useEffect, useMemo, useState } from "react";
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
  const [generated, setGenerated] = useState<string | null>(null);
  // Commit a generated token once the draft state holds it, so the existing commit handler sees it.
  useEffect(() => {
    if (generated !== null && remoteTokenDraft === generated) { setGenerated(null); void onCommitRemoteToken(); }
  }, [generated, remoteTokenDraft, onCommitRemoteToken]);
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
      <div className="settings-field-actions">
        <SettingsButton type="button" onClick={() => { const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); setGenerated(token); onSetRemoteTokenDraft(token); }}>Generate</SettingsButton>
        <SettingsTextField
          type="password"
          value={remoteTokenDraft}
          placeholder="Token"
          onChange={(event) => onSetRemoteTokenDraft(event.target.value)}
          onBlur={() => { void onCommitRemoteToken(); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onCommitRemoteToken(); } }}
          aria-label="Remote backend token"
        />
      </div>
    </SettingsFieldRow>
  );
  const hostInput = (
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
  );
  const portAt = remoteHostDraft.lastIndexOf(":");
  // In Local mode only the port of the stored host is used, so the field edits just that part.
  const portInput = (
    <SettingsTextField
      identifier
      className="is-mono is-short"
      inputMode="numeric"
      value={portAt >= 0 ? remoteHostDraft.slice(portAt + 1) : ""}
      placeholder="4732"
      onChange={(event) => onSetRemoteHostDraft(`${portAt >= 0 ? remoteHostDraft.slice(0, portAt) : remoteHostDraft || "127.0.0.1"}:${event.target.value.replace(/\D/g, "")}`)}
      onBlur={() => { void onCommitRemoteHost(); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onCommitRemoteHost(); } }}
      aria-label="Listening port"
    />
  );
  const generateToken = () => { const bytes = new Uint8Array(24); crypto.getRandomValues(bytes); const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); setGenerated(token); onSetRemoteTokenDraft(token); };
  const tokenInput = (placeholder: string, generate = false) => {
    const input = <SettingsTextField
      type="password"
      className={generate ? "is-fill is-mono" : undefined}
      value={remoteTokenDraft}
      placeholder={placeholder}
      onChange={(event) => onSetRemoteTokenDraft(event.target.value)}
      onBlur={() => { void onCommitRemoteToken(); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onCommitRemoteToken(); } }}
      aria-label="Remote backend token"
    />;
    return generate ? <div className="settings-field-actions">{input}<SettingsButton type="button" onClick={generateToken}>Generate</SettingsButton></div> : input;
  };
  const remote = appSettings.backendMode === "remote";
  const suggested = tailscaleStatus?.suggestedRemoteHost ?? null;
  const listenPort = (tcpDaemonStatus?.listenAddr ?? remoteHostDraft).split(":").pop();
  const tokenMissing = !remoteTokenDraft.trim();
  const hasSavedToken = !!appSettings.remoteBackendToken?.trim();
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
          <SettingsGroup title="Where nucode runs">
            <SettingsFieldRow title="Backend mode" subtitle={appSettings.backendMode === "remote" ? "Requests go to the server set below." : "Everything runs on this computer."}>
              <SettingsSelect
                value={appSettings.backendMode}
                onChange={(event) => void onUpdateAppSettings({ ...appSettings, backendMode: event.target.value as AppSettings["backendMode"] })}
              >
                <option value="local">Local</option>
                <option value="remote">Remote (daemon)</option>
              </SettingsSelect>
            </SettingsFieldRow>
            {remote && <>
              <SettingsFieldRow title="Server address" subtitle={remoteHostError ? <span className="settings-help-error">{remoteHostError}</span> : "The computer to connect to, as host:port."}>{hostInput}</SettingsFieldRow>
              <SettingsFieldRow title="Server token">{tokenInput("Paste the server's token")}</SettingsFieldRow>
              {tokenMissing && <SettingsCallout tone="warning">Paste the server's token to connect.</SettingsCallout>}
            </>}
          </SettingsGroup>
          <SettingsGroup title="Phone access" subtitle="Let the nucode mobile app connect to this computer.">
            {remote
              ? <SettingsRow><SettingsRowText title="Access token and port" subtitle="Phone access uses the server token and port set above." /></SettingsRow>
              : <>
                <SettingsFieldRow stacked title="Access token" subtitle="Your phone signs in with this token.">{tokenInput("Paste or generate a token", true)}</SettingsFieldRow>
                <SettingsFieldRow title="Listening port" subtitle={remoteHostError ? <span className="settings-help-error">{remoteHostError}</span> : "This computer listens on this port on every network interface."}>{portInput}</SettingsFieldRow>
              </>}
            <SettingsRow>
              <div className="settings-row-text">
                <div className="settings-toggle-title settings-title-with-status">Status <SettingsStatus tone={tcpStatusTone} className="settings-status-pill">{tcpStatusLabel}</SettingsStatus></div>
                <div className="settings-toggle-subtitle">{tcpDaemonStatus?.state === "error" ? (tcpDaemonStatus.lastError ?? "Error") : !hasSavedToken ? "Set an access token to start" : tcpRunning ? `Listening on port ${listenPort}` : "Not running"}</div>
              </div>
              <div className="settings-row-controls">
                <SettingsIconButton aria-label="Refresh status" title="Refresh status" onClick={() => { void onTcpDaemonStatus(); }} disabled={tcpDaemonBusyAction !== null}><RefreshCw aria-hidden className={tcpDaemonBusyAction === "status" ? "settings-spin" : undefined} /></SettingsIconButton>
                {tcpRunning
                  ? <SettingsButton type="button" onClick={() => { void onTcpDaemonStop(); }} disabled={tcpDaemonBusyAction !== null}>{tcpDaemonBusyAction === "stop" ? "Stopping…" : "Stop"}</SettingsButton>
                  : <SettingsButton type="button" className="primary" title={!hasSavedToken ? "Set an access token to start" : undefined} onClick={() => { void onTcpDaemonStart(); }} disabled={tcpDaemonBusyAction !== null || !hasSavedToken}>{tcpDaemonBusyAction === "start" ? "Starting…" : "Start"}</SettingsButton>}
              </div>
            </SettingsRow>
            <SettingsFieldRow stacked title="Phone connects to" subtitle={suggested ? "Enter this address and the access token in the mobile app." : "Install Tailscale and sign in, then check again to get an address your phone can reach."}>
              {suggested && <div className="settings-command-block"><pre className="settings-command-preview"><code>{suggested}</code></pre><SettingsIconButton aria-label="Copy address" title="Copy address" onClick={() => copyCommand(suggested)}><Copy aria-hidden /></SettingsIconButton></div>}
            </SettingsFieldRow>
            <SettingsRow>
              <SettingsRowText
                title="Tailscale"
                subtitle={tailscaleStatusError ? <SettingsStatus tone="error">{tailscaleStatusError}</SettingsStatus> : tailscaleStatus ? <SettingsStatus tone={tailscaleStatus.installed ? "ready" : "idle"}>{tailscaleStatus.installed ? [tailscaleStatus.running ? "Running" : "Not running", tailscaleStatus.version ? `v${tailscaleStatus.version}` : null, tailscaleStatus.tailnetName].filter(Boolean).join(" · ") : "Not installed"}</SettingsStatus> : <SettingsStatus>Not checked yet</SettingsStatus>}
              />
              <SettingsButton type="button" onClick={onRefreshTailscaleStatus} disabled={tailscaleStatusBusy}>{tailscaleStatusBusy ? "Checking…" : "Check again"}</SettingsButton>
            </SettingsRow>
            <SettingsSwitchRow
              title="Keep running after the app closes"
              subtitle="After you start phone access, keep it running when nucode quits."
              pressed={appSettings.keepDaemonRunningAfterAppClose}
              onClick={() => void onUpdateAppSettings({ ...appSettings, keepDaemonRunningAfterAppClose: !appSettings.keepDaemonRunningAfterAppClose })}
            />
            <SettingsFieldRow
              stacked
              title="Start by hand"
              subtitle={tailscaleCommandError ? <span className="settings-help-error">{tailscaleCommandError}</span> : "A fallback if Start does not work."}
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
