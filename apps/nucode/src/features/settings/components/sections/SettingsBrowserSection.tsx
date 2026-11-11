import { SettingsPage, SettingsGroup, SettingsTextField, SettingsTextArea, SettingsSelect, SettingsButton, SettingsFieldRow, SettingsToggleRow, SettingsToggleSwitch } from "@/features/design-system/components/settings/SettingsPrimitives";
import { SettingsRuntimeSetup } from "./SettingsRuntimeSetup";
import { useEffect, useRef, useState } from "react";
import type { AppSettings, WebSearchProvider } from "@/types";
import { browserPasswordsList, browserPasswordSave, browserPasswordDelete, browserPasswordUnblock, type BrowserPasswordIndex, browserRequest } from "@services/tauri";
import { defaultBrowserSettings } from "@/features/browser/browser";
import "./registry.css";

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
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  return <SettingsPage className="registry-settings" title="Browser" subtitle="A shared browser for you and your agents.">{draft.engine === "cdp" && <SettingsRuntimeSetup engine="browser" onManage={onManageEngines} />}

    <form onSubmit={e => { e.preventDefault(); void run(async () => {
      const url = new URL(draft.searchUrl.split("{query}").join("test"));
      if (!["http:","https:"].includes(url.protocol) || !draft.searchUrl.includes("{query}")) throw new Error("Search URL must use HTTP(S) and contain {query}");
      if (draft.webSearch.provider === "searxng") {
        let instance: URL | undefined;
        try { instance = new URL(draft.webSearch.url); } catch { /* Show the same validation message below. */ }
        if (!instance || !["http:", "https:"].includes(instance.protocol) || !instance.hostname) throw new Error("Enter the SearXNG instance URL (http or https)");
      }
      const lines = (v: string) => v.split("\n").map(s => s.trim()).filter(Boolean);
      await onUpdateAppSettings({ ...appSettings, browser: { ...draft, allowedOrigins: lines(allow), blockedOrigins: lines(block) } });
      setMessage("Saved. Engine and private browsing changes apply immediately. Browser binary and origin changes apply to new browser sessions.");
    }); }}>
      <SettingsGroup disabled={busy} title={<>Browser preferences</>}>
        <SettingsFieldRow title={<>Engine</>} help={<>Native shares the embedded page with agents. Headless Chromium supports sites that require trusted input. Linux uses Chromium; Windows native agent tools use Chromium.</>}><SettingsSelect value={draft.engine ?? "native"} onChange={e => setDraft({ ...draft, engine: e.target.value as "native" | "cdp" })}><option value="native">Native</option><option value="cdp">Headless Chromium (advanced)</option></SettingsSelect></SettingsFieldRow>
        <SettingsFieldRow title={<>Private browsing</>} help={<>Use an ephemeral native browser store. Changing this restarts open native tabs.</>}><SettingsSelect value={String(draft.privateBrowsing ?? false)} onChange={e => setDraft({ ...draft, privateBrowsing: e.target.value === "true" })}><option value="false">Off</option><option value="true">On</option></SettingsSelect></SettingsFieldRow>
        <SettingsFieldRow  title={<>Browser binary</>}><SettingsTextField value={draft.binary ?? ""} placeholder="Auto-detect Chrome, Edge, Chromium" onChange={e => setDraft({ ...draft, binary: e.target.value || null })} /></SettingsFieldRow>
        <SettingsFieldRow title={<>Allowed origins (one per line)</>} className="settings-field-row-long"><SettingsTextArea value={allow} onChange={e => setAllow(e.target.value)} /></SettingsFieldRow>
        <SettingsFieldRow title={<>Blocked origins (one per line)</>} className="settings-field-row-long"><SettingsTextArea value={block} onChange={e => setBlock(e.target.value)} /></SettingsFieldRow>
        <SettingsFieldRow  title={<>Browser tool approval</>} help={<>Snapshots, screenshots, console, network, tabs and navigation never ask. Clicks, typing, scripts and other changes follow this setting.</>}><SettingsSelect value={draft.approval} onChange={e => setDraft({ ...draft, approval: e.target.value as "ask" | "auto" })}><option value="ask">Ask before changes</option><option value="auto">Automatic</option></SettingsSelect></SettingsFieldRow>
        <SettingsFieldRow  title={<>Search URL</>} help={<>Use {"{query}"} for the search term. Downloads are saved to ~/Downloads.</>}><SettingsTextField value={draft.searchUrl} onChange={e => setDraft({ ...draft, searchUrl: e.target.value })} /></SettingsFieldRow>
        <SettingsToggleRow title="Stay signed in after restart" subtitle="Keeps sites’ session cookies in your macOS Keychain"><SettingsToggleSwitch pressed={draft.keepSessions ?? true} onClick={() => setDraft({ ...draft, keepSessions: !(draft.keepSessions ?? true) })} /></SettingsToggleRow>
        <SettingsToggleRow title="Offer to save passwords"><SettingsToggleSwitch pressed={draft.offerToSavePasswords ?? true} onClick={() => setDraft({ ...draft, offerToSavePasswords: !(draft.offerToSavePasswords ?? true) })} /></SettingsToggleRow>
        <SettingsToggleRow title="Require authentication to fill"><SettingsToggleSwitch pressed={draft.requireAuthToFill ?? true} onClick={() => setDraft({ ...draft, requireAuthToFill: !(draft.requireAuthToFill ?? true) })} /></SettingsToggleRow>
      </SettingsGroup>
      <SettingsGroup disabled={busy} title="Web search" subtitle="Lets agents search in the background without opening the browser.">
        <SettingsFieldRow title="Provider"><SettingsSelect value={draft.webSearch.provider} onChange={e => setDraft({ ...draft, webSearch: { ...draft.webSearch, provider: e.target.value as WebSearchProvider } })}><option value="off">Off</option><option value="searxng">SearXNG</option></SettingsSelect></SettingsFieldRow>
        {draft.webSearch.provider === "searxng" && <SettingsFieldRow title="Instance URL"><SettingsTextField value={draft.webSearch.url} placeholder="https://searx.example.org" onChange={e => setDraft({ ...draft, webSearch: { ...draft.webSearch, url: e.target.value } })} /></SettingsFieldRow>}
      </SettingsGroup>
      <SettingsButton type="submit">Save browser settings</SettingsButton>
    </form>
    <SettingsGroup title="Saved passwords" disabled={busy}>
      {passwords.entries.map(entry => <SettingsFieldRow key={entry.id} title={entry.origin} help={entry.username}><SettingsButton onClick={() => void run(async () => { await browserPasswordDelete(entry.id); await refreshPasswords(); })}>Delete</SettingsButton></SettingsFieldRow>)}
      {!passwords.entries.length && <p>No saved passwords.</p>}
      <form ref={passwordForm} onSubmit={e => { e.preventDefault(); void run(async () => {
        const input = passwordForm.current?.elements.namedItem("password") as HTMLInputElement | null;
        const password = input?.value ?? "";
        if (input) input.value = "";
        await browserPasswordSave(login.origin, login.username, password);
        setLogin({ origin: "", username: "" }); await refreshPasswords();
      }); }}>
        <SettingsFieldRow title="Origin URL"><SettingsTextField type="url" required value={login.origin} onChange={e => setLogin({ ...login, origin: e.target.value })} placeholder="https://example.com" /></SettingsFieldRow>
        <SettingsFieldRow title="Username"><SettingsTextField autoComplete="off" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} /></SettingsFieldRow>
        <SettingsFieldRow title="Password"><SettingsTextField name="password" type="password" autoComplete="off" required /></SettingsFieldRow>
        <SettingsButton type="submit">Add password</SettingsButton>
      </form>
    </SettingsGroup>
    <SettingsGroup title="Never saved" disabled={busy}>
      {passwords.never.map(origin => <SettingsFieldRow key={origin} title={origin}><SettingsButton onClick={() => void run(async () => { await browserPasswordUnblock(origin); await refreshPasswords(); })}>Remove</SettingsButton></SettingsFieldRow>)}
      {!passwords.never.length && <p>No blocked sites.</p>}
    </SettingsGroup>
    <SettingsButton disabled={busy} onClick={() => setConfirm(true)}>Clear browsing data</SettingsButton>
    {confirm && <div role="alert"><p>Stop the browser and delete all browsing data, including website sign-ins?</p><SettingsButton disabled={busy} onClick={() => void run(async () => { await browserRequest({ action: "clear", confirmed: true }); setConfirm(false); setMessage("Browsing data cleared."); })}>Delete browsing data</SettingsButton><SettingsButton disabled={busy} onClick={() => setConfirm(false)}>Cancel</SettingsButton></div>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </SettingsPage>;
}
