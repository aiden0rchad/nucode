// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, ProviderEntry } from "@/types";
import { SettingsProvidersSection, SettingsAgentPolicySection, ProjectAgentPolicy } from "./SettingsRegistrySections";
import { defaultAgentPolicy } from "../../registry";
import { providerSetApiKey, providerHasApiKey, providerTestAndFetch } from "@services/tauri";
vi.mock("@services/tauri", () => ({
  providerSetApiKey: vi.fn(), providerHasApiKey: vi.fn(), providerDeleteApiKey: vi.fn(), providerTestAndFetch: vi.fn(),
}));
const choose = (row: string, item: string) => { fireEvent.click(screen.getByRole("button", { name: `Actions for ${row}` })); fireEvent.click(screen.getByRole("menuitem", { name: item })); };
const provider: ProviderEntry = { id: "local", name: "Local", kind: "ollama", auth: { type: "none" }, enabled: true, models: [{ id: "small", enabled: true }] };
function Providers({ initial = [] }: { initial?: ProviderEntry[] }) {
  const [settings, setSettings] = useState({ providers: initial } as AppSettings);
  return <SettingsProvidersSection appSettings={settings} onUpdateAppSettings={async s => { setSettings(s); }} />;
}
describe("provider registry settings", () => {
  afterEach(cleanup);
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(providerHasApiKey).mockResolvedValue(false); });
  it.each([true, false, null])("saves image overrides and restores detected %s with Auto", async detected => {
    const save = vi.fn().mockResolvedValue(undefined);
    const initial: ProviderEntry = { ...provider, models: [{ id: "small", enabled: true, supportsImages: detected, detectedSupportsImages: detected, supportsImagesSource: detected == null ? null : "detected" }, { id: "other", enabled: false }] };
    const { unmount } = render(<SettingsProvidersSection appSettings={{ providers: [initial] } as AppSettings} onUpdateAppSettings={save} />);
    choose("Local", "Edit");
    const control = screen.getByLabelText("Images for small");
    expect(control).toHaveProperty("value", "auto");
    expect(screen.getAllByText(`Detected: ${detected == null ? "unknown" : detected ? "yes" : "no"}`).length).toBeGreaterThan(0);
    for (const value of ["on", "off", "auto"]) {
      fireEvent.change(control, { target: { value } });
      fireEvent.click(screen.getByText("Save provider"));
      await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ providers: [expect.objectContaining({ models: [expect.objectContaining({
        supportsImages: value === "auto" ? detected : value === "on",
        supportsImagesSource: value === "auto" ? detected == null ? null : "detected" : "user",
        detectedSupportsImages: detected,
      }), initial.models[1]] })] })));
      await waitFor(() => expect(screen.getByText("Save provider")).toHaveProperty("disabled", false));
    }
    fireEvent.change(control, { target: { value: "on" } });
    fireEvent.click(screen.getByText("Save provider"));
    await waitFor(() => expect(screen.getByText("Save provider")).toHaveProperty("disabled", false));
    const saved = save.mock.lastCall![0];
    unmount();
    render(<SettingsProvidersSection appSettings={saved} onUpdateAppSettings={save} />);
    choose("Local", "Edit");
    expect(screen.getByLabelText("Images for small")).toHaveProperty("value", "on");
  });
  it("shows image detection returned by Test & fetch models", async () => {
    vi.mocked(providerTestAndFetch).mockResolvedValue({ ok: true, latencyMs: 12, models: [{ id: "small", enabled: true, supportsImages: false, supportsImagesSource: "user", detectedSupportsImages: true }] });
    render(<Providers initial={[provider]} />);
    choose("Local", "Edit");
    fireEvent.click(screen.getByText("Test & fetch models"));
    await screen.findByText("Detected: yes");
    expect(screen.getByLabelText("Images for small")).toHaveProperty("value", "off");
    fireEvent.change(screen.getByLabelText("Images for small"), { target: { value: "auto" } });
    expect(screen.getByLabelText("Images for small")).toHaveProperty("value", "auto");
  });
  it("saves Chain of Command role models and disables delegation without losing them", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SettingsAgentPolicySection appSettings={{ providers: [provider], agentPolicy: { ...defaultAgentPolicy, defaultEngine: "codex" } } as AppSettings} onUpdateAppSettings={save} tab="defaults" />);
    fireEvent.change(screen.getByLabelText("Agent mode"), { target: { value: "chain-of-command" } });
    expect(screen.getByText(/New threads start with pi\./)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Enlisted model"), { target: { value: "local/small" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ agentPolicy: expect.objectContaining({ defaultEngine: "pi", subagents: expect.objectContaining({ enabled: true, mode: "chain-of-command", maxDepth: 2, roles: expect.arrayContaining([expect.objectContaining({ name: "enlisted", model: { providerId: "local", modelId: "small" } })]) }) }) })));
    fireEvent.change(screen.getByLabelText("Agent mode"), { target: { value: "single" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ agentPolicy: expect.objectContaining({ subagents: expect.objectContaining({ enabled: false }) }) })));
    fireEvent.change(screen.getByLabelText("Agent mode"), { target: { value: "chain-of-command" } });
    expect((screen.getByLabelText("Enlisted model") as HTMLSelectElement).value).toBe("local/small");
  });
  it("saves only changed policy, acknowledges success, and preserves edits after failure", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Save failed")).mockResolvedValue(undefined);
    render(<SettingsAgentPolicySection appSettings={{ agentPolicy: defaultAgentPolicy } as AppSettings} onUpdateAppSettings={save} tab="subagents" />);
    const button = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.classList.contains("primary")).toBe(true);
    expect(button.closest(".settings-page-actions")).toBeTruthy();
    const a = defaultAgentPolicy.subagents.maxConcurrent === 5 ? 6 : 5, b = a === 5 ? 6 : 5;
    fireEvent.change(screen.getByLabelText("Max concurrent"), { target: { value: String(a) } });
    expect(button.disabled).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Error: Save failed");
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Saved" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("status").textContent).toBe("Policy saved");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ agentPolicy: expect.objectContaining({ subagents: expect.objectContaining({ maxConcurrent: a }) }) }));
    fireEvent.change(screen.getByLabelText("Max concurrent"), { target: { value: String(b) } });
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", false);
    fireEvent.change(screen.getByLabelText("Max concurrent"), { target: { value: String(a) } });
    expect(screen.getByRole("button", { name: "Saved" })).toHaveProperty("disabled", true);
  });
  it("shows the default engine read-only with a link to Engines", () => {
    const manage = vi.fn();
    render(<SettingsAgentPolicySection appSettings={{ agentPolicy: defaultAgentPolicy } as AppSettings} onUpdateAppSettings={vi.fn()} tab="defaults" onManageEngines={manage} />);
    expect(screen.queryByLabelText("Default engine")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage engines" }));
    expect(manage).toHaveBeenCalledOnce();
  });
  it("saves Anthropic compatibility and enables the Claude engine for a project", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<SettingsProvidersSection appSettings={{ providers: [provider] } as AppSettings} onUpdateAppSettings={save} />);
    choose("Local", "Edit");
    fireEvent.click(screen.getByLabelText("Anthropic-compatible (/v1/messages)"));
    fireEvent.click(screen.getByText("Save provider"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ providers: [expect.objectContaining({ anthropicCompatible: true })] })));
    unmount();
    const workspace = { id: "ws", name: "Project", path: "/project", connected: true, settings: { sidebarCollapsed: false } };
    const update = vi.fn().mockResolvedValue(undefined);
    render(<ProjectAgentPolicy workspace={workspace} appSettings={{ providers: [{ ...provider, anthropicCompatible: true }], agentPolicy: defaultAgentPolicy } as AppSettings} onUpdate={update} />);
    expect((screen.getByRole("option", { name: "Claude Code (ACP)" }) as HTMLOptionElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Engine for this project"), { target: { value: "claude" } });
    fireEvent.click(screen.getByText("Save project override"));
    await waitFor(() => expect(update).toHaveBeenCalledWith("ws", { agentPolicy: expect.objectContaining({ defaultEngine: "claude" }) }));
  });
  it("defaults auth commands to 15 seconds and saves a provider override", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const commandProvider: ProviderEntry = { ...provider, auth: { type: "command", command: "/bin/key", args: [] } };
    render(<SettingsProvidersSection appSettings={{ providers: [commandProvider] } as AppSettings} onUpdateAppSettings={save} />);
    choose("Local", "Edit");
    expect((screen.getByLabelText("Auth timeout (ms)") as HTMLInputElement).value).toBe("15000");
    fireEvent.change(screen.getByLabelText("Auth timeout (ms)"), { target: { value: "30000" } });
    fireEvent.click(screen.getByText("Save provider"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ providers: [expect.objectContaining({ auth: { type: "command", command: "/bin/key", args: [], timeoutMs: 30000 } })] })));
  });
  it("uses presets, writes a masked key, and adds manual models", async () => {
    render(<Providers />);
    fireEvent.click(screen.getByText("Add provider"));
    fireEvent.change(screen.getByLabelText("Provider ID"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Custom" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "openai-compatible" } });
    expect((screen.getByLabelText("API style") as HTMLSelectElement).value).toBe("chat-completions");
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://localhost:9000/v1" } });
    const key = screen.getByLabelText("API key");
    expect(key.getAttribute("type")).toBe("password");
    fireEvent.change(key, { target: { value: "super-secret" } });
    fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "manual/model" } });
    fireEvent.click(screen.getByText("Add model ID manually"));
    expect(screen.getByLabelText("manual/model").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("Save provider"));
    await waitFor(() => expect(providerSetApiKey).toHaveBeenCalledWith("custom", "super-secret"));
    expect(screen.queryByDisplayValue("super-secret")).toBeNull();
  });
  it("renders fetch latency, model toggles and actionable failures", async () => {
    vi.mocked(providerTestAndFetch).mockResolvedValueOnce({ ok: true, latencyMs: 42, models: [{ id: "fetched", enabled: true }] }).mockResolvedValueOnce({ ok: false, latencyMs: 2, models: [], error: "API key rejected" });
    render(<Providers initial={[provider]} />);
    choose("Local", "Edit");
    fireEvent.click(screen.getByText("Test & fetch models"));
    await waitFor(() => expect(screen.getByText("42 ms")).toBeTruthy());
    expect(screen.getByLabelText("fetched").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByLabelText("fetched"));
    expect(screen.getByLabelText("fetched").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByText("Test & fetch models"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("API key rejected"));
  });
  it("validates policy bounds and role allow-lists", () => {
    const policy = structuredClone(defaultAgentPolicy);
    policy.subagents.allowedModels = [{ providerId: "local", modelId: "small" }];
    render(<SettingsAgentPolicySection appSettings={{ providers: [{ ...provider, models: [...provider.models, { id: "large", enabled: true }] }], agentPolicy: policy } as AppSettings} onUpdateAppSettings={vi.fn()} />);
    expect(screen.getAllByLabelText("Name")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Max concurrent"), { target: { value: "17" } });
    expect(screen.getByRole("alert").textContent).toContain("concurrent 1–16");
    expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Max concurrent"), { target: { value: "3" } });
    expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getAllByLabelText("Role model")[0], { target: { value: "local/large" } });
    expect(screen.getByRole("alert").textContent).toContain("must be in allowed models");
    expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows engine enforcement and the merged workspace policy", () => {
    const workspace = { id: "ws", name: "Project", path: "/project", connected: true, settings: { sidebarCollapsed: false, agentPolicy: { subagents: { maxConcurrent: 2 } } } };
    render(<SettingsAgentPolicySection workspace={workspace} appSettings={{ agentPolicy: defaultAgentPolicy } as AppSettings} onUpdateAppSettings={vi.fn()} />);
    expect(screen.getAllByText("How many subagents one turn may start. Pi only.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Leave empty to allow any enabled model. Pi only.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("How many subagents run at once. Pi and Codex.").length).toBeGreaterThan(0);
    expect(screen.getByText("Effective policy for Project (app + workspace)")).toBeTruthy();
    const disclosure = screen.getByRole("button", { name: "Effective policy for Project (app + workspace)" });
    expect(disclosure.querySelector("svg")).toBeTruthy();
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(disclosure.getAttribute("aria-controls")!)?.hidden).toBe(false);
    expect((screen.getAllByLabelText("Max concurrent")[1] as HTMLInputElement).value).toBe("2");
    expect((screen.getAllByLabelText("Max per turn")[1] as HTMLInputElement).value).toBe("8");
  });
  it("says which projects a roles editor affects", () => {
    const workspace = { id: "ws", name: "Project", path: "/project", connected: true, settings: { sidebarCollapsed: false } };
    const settings = { agentPolicy: defaultAgentPolicy } as AppSettings;
    const app = render(<SettingsAgentPolicySection tab="roles" appSettings={settings} onUpdateAppSettings={vi.fn()} />);
    expect(screen.getByText("All projects:")).toBeTruthy();
    expect(screen.getByText(/To give one project different roles, use its agent policy in Settings → Projects/)).toBeTruthy();
    app.unmount();
    render(<ProjectAgentPolicy workspace={workspace} appSettings={settings} onUpdate={vi.fn()} />);
    expect(screen.getByText("This project only:")).toBeTruthy();
    expect(screen.queryByText("All projects:")).toBeNull();
  });
  it("keeps macOS from capitalizing or correcting role names", () => {
    render(<SettingsAgentPolicySection tab="roles" appSettings={{ agentPolicy: defaultAgentPolicy } as AppSettings} onUpdateAppSettings={vi.fn()} />);
    const name = screen.getAllByLabelText("Name")[0];
    expect(name.getAttribute("autocapitalize")).toBe("off");
    expect(name.getAttribute("autocorrect")).toBe("off");
    expect(name.getAttribute("spellcheck")).toBe("false");
    // Prose such as a role's description keeps the system's text help.
    expect(screen.getAllByLabelText("Description")[0].getAttribute("autocapitalize")).toBeNull();
  });
});

