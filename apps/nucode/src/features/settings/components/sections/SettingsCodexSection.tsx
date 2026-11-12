import { SettingsButton, SettingsCallout, SettingsFieldRow, SettingsGroup, SettingsPage, SettingsSelect, SettingsSwitchRow, SettingsTextField } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useEffect, useMemo, useRef } from "react";
import Stethoscope from "lucide-react/dist/esm/icons/stethoscope";
import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  CodexDoctorResult,
  CodexUpdateResult,
  ModelOption,
} from "@/types";
import { FileEditorCard } from "@/features/shared/components/FileEditorCard";

type SettingsCodexSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  defaultModels: ModelOption[];
  defaultModelsLoading: boolean;
  defaultModelsError: string | null;
  defaultModelsConnectedWorkspaceCount: number;
  onRefreshDefaultModels: () => void;
  codexPathDraft: string;
  codexArgsDraft: string;
  codexDirty: boolean;
  isSavingSettings: boolean;
  doctorState: {
    status: "idle" | "running" | "done";
    result: CodexDoctorResult | null;
  };
  codexUpdateState: {
    status: "idle" | "running" | "done";
    result: CodexUpdateResult | null;
  };
  globalAgentsMeta: string;
  globalAgentsError: string | null;
  globalAgentsContent: string;
  globalAgentsLoading: boolean;
  globalAgentsRefreshDisabled: boolean;
  globalAgentsSaveDisabled: boolean;
  globalAgentsSaveLabel: string;
  globalConfigMeta: string;
  globalConfigError: string | null;
  globalConfigContent: string;
  globalConfigLoading: boolean;
  globalConfigRefreshDisabled: boolean;
  globalConfigSaveDisabled: boolean;
  globalConfigSaveLabel: string;
  onSetCodexPathDraft: Dispatch<SetStateAction<string>>;
  onSetCodexArgsDraft: Dispatch<SetStateAction<string>>;
  onSetGlobalAgentsContent: (value: string) => void;
  onSetGlobalConfigContent: (value: string) => void;
  onBrowseCodex: () => Promise<void>;
  onSaveCodexSettings: () => Promise<void>;
  onRunDoctor: () => Promise<void>;
  onRunCodexUpdate: () => Promise<void>;
  onRefreshGlobalAgents: () => void;
  onSaveGlobalAgents: () => void;
  onRefreshGlobalConfig: () => void;
  onSaveGlobalConfig: () => void;
};

const DEFAULT_REASONING_EFFORT = "medium";

const normalizeEffortValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
};

function coerceSavedModelSlug(value: string | null, models: ModelOption[]): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const bySlug = models.find((model) => model.model === trimmed);
  if (bySlug) {
    return bySlug.model;
  }
  const byId = models.find((model) => model.id === trimmed);
  return byId ? byId.model : null;
}

const getReasoningSupport = (model: ModelOption | null): boolean => {
  if (!model) {
    return false;
  }
  return model.supportedReasoningEfforts.length > 0 || model.defaultReasoningEffort !== null;
};

const getReasoningOptions = (model: ModelOption | null): string[] => {
  if (!model) {
    return [];
  }
  const supported = model.supportedReasoningEfforts
    .map((effort) => normalizeEffortValue(effort.reasoningEffort))
    .filter((effort): effort is string => Boolean(effort));
  if (supported.length > 0) {
    return Array.from(new Set(supported));
  }
  const fallback = normalizeEffortValue(model.defaultReasoningEffort);
  return fallback ? [fallback] : [];
};

