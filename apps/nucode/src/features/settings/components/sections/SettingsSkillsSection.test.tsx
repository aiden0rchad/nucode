// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { pickWorkspacePath, skillsRequest } from "@services/tauri";
import { SettingsSkillsSection } from "./SettingsSkillsSection";

vi.mock("@services/tauri", () => ({ skillsRequest: vi.fn(), pickWorkspacePath: vi.fn() }));
const saved = vi.fn();
function Harness({ initial = {} }: { initial?: Partial<AppSettings> }) {
  const [settings, setSettings] = useState({ codegraphEnabled: true, ...initial } as AppSettings);
  return <SettingsSkillsSection appSettings={settings} onUpdateAppSettings={async next => { saved(next); setSettings(next); }} />;
}
const library = { name: "council", description: "Convene the council", path: "/lib/council", source: "library", enabled: true };
const claude = { name: "review", description: "Review code", path: "/c/review", source: "claudeCode", enabled: true };
describe("Skills settings", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(skillsRequest).mockImplementation(async (action) => (action === "resolve" ? { skills: [library, claude].map(skill => ({ ...skill, enabled: !(saved.mock.lastCall?.[0].skills?.disabled ?? []).includes(skill.name) })), warnings: [{ path: "/c/bad", message: "Skipped: SKILL.md has no description in its frontmatter" }] } : null) as never);
  });
  it("lists skills with their source, warnings and the three folders switched off", async () => {
    render(<Harness />);
    await screen.findByText("council");
    expect(screen.getByText("nucode")).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Skipped: SKILL.md has no description in its frontmatter")).toBeTruthy();
    for (const folder of ["~/.claude/skills", "~/.codex/skills", "~/.agents/skills"]) expect(screen.getByText(folder)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Codex skills" }).getAttribute("aria-pressed")).toBe("false");
    // Only library skills can be removed.
    expect(screen.getByRole("button", { name: "Remove council" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove review" })).toBeNull();
  });
  it("saves source toggles and per-skill switches into the skills settings", async () => {
    render(<Harness />);
    await screen.findByText("council");
    fireEvent.click(screen.getByRole("button", { name: "Use Claude Code skills" }));
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({ skills: { sources: { claudeCode: true, codex: false, agents: false }, disabled: [] } })));
    fireEvent.click(screen.getByRole("button", { name: "Disable council" }));
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({ skills: { sources: { claudeCode: true, codex: false, agents: false }, disabled: ["council"] } })));
    fireEvent.click(await screen.findByRole("button", { name: "Enable council" }));
    await waitFor(() => expect(saved.mock.lastCall?.[0].skills.disabled).toEqual([]));
  });
  it("installs from an address, offers replace on a name clash and removes library skills", async () => {
    render(<Harness />);
    await screen.findByText("council");
    const field = screen.getByPlaceholderText("https://github.com/owner/repo");
    expect((screen.getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "https://github.com/t3dotgg/tstack" } });
    vi.mocked(skillsRequest).mockImplementationOnce(async () => ({ installed: [], conflicts: ["council"], warnings: [] }) as never);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await screen.findByText(/Already installed: council/);
    expect(skillsRequest).toHaveBeenCalledWith("install", { source: "https://github.com/t3dotgg/tstack", replace: false });
    vi.mocked(skillsRequest).mockImplementationOnce(async () => ({ installed: ["council"], conflicts: [], warnings: [] }) as never);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await screen.findByText(/Installed council/);
    expect(skillsRequest).toHaveBeenCalledWith("install", { source: "https://github.com/t3dotgg/tstack", replace: true });
    fireEvent.click(screen.getByRole("button", { name: "Remove council" }));
    await waitFor(() => expect(skillsRequest).toHaveBeenCalledWith("remove", { name: "council" }));
  });
  it("fills the field from the folder picker and shows install errors", async () => {
    vi.mocked(pickWorkspacePath).mockResolvedValue("/Users/me/skills");
    render(<Harness />);
    await screen.findByText("council");
    fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
    await waitFor(() => expect((screen.getByPlaceholderText("https://github.com/owner/repo") as HTMLInputElement).value).toBe("/Users/me/skills"));
    vi.mocked(skillsRequest).mockRejectedValueOnce("No skills found: a skill is a folder with a SKILL.md file");
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No skills found");
  });
});