it("renders a provider card with a shared toggle, test status, icon actions and delete confirmation", async () => {
  render(<Providers initial={[provider]} />);
  const toggle = screen.getByRole("button", { name: "Enable Local" });
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(toggle.closest(".settings-list-group")).toBeTruthy();
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("false"));
  vi.mocked(providerTestAndFetch).mockResolvedValue({ ok: true, latencyMs: 15, models: [{ id: "fetched", enabled: true }] });
  choose("Local", "Test & fetch models");
  await waitFor(() => expect(screen.getByText(/1 models · tested/)).toBeTruthy());
  choose("Local", "Delete");
  expect(screen.getByRole("alertdialog", { name: "Delete Local?" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Local provider" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  choose("Local", "Delete");
  fireEvent.click(screen.getByRole("button", { name: "Delete provider" }));
  await waitFor(() => expect(screen.queryByRole("group", { name: "Local provider" })).toBeNull());
});

it("defaults roles to the current project and preserves unrelated overrides", async () => {
  const globalSave = vi.fn();
  const projectSave = vi.fn().mockResolvedValue(undefined);
  const workspace = { id: "project-b", name: "Project B", path: "/b", connected: true, settings: { sidebarCollapsed: false, agentPolicy: { subagents: { maxConcurrent: 2 } } } };
  render(<SettingsAgentPolicySection tab="roles" workspace={workspace} appSettings={{ agentPolicy: defaultAgentPolicy } as AppSettings} onUpdateAppSettings={globalSave} onUpdateWorkspaceSettings={projectSave} />);
  expect(screen.getByLabelText("Agent scope")).toHaveProperty("value", "project");
  expect(screen.getByRole("option", { name: "This project — Project B" })).toBeTruthy();
  fireEvent.click(screen.getByText("Add role"));
  fireEvent.change(screen.getAllByLabelText("Name").slice(-1)[0], { target: { value: "beta-only" } });
  expect(screen.getByLabelText("Agent scope")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(projectSave).toHaveBeenCalledWith("project-b", { agentPolicy: { subagents: { maxConcurrent: 2, roles: expect.arrayContaining([expect.objectContaining({ name: "beta-only" })]) } } }));
  expect(globalSave).not.toHaveBeenCalled();
  expect(screen.getAllByText("· This project").length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Agent scope"), { target: { value: "all" } });
  expect(screen.queryByDisplayValue("beta-only")).toBeNull();
  fireEvent.click(screen.getByText("Add role"));
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(globalSave).toHaveBeenCalled());
  cleanup();
});

it("renders partial project overrides returned with null fields by Rust", () => {
  const override = JSON.parse('{"defaultEngine":null,"defaultModel":null,"subagents":{"enabled":null,"mode":null,"maxConcurrent":null,"maxPerTurn":null,"maxDepth":null,"maxRunMinutes":null,"dailyTokenLimit":null,"allowedModels":null,"defaultModel":null,"roles":[{"name":"alphaonly","description":"Project role","model":null,"toolAccess":"read-only","instructions":""}]}}');
  const workspace = { id: "a", name: "A", path: "/a", connected: true, settings: { sidebarCollapsed: false, agentPolicy: override } };
  render(<ProjectAgentPolicy workspace={workspace} appSettings={{ agentPolicy: defaultAgentPolicy } as AppSettings} onUpdate={vi.fn()} />);
  expect(screen.getByDisplayValue("alphaonly")).toBeTruthy();
  expect(screen.getByLabelText("Max concurrent")).toHaveProperty("value", String(defaultAgentPolicy.subagents.maxConcurrent));
  expect(screen.getByLabelText("Engine for this project")).toHaveProperty("value", defaultAgentPolicy.defaultEngine);
  cleanup();
});