export function SettingsCodexSection({
  appSettings,
  onUpdateAppSettings,
  defaultModels,
  defaultModelsLoading,
  defaultModelsError,
  defaultModelsConnectedWorkspaceCount,
  onRefreshDefaultModels,
  codexPathDraft,
  codexArgsDraft,
  codexDirty,
  isSavingSettings,
  doctorState,
  codexUpdateState,
  globalAgentsMeta,
  globalAgentsError,
  globalAgentsContent,
  globalAgentsLoading,
  globalAgentsRefreshDisabled,
  globalAgentsSaveDisabled,
  globalAgentsSaveLabel,
  globalConfigMeta,
  globalConfigError,
  globalConfigContent,
  globalConfigLoading,
  globalConfigRefreshDisabled,
  globalConfigSaveDisabled,
  globalConfigSaveLabel,
  onSetCodexPathDraft,
  onSetCodexArgsDraft,
  onSetGlobalAgentsContent,
  onSetGlobalConfigContent,
  onBrowseCodex,
  onSaveCodexSettings,
  onRunDoctor,
  onRunCodexUpdate,
  onRefreshGlobalAgents,
  onSaveGlobalAgents,
  onRefreshGlobalConfig,
  onSaveGlobalConfig,
}: SettingsCodexSectionProps) {
  const latestModelSlug = defaultModels[0]?.model ?? null;
  const savedModelSlug = useMemo(
    () => coerceSavedModelSlug(appSettings.lastComposerModelId, defaultModels),
    [appSettings.lastComposerModelId, defaultModels],
  );
  const selectedModelSlug = savedModelSlug ?? latestModelSlug ?? "";
  const selectedModel = useMemo(
    () => defaultModels.find((model) => model.model === selectedModelSlug) ?? null,
    [defaultModels, selectedModelSlug],
  );
  const reasoningSupported = useMemo(
    () => getReasoningSupport(selectedModel),
    [selectedModel],
  );
  const reasoningOptions = useMemo(
    () => getReasoningOptions(selectedModel),
    [selectedModel],
  );
  const savedEffort = useMemo(
    () => normalizeEffortValue(appSettings.lastComposerReasoningEffort),
    [appSettings.lastComposerReasoningEffort],
  );
  const selectedEffort = useMemo(() => {
    if (!reasoningSupported) {
      return "";
    }
    if (savedEffort && reasoningOptions.includes(savedEffort)) {
      return savedEffort;
    }
    if (reasoningOptions.includes(DEFAULT_REASONING_EFFORT)) {
      return DEFAULT_REASONING_EFFORT;
    }
    const fallback = normalizeEffortValue(selectedModel?.defaultReasoningEffort);
    if (fallback && reasoningOptions.includes(fallback)) {
      return fallback;
    }
    return reasoningOptions[0] ?? "";
  }, [reasoningOptions, reasoningSupported, savedEffort, selectedModel]);

  const didNormalizeDefaultsRef = useRef(false);
  useEffect(() => {
    if (didNormalizeDefaultsRef.current) {
      return;
    }
    if (!defaultModels.length) {
      return;
    }
    const savedRawModel = (appSettings.lastComposerModelId ?? "").trim();
    const savedRawEffort = (appSettings.lastComposerReasoningEffort ?? "").trim();
    const shouldNormalizeModel = savedRawModel.length === 0 || savedModelSlug === null;
    const shouldNormalizeEffort =
      reasoningSupported &&
      (savedRawEffort.length === 0 ||
        savedEffort === null ||
        !reasoningOptions.includes(savedEffort));
    if (!shouldNormalizeModel && !shouldNormalizeEffort) {
      didNormalizeDefaultsRef.current = true;
      return;
    }

    const next: AppSettings = {
      ...appSettings,
      lastComposerModelId: shouldNormalizeModel ? selectedModelSlug : appSettings.lastComposerModelId,
      lastComposerReasoningEffort: shouldNormalizeEffort
        ? selectedEffort
        : appSettings.lastComposerReasoningEffort,
    };
    didNormalizeDefaultsRef.current = true;
    void onUpdateAppSettings(next);
  }, [
    appSettings,
    defaultModels.length,
    onUpdateAppSettings,
    reasoningOptions,
    reasoningSupported,
    savedEffort,
    savedModelSlug,
    selectedModelSlug,
    selectedEffort,
  ]);

  const codegraphOn = appSettings.mcpServers?.find(s => s.id === "codegraph")?.enabled ?? appSettings.codegraphEnabled ?? true;
  const editorClasses = {
    container: "settings-file-editor",
    header: "settings-file-editor-header",
    title: "settings-toggle-title",
    actions: "settings-file-editor-actions",
    meta: "settings-toggle-subtitle",
    iconButton: "ds-icon-button ds-icon-button--ghost settings-icon-button",
    error: "settings-callout is-error",
    textarea: "settings-textarea is-mono",
    help: "settings-toggle-subtitle",
  };
  const doctor = doctorState.result;
  const update = codexUpdateState.result;
  return (
    <SettingsPage
      title="Codex"
      subtitle="The Codex CLI that nucode runs, and the defaults it starts with."
      actions={codexDirty ? <SettingsButton type="button" className="primary lg" onClick={() => { void onSaveCodexSettings(); }} disabled={isSavingSettings}>{isSavingSettings ? "Saving…" : "Save changes"}</SettingsButton> : undefined}
    >
      <SettingsGroup
        title="Codex CLI"
        subtitle="Applies to the shared Codex app-server used by every connected project."
        actions={<>
          <SettingsButton type="button" onClick={() => { void onRunDoctor(); }} disabled={doctorState.status === "running"}>
            <Stethoscope aria-hidden />
            {doctorState.status === "running" ? "Running…" : "Run doctor"}
          </SettingsButton>
          <SettingsButton type="button" onClick={() => { void onRunCodexUpdate(); }} disabled={codexUpdateState.status === "running"} title="Update Codex">
            {codexUpdateState.status === "running" ? "Updating…" : "Update"}
          </SettingsButton>
        </>}
      >
        <SettingsFieldRow stacked title="Default Codex path" subtitle="Leave empty to find codex on your PATH.">
          <div className="settings-field-actions">
            <SettingsTextField className="is-fill is-mono" value={codexPathDraft} placeholder="codex" onChange={(event) => onSetCodexPathDraft(event.target.value)} />
            <SettingsButton type="button" onClick={() => { void onBrowseCodex(); }}>Browse…</SettingsButton>
            <SettingsButton type="button" className="ghost" onClick={() => onSetCodexPathDraft("")}>Use PATH</SettingsButton>
          </div>
        </SettingsFieldRow>
        <SettingsFieldRow stacked title="Default Codex args" subtitle={<>Extra flags passed before <code>app-server</code>. Use quotes for values with spaces. Per-thread overrides ignore <code>-m</code>, <code>-a</code>, <code>-s</code>, <code>--full-auto</code>, <code>--dangerously-bypass-approvals-and-sandbox</code>, <code>--oss</code>, <code>--local-provider</code> and <code>--no-alt-screen</code>.</>}>
          <div className="settings-field-actions">
            <SettingsTextField className="is-fill is-mono" value={codexArgsDraft} placeholder="--profile personal" onChange={(event) => onSetCodexArgsDraft(event.target.value)} />
            <SettingsButton type="button" className="ghost" onClick={() => onSetCodexArgsDraft("")}>Clear</SettingsButton>
          </div>
        </SettingsFieldRow>
        {doctor && (
          <SettingsCallout tone={doctor.ok ? "info" : "error"}>
            <strong>{doctor.ok ? "Codex looks good" : "Codex issue detected"}</strong>
            <div>Version: {doctor.version ?? "unknown"} · App-server: {doctor.appServerOk ? "ok" : "failed"} · Node: {doctor.nodeOk ? `ok (${doctor.nodeVersion ?? "unknown"})` : "missing"}</div>
            {doctor.details && <div>{doctor.details}</div>}
            {doctor.nodeDetails && <div>{doctor.nodeDetails}</div>}
            {doctor.path && <div className="settings-doctor-path">PATH: {doctor.path}</div>}
          </SettingsCallout>
        )}
        {update && (
          <SettingsCallout tone={update.ok ? "info" : "error"}>
            <strong>{update.ok ? (update.upgraded ? "Codex updated" : "Codex already up-to-date") : "Codex update failed"}</strong>
            <div>Method: {update.method}{update.package ? ` · Package: ${update.package}` : ""} · Version: {update.afterVersion ?? update.beforeVersion ?? "unknown"}</div>
            {update.details && <div>{update.details}</div>}
            {update.output && <details><summary>output</summary><pre>{update.output}</pre></details>}
          </SettingsCallout>
        )}
      </SettingsGroup>
      <SettingsGroup title="Defaults" subtitle="Used when a thread has no setting of its own.">
        <SettingsFieldRow
          title="Model"
          subtitle={
            defaultModelsConnectedWorkspaceCount === 0
              ? "Add a project to load available models."
              : defaultModelsLoading
                ? "Loading models from the first project…"
                : defaultModelsError
                  ? `Couldn’t load models: ${defaultModelsError}`
                  : "Models come from the first connected project."
          }
        >
          <div className="settings-field-actions">
            <SettingsSelect
              value={selectedModelSlug}
              disabled={!defaultModels.length || defaultModelsLoading}
              onChange={(event) => void onUpdateAppSettings({ ...appSettings, lastComposerModelId: event.target.value })}
              aria-label="Model"
            >
              {defaultModels.map((model) => (
                <option key={model.model} value={model.model}>{model.displayName?.trim() || model.model}</option>
              ))}
            </SettingsSelect>
            <SettingsButton type="button" onClick={onRefreshDefaultModels} disabled={defaultModelsLoading || defaultModelsConnectedWorkspaceCount === 0}>Refresh</SettingsButton>
          </div>
        </SettingsFieldRow>
        <SettingsFieldRow title="Reasoning effort" subtitle={reasoningSupported ? "The options depend on the selected model." : "The selected model has no reasoning effort options."}>
          <SettingsSelect
            value={selectedEffort}
            onChange={(event) => void onUpdateAppSettings({ ...appSettings, lastComposerReasoningEffort: event.target.value })}
            aria-label="Reasoning effort"
            disabled={!reasoningSupported}
          >
            {!reasoningSupported && <option value="">not supported</option>}
            {reasoningOptions.map((effort) => (
              <option key={effort} value={effort}>{effort}</option>
            ))}
          </SettingsSelect>
        </SettingsFieldRow>
        <SettingsFieldRow title="Access mode">
          <SettingsSelect
            value={appSettings.defaultAccessMode}
            onChange={(event) => void onUpdateAppSettings({ ...appSettings, defaultAccessMode: event.target.value as AppSettings["defaultAccessMode"] })}
          >
            <option value="read-only">Read only</option>
            <option value="current">On-request</option>
            <option value="full-access">Full access</option>
          </SettingsSelect>
        </SettingsFieldRow>
        <SettingsFieldRow title="Review mode" subtitle={<>Whether <code>/review</code> runs in the current thread or in a new review thread.</>}>
          <SettingsSelect
            value={appSettings.reviewDeliveryMode}
            onChange={(event) => void onUpdateAppSettings({ ...appSettings, reviewDeliveryMode: event.target.value as AppSettings["reviewDeliveryMode"] })}
          >
            <option value="inline">Inline (same thread)</option>
            <option value="detached">Detached (new review thread)</option>
          </SettingsSelect>
        </SettingsFieldRow>
        <SettingsSwitchRow
          title="CodeGraph"
          subtitle="Gives agents a private code index. Changes apply the next time the app-server starts."
          pressed={codegraphOn}
          switchProps={{ "aria-label": "Enable CodeGraph" }}
          onClick={() => { const enabled = !codegraphOn; void onUpdateAppSettings({ ...appSettings, codegraphEnabled: enabled, mcpServers: [...(appSettings.mcpServers ?? []).filter(s => s.id !== "codegraph"), { ...(appSettings.mcpServers?.find(s => s.id === "codegraph") ?? { id: "codegraph", name: "CodeGraph" }), enabled }] }); }}
        />
      </SettingsGroup>
      <SettingsGroup title="Instruction files">
        <FileEditorCard
          title="Global AGENTS.md"
          meta={globalAgentsMeta}
          error={globalAgentsError}
          value={globalAgentsContent}
          placeholder="Add global instructions for Codex agents…"
          disabled={globalAgentsLoading}
          refreshDisabled={globalAgentsRefreshDisabled}
          saveDisabled={globalAgentsSaveDisabled}
          saveLabel={globalAgentsSaveLabel}
          onChange={onSetGlobalAgentsContent}
          onRefresh={onRefreshGlobalAgents}
          onSave={onSaveGlobalAgents}
          helpText="Stored in nucode’s managed Codex home."
          classNames={editorClasses}
        />
        <FileEditorCard
          title="Global config.toml"
          meta={globalConfigMeta}
          error={globalConfigError}
          value={globalConfigContent}
          placeholder="Edit the global Codex config.toml…"
          disabled={globalConfigLoading}
          refreshDisabled={globalConfigRefreshDisabled}
          saveDisabled={globalConfigSaveDisabled}
          saveLabel={globalConfigSaveLabel}
          onChange={onSetGlobalConfigContent}
          onRefresh={onRefreshGlobalConfig}
          onSave={onSaveGlobalConfig}
          helpText="nucode regenerates this file from your Providers and Agents settings when Codex starts."
          classNames={editorClasses}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
