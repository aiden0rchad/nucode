import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ProviderModel } from "@/types";
import { SettingsButton, SettingsTextField, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";

type View = "all" | "on" | "off";
const label = (m: ProviderModel) => m.displayName || m.id;
// "GPT 6.1 Sol (Account 2)" → name "GPT 6.1 Sol", tag "Account 2".
export function modelParts(m: ProviderModel) {
  const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label(m));
  return match ? { name: match[1], tag: match[2] } : { name: label(m), tag: null };
}
// Family = first word of the name, without a vendor prefix ("openai/gpt-5" → "GPT").
export function modelFamily(m: ProviderModel) {
  const word = label(m).split("/").pop()!.split(/[\s\-_:]+/)[0].replace(/\d.*$/, "") || label(m);
  return word.length <= 4 && word === word.toLowerCase() ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1);
}
export function modelGroups(models: ProviderModel[]) {
  const groups = new Map<string, ProviderModel[]>();
  for (const m of models) groups.set(modelFamily(m), [...(groups.get(modelFamily(m)) ?? []), m]);
  // Same-name variants ("… (Account 2)") sit beside each other.
  const order = (list: ProviderModel[]) => [...list].sort((a, b) => modelParts(a).name.localeCompare(modelParts(b).name, undefined, { numeric: true }) || (modelParts(a).tag ?? "").localeCompare(modelParts(b).tag ?? "", undefined, { numeric: true }));
  const other = [...groups].filter(([, list]) => list.length === 1).flatMap(([, list]) => list);
  const named = [...groups].filter(([, list]) => list.length > 1).map(([family, list]) => [family, order(list)] as [string, ProviderModel[]]);
  return other.length ? [...named, ["Other", order(other)] as [string, ProviderModel[]]] : named;
}

/** Turn provider models on or off and pick the default one. Off models stay out of model pickers. */
export function SetupModelPicker({ models, defaultId, onModels, onDefault }: {
  models: ProviderModel[]; defaultId: string;
  onModels: (models: ProviderModel[]) => void; onDefault: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const on = models.filter(m => m.enabled).length;
  const visible = models.filter(m => (view === "all" || m.enabled === (view === "on")) && label(m).toLowerCase().includes(search.trim().toLowerCase()));
  const groups = useMemo(() => modelGroups(models), [models]);
  const current = models.find(m => m.id === defaultId);
  const set = (ids: Set<string>, enabled: boolean) => {
    // The default stays on, so Continue always has a valid choice.
    const next = models.map(m => ids.has(m.id) ? { ...m, enabled: enabled || m.id === defaultId } : m);
    onModels(next);
  };
  const pick = (m: ProviderModel) => {
    if (!m.enabled) onModels(models.map(x => x.id === m.id ? { ...x, enabled: true } : x));
    onDefault(m.id);
  };
  const toggle = (m: ProviderModel) => {
    const next = models.map(x => x.id === m.id ? { ...x, enabled: !x.enabled } : x);
    onModels(next);
    if (m.id === defaultId && m.enabled) onDefault(next.find(x => x.enabled)?.id ?? "");
  };
  const shown = new Set(visible.map(m => m.id));
  const filtered = !!search.trim() || view !== "all";
  return <div className="setup-model-picker">
    <div className="setup-model-toolbar">
      <div className="setup-model-search"><Search size={14} aria-hidden /><SettingsTextField type="search" aria-label="Search models" placeholder="Search models…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="setup-model-filters" role="group" aria-label="Show models">{([["all", "All", models.length], ["on", "On", on], ["off", "Off", models.length - on]] as const).map(([value, name, count]) =>
        <button type="button" key={value} className="setup-model-filter" aria-pressed={view === value} onClick={() => setView(value)}>{name}<span>{count}</span></button>)}</div>
    </div>
    <div className="setup-model-summary">
      <span>Default <strong>{current ? label(current) : "none"}</strong></span>
      <span className="setup-model-bulk">
        <SettingsButton className="ghost" disabled={!visible.some(m => !m.enabled)} onClick={() => set(shown, true)}>{filtered ? `Turn on ${visible.length} shown` : "Turn all on"}</SettingsButton>
        <SettingsButton className="ghost" disabled={!visible.some(m => m.enabled && m.id !== defaultId)} onClick={() => set(shown, false)}>{filtered ? `Turn off ${visible.length} shown` : "Turn all off"}</SettingsButton>
      </span>
    </div>
    <div className="setup-model-groups" role="radiogroup" aria-label="Default model">
      {groups.map(([family, list]) => {
        const rows = list.filter(m => shown.has(m.id));
        if (!rows.length) return null;
        const groupOn = list.filter(m => m.enabled).length;
        return <section className="setup-model-group" key={family} aria-label={`${family} models`}>
          <header className="setup-model-group-head">
            <h3>{family}</h3><small>{groupOn} of {list.length} on</small>
            <SettingsToggleSwitch aria-label={`All ${family} models`} pressed={groupOn === list.length} onClick={() => set(new Set(list.map(m => m.id)), groupOn !== list.length)} />
          </header>
          <div className="setup-model-grid">{rows.map(m => {
            const { name, tag } = modelParts(m);
            const selected = m.id === defaultId;
            return <div className="setup-model-card" key={m.id} data-on={m.enabled} data-default={selected}>
              <button type="button" role="radio" aria-checked={selected} aria-label={label(m)} className="setup-model-pick" title={m.enabled ? `Make ${label(m)} the default` : `Turn on ${label(m)} and make it the default`} onClick={() => pick(m)}>
                <span className="setup-model-radio" aria-hidden />
                <span className="setup-model-name">{name}</span>
                {tag && <span className="setup-model-tag">{tag}</span>}
                {selected && <span className="setup-model-default">Default</span>}
              </button>
              <SettingsToggleSwitch aria-label={`Use ${label(m)}`} pressed={m.enabled} onClick={() => toggle(m)} />
            </div>;
          })}</div>
        </section>;
      })}
      {!visible.length && <p className="setup-model-empty">{search.trim() ? `No models match “${search.trim()}”.` : view === "off" ? "Every model is on." : "No models are on."}</p>}
    </div>
    <p className="setup-hint">Models you turn off are hidden from model pickers. Pick one as the default for new conversations. You can change both later in Settings → Providers.</p>
  </div>;
}
