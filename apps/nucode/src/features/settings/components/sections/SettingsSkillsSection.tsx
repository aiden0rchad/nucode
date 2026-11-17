import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@/types";
import { SettingsBadge, SettingsButton, SettingsCallout, SettingsEmpty, SettingsFieldRow, SettingsGroup, SettingsListRow, SettingsPage, SettingsSwitchRow, SettingsTextField, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";
import { SKILLS_CHANGED } from "@/features/skills/hooks/useSkills";
import { pickWorkspacePath, skillsRequest, type ResolvedSkill, type SkillsInstall, type SkillsResolution } from "@services/tauri";

const SOURCES = [
  { key: "claudeCode", title: "Claude Code skills", folder: "~/.claude/skills" },
  { key: "codex", title: "Codex skills", folder: "~/.codex/skills" },
  { key: "agents", title: "Agent skills", folder: "~/.agents/skills" },
] as const;
const BADGES: Record<ResolvedSkill["source"], string> = { library: "nucode", claudeCode: "Claude Code", codex: "Codex", agents: "Agents" };
const NONE: NonNullable<AppSettings["skills"]> = { sources: { claudeCode: false, codex: false, agents: false }, disabled: [] };

export function SettingsSkillsSection({ appSettings, onUpdateAppSettings }: { appSettings: AppSettings; onUpdateAppSettings: (settings: AppSettings) => Promise<unknown> }) {
  const skills = { ...NONE, ...appSettings.skills, sources: { ...NONE.sources, ...appSettings.skills?.sources } };
  const [resolution, setResolution] = useState<SkillsResolution>({ skills: [], warnings: [] });
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflicts, setConflicts] = useState<string[]>([]);
  const settingsKey = JSON.stringify(skills);
  const refresh = useCallback(async () => {
    try { const next = await skillsRequest<SkillsResolution | null>("resolve"); setResolution({ skills: next?.skills ?? [], warnings: next?.warnings ?? [] }); window.dispatchEvent(new Event(SKILLS_CHANGED)); } catch (e) { setError(String(e)); }
  }, []);
  // The list follows the saved settings, so it reloads once a toggle has been stored.
  useEffect(() => { void refresh(); }, [refresh, settingsKey]);
  const save = async (next: typeof skills) => {
    try { await onUpdateAppSettings({ ...appSettings, skills: next }); setError(""); } catch (e) { setError(String(e)); }
  };
  const install = async (replace: boolean) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await skillsRequest<SkillsInstall>("install", { source, replace });
      if (result.conflicts.length) { setConflicts(result.conflicts); return; }
      setConflicts([]); setSource("");
      setNotice(`Installed ${result.installed.join(", ")}. Takes effect the next time an agent starts.`);
      await refresh();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const browse = async () => { const path = await pickWorkspacePath().catch(() => null); if (path) { setSource(path); setConflicts([]); } };
  const remove = async (name: string) => {
    try { await skillsRequest("remove", { name }); await save({ ...skills, disabled: skills.disabled.filter(n => n !== name) }); await refresh(); } catch (e) { setError(String(e)); }
  };
  const toggle = (skill: ResolvedSkill) => save({ ...skills, disabled: skill.enabled ? [...skills.disabled, skill.name] : skills.disabled.filter(n => n !== skill.name) });
  return <SettingsPage title="Skills" subtitle="Skills teach agents a task: a folder with a SKILL.md file. Enabled skills reach every Code engine, and take effect the next time an agent starts.">
    <SettingsGroup title="Use skills you already have" subtitle="nucode reads these folders as they are and never changes them.">
      {SOURCES.map(({ key, title, folder }) => <SettingsSwitchRow key={key} title={title} subtitle={folder} pressed={skills.sources[key]} switchProps={{ "aria-label": `Use ${title}` }} onClick={() => void save({ ...skills, sources: { ...skills.sources, [key]: !skills.sources[key] } })} />)}
    </SettingsGroup>
    <SettingsGroup title="Install a skill pack" subtitle="A GitHub repository such as https://github.com/owner/repo, or a folder on this computer. nucode keeps its own copy.">
      <SettingsFieldRow title="GitHub address or folder" stacked>
        <div className="settings-field-actions">
          <SettingsTextField identifier className="is-fill" value={source} placeholder="https://github.com/owner/repo" onChange={event => { setSource(event.target.value); setConflicts([]); }} onKeyDown={event => { if (event.key === "Enter" && source.trim() && !busy) void install(false); }} />
          <SettingsButton onClick={() => void browse()} disabled={busy}>Choose folder…</SettingsButton>
          <SettingsButton className="primary" disabled={busy || !source.trim()} onClick={() => void install(false)}>{busy ? "Installing…" : "Install"}</SettingsButton>
        </div>
      </SettingsFieldRow>
      {!!conflicts.length && <SettingsCallout>Already installed: {conflicts.join(", ")}.<div className="settings-callout-actions"><SettingsButton disabled={busy} onClick={() => void install(true)}>Replace</SettingsButton></div></SettingsCallout>}
      {notice && <SettingsCallout tone="info">{notice}</SettingsCallout>}
    </SettingsGroup>
    <SettingsGroup title="Available skills">
      {resolution.skills.length ? resolution.skills.map(skill => <SettingsListRow key={skill.name} title={skill.name} badge={<SettingsBadge>{BADGES[skill.source]}</SettingsBadge>} meta={skill.description}>
        {skill.source === "library" && <SettingsButton aria-label={`Remove ${skill.name}`} onClick={() => void remove(skill.name)}>Remove</SettingsButton>}
        <SettingsToggleSwitch aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`} pressed={skill.enabled} onClick={() => void toggle(skill)} />
      </SettingsListRow>) : <SettingsEmpty>No skills yet. Install a pack or turn on a folder above.</SettingsEmpty>}
    </SettingsGroup>
    {resolution.warnings.map(w => <SettingsCallout key={`${w.path}:${w.message}`}>{w.message}<br /><small>{w.path}</small></SettingsCallout>)}
    {error && <SettingsCallout tone="error">{error}</SettingsCallout>}
  </SettingsPage>;
}
