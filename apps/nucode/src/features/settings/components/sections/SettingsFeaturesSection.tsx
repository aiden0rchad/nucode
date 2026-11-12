import { SettingsButton, SettingsSelect, SettingsPage, SettingsGroup, SettingsToggleRow, SettingsSwitchRow, SettingsCallout } from "@/features/design-system/components/settings/SettingsPrimitives";
import type { CodexFeature } from "@/types";
import type { SettingsFeaturesSectionProps } from "@settings/hooks/useSettingsFeaturesSection";
import { fileManagerName, openInFileManagerLabel } from "@utils/platformPaths";

const FEATURE_DESCRIPTION_FALLBACKS: Record<string, string> = {
  undo: "Create a ghost commit at each turn.",
  shell_tool: "Enable the default shell tool.",
  unified_exec: "Use the single unified PTY-backed exec tool.",
  shell_snapshot: "Enable shell snapshotting.",
  js_repl: "Enable JavaScript REPL tools backed by a persistent Node kernel.",
  js_repl_tools_only: "Only expose js_repl tools directly to the model.",
  web_search_request: "Deprecated. Use top-level web_search instead.",
  web_search_cached: "Deprecated. Use top-level web_search instead.",
  search_tool: "Removed legacy search flag kept for backward compatibility.",
  runtime_metrics: "Enable runtime metrics snapshots via a manual reader.",
  sqlite: "Persist rollout metadata to a local SQLite database.",
  memory_tool: "Enable startup memory extraction and memory consolidation.",
  child_agents_md: "Append additional AGENTS.md guidance to user instructions.",
  apply_patch_freeform: "Include the freeform apply_patch tool.",
  use_linux_sandbox_bwrap: "Use the bubblewrap-based Linux sandbox pipeline.",
  request_rule: "Allow approval requests and exec rule proposals.",
  experimental_windows_sandbox:
    "Removed Windows sandbox flag kept for backward compatibility.",
  elevated_windows_sandbox:
    "Removed elevated Windows sandbox flag kept for backward compatibility.",
  remote_models: "Refresh remote models before AppReady.",
  powershell_utf8: "Enforce UTF-8 output in PowerShell.",
  enable_request_compression:
    "Compress streaming request bodies sent to codex-backend.",

  apps_mcp_gateway: "Route Apps MCP calls through the configured gateway.",
  skill_mcp_dependency_install:
    "Allow prompting and installing missing MCP dependencies.",
  skill_env_var_dependency_prompt:
    "Prompt for missing skill environment variable dependencies.",
  steer: "Enable turn steering capability when supported by Codex.",
  collaboration_modes: "Enable collaboration mode presets.",
  personality: "Enable personality selection.",
  responses_websockets:
    "Use Responses API WebSocket transport for OpenAI by default.",
  responses_websockets_v2: "Enable Responses API WebSocket v2 mode.",
};

function formatFeatureLabel(feature: CodexFeature): string {
  const displayName = feature.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return feature.name
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function featureSubtitle(feature: CodexFeature): string {
  if (feature.description?.trim()) {
    return feature.description;
  }
  if (feature.announcement?.trim()) {
    return feature.announcement;
  }
  const fallbackDescription = FEATURE_DESCRIPTION_FALLBACKS[feature.name];
  if (fallbackDescription) {
    return fallbackDescription;
  }
  if (feature.stage === "deprecated") {
    return "Deprecated feature flag.";
  }
  if (feature.stage === "removed") {
    return "Legacy feature flag kept for backward compatibility.";
  }
  return `Feature key: features.${feature.name}`;
}

export function SettingsFeaturesSection({
  appSettings,
  hasFeatureWorkspace,
  openConfigError,
  featureError,
  featuresLoading,
  featureUpdatingKey,
  stableFeatures,
  experimentalFeatures,
  hasDynamicFeatureRows,
  onOpenConfig,
  onToggleCodexFeature,
  onUpdateAppSettings,
}: SettingsFeaturesSectionProps) {
  const featureRow = (feature: CodexFeature) => (
    <SettingsSwitchRow
      key={feature.name}
      title={formatFeatureLabel(feature)}
      subtitle={featureSubtitle(feature)}
      pressed={feature.enabled}
      onClick={() => onToggleCodexFeature(feature)}
      disabled={featureUpdatingKey === feature.name}
    />
  );
  const note = (text: string) => <div className="settings-card-block">{text}</div>;
  return (
    <SettingsPage
      title="Codex flags"
      subtitle="Turn Codex features on or off. These flags are written to the Codex config file."
    >
      <SettingsGroup title="Stable" subtitle="Ready to use and on by default.">
        <SettingsToggleRow
          title="Config file"
          subtitle={`Open the Codex config in ${fileManagerName()}.`}
        >
          <SettingsButton type="button" onClick={onOpenConfig}>
            {openInFileManagerLabel()}
          </SettingsButton>
        </SettingsToggleRow>
        {openConfigError && <SettingsCallout tone="error">{openConfigError}</SettingsCallout>}
        <SettingsToggleRow
          title="Personality"
          subtitle={<>How Codex talks to you (written to <code>personality</code> in config.toml).</>}
        >
          <SettingsSelect
            id="features-personality-select"
            value={appSettings.personality}
            onChange={(event) =>
              void onUpdateAppSettings({
                ...appSettings,
                personality: event.target.value as (typeof appSettings)["personality"],
              })
            }
            aria-label="Personality"
          >
            <option value="friendly">Friendly</option>
            <option value="pragmatic">Pragmatic</option>
          </SettingsSelect>
        </SettingsToggleRow>
        <SettingsSwitchRow
          title="Pause queued messages when a response is required"
          subtitle="Queued messages wait while Codex needs you to accept a plan or answer a question."
          pressed={appSettings.pauseQueuedMessagesWhenResponseRequired}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              pauseQueuedMessagesWhenResponseRequired:
                !appSettings.pauseQueuedMessagesWhenResponseRequired,
            })
          }
        />
        {stableFeatures.map(featureRow)}
        {hasFeatureWorkspace && !featuresLoading && !featureError && stableFeatures.length === 0 && note("Codex returned no stable feature flags.")}
      </SettingsGroup>
      {(experimentalFeatures.length > 0 || featuresLoading || !hasFeatureWorkspace || !!featureError || (hasFeatureWorkspace && hasDynamicFeatureRows)) && <SettingsGroup title="Experimental" subtitle="Previews and features still in development.">
        {experimentalFeatures.map(featureRow)}
        {hasFeatureWorkspace && !featuresLoading && !featureError && hasDynamicFeatureRows && experimentalFeatures.length === 0 && note("Codex returned no experimental feature flags.")}
        {featuresLoading && note("Loading Codex feature flags…")}
        {!hasFeatureWorkspace && !featuresLoading && note("Open a project to load Codex feature flags.")}
        {featureError && <SettingsCallout tone="error">{featureError}</SettingsCallout>}
      </SettingsGroup>}
    </SettingsPage>
  );
}
