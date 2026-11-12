import { SettingsButton, SettingsCallout, SettingsGroup, SettingsListRow, SettingsStatus } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useEffect, useState } from "react";
import { engineRuntime, type EngineRuntimeStatus } from "@services/tauri";

const runtimeName = (engine: string) => engine === "claude" ? "Claude Code" : engine === "computer" ? "Computer Use" : engine === "browser" ? "Browser" : engine;

export function SettingsRuntimeSetup({ engine, onManage }: { engine?: string; onManage?: () => void }) {
  const [runtimes, setRuntimes] = useState<EngineRuntimeStatus[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const value = await engineRuntime("status"); if (active) setRuntimes(value); }
      catch (e) { if (active) setError(String(e)); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const prepare = async (engine: string) => {
    setBusy(engine); setError("");
    try { setRuntimes(await engineRuntime("prepare", engine)); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  };
  const shown = engine ? runtimes.filter(runtime => runtime.engine === engine) : runtimes;
  return <SettingsGroup title={engine ? "Runtime" : "Engine runtimes"} subtitle={engine ? "The tools this feature installs on first use." : "Dependencies install into the app's data folder on first use."}>
    {shown.map(runtime => {
      const installing = busy === runtime.engine || ["preparing", "installing"].includes(runtime.state);
      const status = installing ? "Installing" : runtime.state === "ready" ? "Ready" : runtime.state === "error" ? "Error" : "Missing";
      const tone = installing ? "busy" : status === "Ready" ? "ready" : status === "Error" ? "error" : "idle";
      return <SettingsListRow key={runtime.engine} aria-busy={installing} title={runtimeName(runtime.engine)} badge={<SettingsStatus tone={tone} role="status" title={runtime.message}>{status}</SettingsStatus>} meta={runtime.message.replace(/^Mock /i, "")}>
        {engine ? <SettingsButton onClick={onManage}>Manage</SettingsButton> : <SettingsButton disabled={busy !== null || installing} onClick={() => void prepare(runtime.engine)}>{busy === runtime.engine ? "Preparing…" : `Set up ${runtime.engine}`}</SettingsButton>}
      </SettingsListRow>;
    })}
    {engine && !shown.length && <SettingsListRow title={runtimeName(engine)} meta="Checking runtime…"><SettingsButton onClick={onManage}>Manage</SettingsButton></SettingsListRow>}
    {error && <SettingsCallout tone="error">{error}</SettingsCallout>}
  </SettingsGroup>;
}
