import { SettingsButton, SettingsCallout, SettingsToggleRow, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";
import type { WorkspaceInfo, WorkspaceSettings } from "@/types";
import { useCodegraphStatus } from "@settings/hooks/useCodegraphStatus";

type Props = {
  workspace: WorkspaceInfo;
  globalEnabled: boolean;
  onUpdate: (id: string, settings: Partial<WorkspaceSettings>) => Promise<void>;
};

export function CodegraphProjectSettings({ workspace, globalEnabled, onUpdate }: Props) {
  const registryOverride = workspace.settings.mcpServers?.find(s => s.id === "codegraph");
  const override = registryOverride?.enabled ?? workspace.settings.codegraphEnabled;
  const enabled = registryOverride?.enabled ?? (globalEnabled && (override ?? true));
  const update = (enabled: boolean | null) => onUpdate(workspace.id, { codegraphEnabled: enabled, ...(registryOverride ? { mcpServers: [...(workspace.settings.mcpServers ?? []).filter(s => s.id !== "codegraph"), ...(enabled === null ? [] : [{ id: "codegraph", enabled }])] } : {}) });
  const { status, error, busy, run, rebuild } = useCodegraphStatus(workspace.id, globalEnabled, override);
  return <>
    <SettingsToggleRow title="CodeGraph" subtitle={<><span role="status">{!enabled ? "disabled" : status ? `${status.state}: ${status.detail}` : "Loading CodeGraph status…"}</span>. Changes apply the next time the engine starts.</>}>
      <div className="settings-row-controls">
        <SettingsButton type="button" disabled={busy || !enabled || status?.state === "indexing"}
          onClick={() => void rebuild()}>Rebuild index</SettingsButton>
        {override != null && <SettingsButton type="button" className="ghost" disabled={busy}
          onClick={() => void run(() => update(null))}>Use app setting</SettingsButton>}
        <SettingsToggleSwitch aria-label={`CodeGraph for ${workspace.name}`} pressed={enabled}
          disabled={(!globalEnabled && !registryOverride) || busy}
          onClick={() => void run(() => update(!enabled))} />
      </div>
    </SettingsToggleRow>
    {error && <SettingsCallout tone="error">{error}</SettingsCallout>}
  </>;
}
