// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsBrowserSection } from "./SettingsBrowserSection";
import { browserPasswordsList, browserPasswordSave, browserPasswordDelete, browserPasswordUnblock, browserRequest } from "@services/tauri";
import type { AppSettings } from "@/types";
vi.mock("@services/tauri", () => ({browserPasswordsList: vi.fn().mockResolvedValue({ entries: [], never: [] }), browserPasswordSave: vi.fn().mockResolvedValue(undefined), browserPasswordDelete: vi.fn().mockResolvedValue(undefined), browserPasswordUnblock: vi.fn().mockResolvedValue(undefined), engineRuntime: vi.fn().mockResolvedValue([{ engine: "browser", state: "ready", message: "Ready" }]), browserRequest:vi.fn().mockResolvedValue(undefined)}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("defaults web search off and saves a SearXNG instance through browser settings", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={save} />);
  expect((screen.getByLabelText("Provider") as HTMLSelectElement).value).toBe("off");
  expect(screen.queryByLabelText("Instance URL")).toBeNull();
  expect(screen.getByText("Lets agents search in the background without opening the browser.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "searxng" } });
  expect(screen.getByLabelText("Instance URL").getAttribute("placeholder")).toBe("https://searx.example.org");
  fireEvent.click(screen.getByText("Save browser settings"));
  expect((await screen.findByRole("alert")).textContent).toBe("Error: Enter the SearXNG instance URL (http or https)");
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Instance URL"), { target: { value: "https://searx.example.org" } });
  fireEvent.click(screen.getByText("Save browser settings"));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ browser: expect.objectContaining({ webSearch: { provider: "searxng", url: "https://searx.example.org" } }) })));
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "off" } });
  expect(screen.queryByLabelText("Instance URL")).toBeNull();
  fireEvent.click(screen.getByText("Save browser settings"));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ browser: expect.objectContaining({ webSearch: { provider: "off", url: "https://searx.example.org" } }) })));
});
it("loads configured web search and rejects non-HTTP instance URLs", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<SettingsBrowserSection appSettings={{ browser: { webSearch: { provider: "searxng", url: "https://searx.example.org" } } } as AppSettings} onUpdateAppSettings={save} />);
  expect((screen.getByLabelText("Provider") as HTMLSelectElement).value).toBe("searxng");
  expect((screen.getByLabelText("Instance URL") as HTMLInputElement).value).toBe("https://searx.example.org");
  fireEvent.change(screen.getByLabelText("Instance URL"), { target: { value: "file:///search" } });
  fireEvent.click(screen.getByText("Save browser settings"));
  expect((await screen.findByRole("alert")).textContent).toBe("Error: Enter the SearXNG instance URL (http or https)");
  expect(save).not.toHaveBeenCalled();
});
it("saves browser settings and requires confirmation before deleting the profile", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={save} />);
  fireEvent.change(screen.getByLabelText("Browser binary"),{target:{value:"/custom/chrome"}});
  fireEvent.change(screen.getByLabelText(/Allowed origins/),{target:{value:"https://one.test\nhttps://two.test"}});
  fireEvent.change(screen.getByLabelText(/Blocked origins/),{target:{value:"https://blocked.test"}});
  fireEvent.change(screen.getByLabelText("Browser tool approval"),{target:{value:"auto"}});
  fireEvent.click(screen.getByText("Save browser settings"));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({browser:expect.objectContaining({binary:"/custom/chrome",allowedOrigins:["https://one.test","https://two.test"],blockedOrigins:["https://blocked.test"],approval:"auto"})})));
  await screen.findByText(/Saved\./);
  fireEvent.click(screen.getByText("Clear browsing data")); expect(browserRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Cancel")); expect(browserRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Clear browsing data")); fireEvent.click(screen.getByText("Delete browsing data"));
  await waitFor(() => expect(browserRequest).toHaveBeenCalledWith({action:"clear",confirmed:true}));
});

it("adds a password without retaining it in the form or rendering it back", async () => {
  const view = render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={vi.fn()} />);
  await waitFor(() => expect(browserPasswordsList).toHaveBeenCalled());
  const password = screen.getByLabelText("Password") as HTMLInputElement;
  expect(password.type).toBe("password"); expect(password.autocomplete).toBe("off");
  fireEvent.change(screen.getByLabelText("Origin URL"), { target: { value: "https://example.test" } });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
  fireEvent.change(password, { target: { value: "never-render-this" } });
  fireEvent.click(screen.getByText("Add password"));
  await waitFor(() => expect(browserPasswordSave).toHaveBeenCalledWith("https://example.test", "alice", "never-render-this"));
  expect(password.value).toBe(""); expect(view.container.innerHTML).not.toContain("never-render-this");
  expect(localStorage.getItem("password")).toBeNull();
});
it("lists metadata, deletes entries and removes never-save sites", async () => {
  vi.mocked(browserPasswordsList).mockResolvedValueOnce({ entries: [{ id: "login", origin: "https://example.test", username: "alice", createdAt: 1, lastUsedAt: null }], never: ["https://blocked.test"] });
  render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={vi.fn()} />);
  expect(await screen.findByText("alice")).toBeTruthy();
  fireEvent.click(screen.getByText("Delete"));
  await waitFor(() => expect(browserPasswordDelete).toHaveBeenCalledWith("login"));
  await waitFor(() => expect(screen.getByText("Add password")).not.toHaveProperty("disabled", true));
  vi.mocked(browserPasswordsList).mockResolvedValueOnce({ entries: [], never: ["https://blocked.test"] });
  cleanup();
  render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={vi.fn()} />);
  fireEvent.click(await screen.findByText("Remove"));
  await waitFor(() => expect(browserPasswordUnblock).toHaveBeenCalledWith("https://blocked.test"));
});
it("defaults password toggles on and persists the user's choices", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={save} />);
  const offer = screen.getByRole("button", { name: "Offer to save passwords" });
  const auth = screen.getByRole("button", { name: "Require authentication to fill" });
  expect(offer.getAttribute("aria-pressed")).toBe("true"); expect(auth.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(offer); fireEvent.click(auth);
  fireEvent.click(screen.getByText("Save browser settings"));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ browser: expect.objectContaining({ offerToSavePasswords: false, requireAuthToFill: false }) })));
});

it("defaults session persistence on for old settings and saves opting out", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={save} />);
  const toggle = screen.getByRole("button", { name: "Stay signed in after restart" });
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(toggle);
  fireEvent.click(screen.getByText("Save browser settings"));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ browser: expect.objectContaining({ keepSessions: false }) })));
  cleanup();
  render(<SettingsBrowserSection appSettings={{ browser: { keepSessions: false } } as AppSettings} onUpdateAppSettings={save} />);
  expect(screen.getByRole("button", { name: "Stay signed in after restart" }).getAttribute("aria-pressed")).toBe("false");
});

it("clears the password even when saving fails", async () => {
  vi.mocked(browserPasswordSave).mockRejectedValueOnce("Cannot save password to Keychain");
  render(<SettingsBrowserSection appSettings={{} as AppSettings} onUpdateAppSettings={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Origin URL"), { target: { value: "https://example.test" } });
  const password = screen.getByLabelText("Password") as HTMLInputElement;
  fireEvent.change(password, { target: { value: "discard-after-failure" } });
  fireEvent.click(screen.getByText("Add password"));
  expect(await screen.findByText("Cannot save password to Keychain")).toBeTruthy();
  expect(password.value).toBe("");
});
