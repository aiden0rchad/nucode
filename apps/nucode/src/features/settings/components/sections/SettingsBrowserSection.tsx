import { SettingsCallout, SettingsEmpty, SettingsPage, SettingsGroup, SettingsListRow, SettingsTextField, SettingsTextArea, SettingsSelect, SettingsButton, SettingsFieldRow, SettingsRow, SettingsRowText, SettingsDisclosureRow, SettingsToggleRow, SettingsSwitchRow, SettingsUnsaved } from "@/features/design-system/components/settings/SettingsPrimitives";
import { SettingsRuntimeSetup } from "./SettingsRuntimeSetup";
import { useEffect, useRef, useState } from "react";
import type { AppSettings, WebSearchProvider } from "@/types";
import { browserPasswordsList, browserPasswordSave, browserPasswordDelete, browserPasswordUnblock, type BrowserPasswordIndex, browserRequest } from "@services/tauri";
import { defaultBrowserSettings } from "@/features/browser/browser";

export function SettingsBrowserSection({ appSettings, onUpdateAppSettings, onManageEngines }: { onManageEngines?: () => void; appSettings: AppSettings; onUpdateAppSettings: (s: AppSettings) => Promise<void> }) {
  const [passwords, setPasswords] = useState<BrowserPasswordIndex>({ entries: [], never: [] });
  const [login, setLogin] = useState({ origin: "", username: "" });
  const passwordForm = useRef<HTMLFormElement>(null);
  const refreshPasswords = async () => {
    const index = await browserPasswordsList();
    if (!index || !Array.isArray(index.entries) || !Array.isArray(index.never)) throw new Error("Saved passwords unavailable");
    setPasswords(index);
  };
  useEffect(() => { void refreshPasswords().catch(e => setError(String(e))); }, []);
  const [draft, setDraft] = useState({ ...defaultBrowserSettings, ...appSettings.browser });
  const [allow, setAllow] = useState(draft.allowedOrigins.join("\n"));
  const [block, setBlock] = useState(draft.blockedOrigins.join("\n"));
  const snapshot = (d: typeof draft, a: string, b: string) => JSON.stringify({ d, a, b });
  const [saved, setSaved] = useState(() => ({ d: draft, a: allow, b: block }));
  const count = (v: string) => v.split("\n").map(x => x.trim()).filter(Boolean).length;
  const allowed = count(allow), blocked = count(block);
  const siteSummary = allowed ? `Only ${allowed} ${allowed === 1 ? "site" : "sites"} can open${blocked ? ` · ${blocked} blocked` : ""}` : blocked ? `All sites except ${blocked} blocked` : "All sites can open";
  const dirty = snapshot(draft, allow, block) !== snapshot(saved.d, saved.a, saved.b);
  const discard = () => { setDraft(saved.d); setAllow(saved.a); setBlock(saved.b); setError(""); };
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  return <SettingsPage title="Browser" subtitle="The browser you and your agents share, and which sites it may open." actions={<SettingsUnsaved dirty={dirty} saving={busy} form="browser-settings" onDiscard={discard} />}>{draft.engine === "cdp" && <SettingsRuntimeSetup engine="browser" onManage={onManageEngines} />}
    <form id="browser-settings" onSubmit={e => { e.preventDefault(); void run(async () => {
      const url = new URL(draft.searchUrl.split("{query}").join("test"));
      if (!["http:","https:"].includes(url.protocol) || !draft.searchUrl.includes("{query}")) throw new Error("Search URL must use HTTP(S) and contain {query}");
      if (draft.webSearch.provider === "searxng") {
        let instance: URL | undefined;
        try { instance = new URL(draft.webSearch.url); } catch { /* Show the same validation message below. */ }
        if (!instance || !["http:", "https:"].includes(instance.protocol) || !instance.hostname) throw new Error("Enter the SearXNG instance URL (http or https)");
      }
      const lines = (v: string) => v.split("\n").map(s => s.trim()).filter(Boolean);
      await onUpdateAppSettings({ ...appSettings, browser: { ...draft, allowedOrigins: lines(allow), blockedOrigins: lines(block) } });
      setSaved({ d: draft, a: allow, b: block });
      setMessage("Saved. Engine and private browsing changes apply immediately. Browser binary and website changes apply to new browser sessions.");
    }); }}>
      <SettingsGroup disabled={busy} title="Engine and search">
        <SettingsFieldRow title="Engine" subtitle="Use Headless Chromium for sites that need real input.">
          <SettingsSelect value={draft.engine ?? "native"} onChange={e => setDraft({ ...draft, engine: e.target.value as "native" | "cdp" })}><option value="native">Native</option><option value="cdp">Headless Chromium (advanced)</option></SettingsSelect>
        </SettingsFieldRow>
        {(draft.engine ?? "native") === "cdp" && <SettingsFieldRow stacked title="Browser binary" subtitle="Leave empty to find Chrome, Edge or Chromium automatically.">
          <SettingsTextField className="is-mono" value={draft.binary ?? ""} placeholder="Auto-detect" onChange={e => setDraft({ ...draft, binary: e.target.value || null })} />
        </SettingsFieldRow>}
        <SettingsFieldRow title="Web search provider" subtitle="Lets agents search in the background without opening the browser.">
          <SettingsSelect value={draft.webSearch.provider} onChange={e => setDraft({ ...draft, webSearch: { ...draft.webSearch, provider: e.target.value as WebSearchProvider } })}><option value="off">None</option><option value="searxng">SearXNG</option></SettingsSelect>
        </SettingsFieldRow>
        {draft.webSearch.provider === "searxng" && <SettingsFieldRow title="Instance URL"><SettingsTextField className="is-mono" value={draft.webSearch.url} placeholder="https://searx.example.org" onChange={e => setDraft({ ...draft, webSearch: { ...draft.webSearch, url: e.target.value } })} /></SettingsFieldRow>}
        <SettingsFieldRow stacked title="Search URL" subtitle={<>Used for searches typed in the address bar. Use {"{query}"} for the search term.</>}>
          <SettingsTextField className="is-mono" value={draft.searchUrl} onChange={e => setDraft({ ...draft, searchUrl: e.target.value })} />
        </SettingsFieldRow>
      </SettingsGroup>
      <SettingsGroup disabled={busy} title="Access">
        <SettingsFieldRow title="Agent actions" subtitle="Agents open and read pages without asking, signed-in sites included. Clicking, typing and scripts follow this setting.">
          <SettingsSelect value={draft.approval} onChange={e => setDraft({ ...draft, approval: e.target.value as "ask" | "auto" })}><option value="ask">Ask before changes</option><option value="auto">Automatic</option></SettingsSelect>
        </SettingsFieldRow>
        <SettingsDisclosureRow label="Site rules" summary={siteSummary}>
          <div className="settings-site-rules">
            <SettingsFieldRow stacked title="Allowed origins" subtitle="One per line, such as https://example.com or *.example.com. Leave empty to allow every site; otherwise only these sites open.">
              <SettingsTextArea className="is-mono" value={allow} placeholder="https://docs.example.com" onChange={e => setAllow(e.target.value)} />
            </SettingsFieldRow>
            <SettingsFieldRow stacked title="Blocked origins" subtitle="One per line, same format. These sites never open, even if they are also allowed.">
              <SettingsTextArea className="is-mono" value={block} placeholder="https://accounts.example.com" onChange={e => setBlock(e.target.value)} />
            </SettingsFieldRow>
          </div>
        </SettingsDisclosureRow>
      </SettingsGroup>
      <SettingsGroup disabled={busy} title="Privacy and sign-ins">
        <SettingsSwitchRow title="Private browsing" subtitle="Browsing data is deleted when you quit. Changing this restarts open tabs." pressed={draft.privateBrowsing ?? false} onClick={() => setDraft({ ...draft, privateBrowsing: !(draft.privateBrowsing ?? false) })} />
        <SettingsSwitchRow title="Stay signed in after restart" subtitle="Keeps sites' session cookies in your Keychain." pressed={draft.keepSessions ?? true} onClick={() => setDraft({ ...draft, keepSessions: !(draft.keepSessions ?? true) })} />
        <SettingsSwitchRow title="Offer to save passwords" subtitle="Asks to save a password after you sign in to a site." pressed={draft.offerToSavePasswords ?? true} onClick={() => setDraft({ ...draft, offerToSavePasswords: !(draft.offerToSavePasswords ?? true) })} />
        <SettingsSwitchRow title="Require authentication to fill" subtitle="Asks for your password or Touch ID before a saved password is filled in." pressed={draft.requireAuthToFill ?? true} onClick={() => setDraft({ ...draft, requireAuthToFill: !(draft.requireAuthToFill ?? true) })} />
      <SettingsToggleRow title="Cookies, history and sign-ins" subtitle="Clearing stops the browser and deletes all of them."><SettingsButton className="danger" disabled={busy} onClick={() => setConfirm(true)}>Clear browsing data</SettingsButton></SettingsToggleRow>
      {confirm && <div className="settings-callout is-warning" role="alert"><div>Stop the browser and delete all browsing data, including website sign-ins?<div className="settings-callout-actions"><SettingsButton className="danger" disabled={busy} onClick={() => void run(async () => { await browserRequest({ action: "clear", confirmed: true }); setConfirm(false); setMessage("Browsing data cleared."); })}>Delete browsing data</SettingsButton><SettingsButton disabled={busy} onClick={() => setConfirm(false)}>Cancel</SettingsButton></div></div></div>}
        <SettingsRow><SettingsRowText title="Downloads" subtitle="Files you download are saved to your Downloads folder." /></SettingsRow>
      </SettingsGroup>
    </form>
    <SettingsGroup title="Saved passwords" subtitle="Stored in your Keychain. Only the site and username are shown here." disabled={busy}>
      {passwords.entries.map(entry => <SettingsListRow key={entry.id} title={entry.origin} meta={entry.username}><SettingsButton className="danger" onClick={() => void run(async () => { await browserPasswordDelete(entry.id); await refreshPasswords(); })}>Delete</SettingsButton></SettingsListRow>)}
      {!passwords.entries.length && <SettingsEmpty>No saved passwords.</SettingsEmpty>}
      <form ref={passwordForm} className="settings-subform" onSubmit={e => { e.preventDefault(); void run(async () => {
        const input = passwordForm.current?.elements.namedItem("password") as HTMLInputElement | null;
        const password = input?.value ?? "";
        if (input) input.value = "";
        await browserPasswordSave(login.origin, login.username, password);
        setLogin({ origin: "", username: "" }); await refreshPasswords();
      }); }}>
        <SettingsFieldRow title="Origin URL"><SettingsTextField type="url" required value={login.origin} onChange={e => setLogin({ ...login, origin: e.target.value })} placeholder="https://example.com" /></SettingsFieldRow>
        <SettingsFieldRow title="Username"><SettingsTextField autoComplete="off" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} /></SettingsFieldRow>
        <SettingsFieldRow title="Password"><SettingsTextField name="password" type="password" autoComplete="off" required /></SettingsFieldRow>
        <div className="settings-form-actions"><SettingsButton type="submit">Add password</SettingsButton></div>
      </form>
    </SettingsGroup>
    <SettingsGroup title="Never saved" subtitle="Sites where you chose not to save a password." disabled={busy}>
      {passwords.never.map(origin => <SettingsListRow key={origin} title={origin}><SettingsButton onClick={() => void run(async () => { await browserPasswordUnblock(origin); await refreshPasswords(); })}>Remove</SettingsButton></SettingsListRow>)}
      {!passwords.never.length && <SettingsEmpty>No blocked sites.</SettingsEmpty>}
    </SettingsGroup>
    {error && <SettingsCallout tone="error" style={{ marginTop: 16 }}>{error}</SettingsCallout>}{message && <SettingsCallout tone="info" role="status" style={{ marginTop: 16 }}>{message}</SettingsCallout>}
  </SettingsPage>;
}
