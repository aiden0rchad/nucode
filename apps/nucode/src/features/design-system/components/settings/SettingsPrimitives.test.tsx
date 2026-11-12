// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { SettingsBadge, SettingsButton, SettingsCallout, SettingsEmpty, SettingsFieldRow, SettingsGroup, SettingsKeycaps, SettingsListRow, SettingsPage, SettingsSection, SettingsSelect, SettingsSegmented, SettingsStatus, SettingsSwitchRow, SettingsTextField, SettingsToggleSwitch, SettingsUnsaved } from "./SettingsPrimitives";
import { shortcutKeys } from "@settings/components/sections/SettingsShortcutsSection";

afterEach(cleanup);

it("shows concise labels, full tooltips and rich options with keyboard and pointer selection", () => {
  function Example() {
    const [value, setValue] = useState("background");
    return <SettingsFieldRow title="Input mode"><SettingsSelect value={value} onChange={event => setValue(event.target.value)}><option value="background" data-description="You can keep using your Mac." data-recommended>Background</option><option value="disabled" disabled>Unavailable</option><option value="foreground" data-description="Takes over the mouse.">Foreground</option></SettingsSelect></SettingsFieldRow>;
  }
  render(<Example />);
  const select = screen.getByRole("combobox", { name: "Input mode" }) as HTMLSelectElement;
  expect(select.title).toBe("Background — Recommended — You can keep using your Mac.");
  fireEvent.mouseDown(select);
  const list = screen.getByRole("listbox");
  expect(within(list).getByText("Recommended")).toBeTruthy();
  expect(within(list).getByText("You can keep using your Mac.")).toBeTruthy();
  fireEvent.keyDown(select, { key: "ArrowDown" });
  fireEvent.keyDown(select, { key: "Enter" });
  expect(select.value).toBe("foreground");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.mouseDown(select);
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /Background/ }));
  expect(select.value).toBe("background");
  fireEvent.keyDown(select, { key: "End" });
  fireEvent.keyDown(select, { key: "Escape" });
  expect(select.value).toBe("background");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.mouseDown(select);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("shows the complete selected label while preserving native selection and its accessible label", () => {
  function Example() {
    const [value, setValue] = useState("background");
    return <SettingsFieldRow title="Input mode"><SettingsSelect value={value} onChange={event => setValue(event.target.value)}><option value="background">Background (recommended): you can keep using your Mac</option><option value="foreground">Foreground: takes over the mouse</option></SettingsSelect></SettingsFieldRow>;
  }
  render(<Example />);
  const select = screen.getByRole("combobox", { name: "Input mode" });
  expect(screen.getByText("Background (recommended): you can keep using your Mac", { selector: ".settings-select-label" })).toBeTruthy();
  fireEvent.change(select, { target: { value: "foreground" } });
  expect(screen.getByText("Foreground: takes over the mouse", { selector: ".settings-select-label" })).toBeTruthy();
});

it("keeps nested controls disabled when a group is busy without native fieldsets", () => {
  const click = vi.fn();
  const { container } = render(<SettingsGroup title="Busy" disabled><SettingsTextField aria-label="Name" /><SettingsGroup><SettingsSelect aria-label="Model"><option>Default</option></SettingsSelect><SettingsToggleSwitch aria-label="Enable" pressed onClick={click} /><SettingsButton onClick={click}>Save</SettingsButton></SettingsGroup></SettingsGroup>);
  expect(container.querySelector("fieldset")).toBeNull();
  for (const control of container.querySelectorAll("input, select, button")) expect(control.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(click).not.toHaveBeenCalled();
});

it("moves tab selection and focus with the keyboard, skipping disabled tabs", () => {
  function Example() {
    const [value, setValue] = useState("defaults");
    return <SettingsSegmented tabs label="Models & Agents" value={value} onChange={setValue} options={[{ value: "defaults", label: "Defaults" }, { value: "roles", label: "Roles", disabled: true }, { value: "engines", label: "Engines" }]} />;
  }
  render(<Example />);
  fireEvent.keyDown(screen.getByRole("tab", { name: "Defaults" }), { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Engines", selected: true })).toBe(document.activeElement);
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(screen.getByRole("tab", { name: "Defaults", selected: true })).toBe(document.activeElement);
});

it("lays out a page with header actions, an untitled group and no filler title", () => {
  const { container } = render(<SettingsPage title="Server" subtitle="Connect." actions={<SettingsButton>Save</SettingsButton>} wide><SettingsSection title="Unused" subtitle="x"><SettingsSwitchRow title="Notify" subtitle="Tell me." pressed onClick={() => {}} /></SettingsSection></SettingsPage>);
  expect(screen.getByRole("heading", { level: 2, name: "Server" })).toBeTruthy();
  expect(container.querySelector(".settings-page.is-wide .settings-page-header .settings-page-actions")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Preferences" })).toBeNull();
  expect(container.querySelector(".settings-group-header")).toBeNull();
  expect(container.querySelector(".settings-group-card .settings-row .settings-toggle-subtitle")?.textContent).toBe("Tell me.");
  expect(screen.getByRole("button", { name: "Notify" }).getAttribute("aria-pressed")).toBe("true");
});

it("shows a group header with a description and actions, and disables dependent rows", () => {
  const { container } = render(<SettingsGroup title="Providers" subtitle="Turn one off to hide it." actions={<SettingsButton>Add</SettingsButton>}><SettingsSwitchRow title="Hint" pressed={false} disabled onClick={() => {}} /></SettingsGroup>);
  expect(container.querySelector(".settings-group-header .settings-group-actions")?.textContent).toBe("Add");
  expect(screen.getByText("Turn one off to hide it.").className).toBe("settings-group-description");
  expect((screen.getByRole("button", { name: "Hint" }) as HTMLButtonElement).disabled).toBe(true);
  expect(container.querySelector(".settings-row.is-disabled")).toBeTruthy();
});

it("renders list rows, status dots, callouts, badges, empty states and keycaps", () => {
  const { container } = render(<SettingsGroup><SettingsListRow icon="P" title="pi" badge={<SettingsBadge>Default</SettingsBadge>} meta={<SettingsStatus tone="ready">Ready · v1.4.0</SettingsStatus>}><SettingsToggleSwitch aria-label="Enable pi" pressed onClick={() => {}} /></SettingsListRow><SettingsCallout tone="warning">Token missing</SettingsCallout><SettingsCallout tone="error">Failed</SettingsCallout><SettingsEmpty action={<SettingsButton>Add</SettingsButton>}>Nothing here.</SettingsEmpty><SettingsKeycaps keys={["⌘", "⇧", "N"]} /></SettingsGroup>);
  expect(container.querySelector(".settings-list-row .settings-list-name .settings-badge")?.textContent).toBe("Default");
  expect(container.querySelector(".settings-status.is-ready .settings-status-dot")).toBeTruthy();
  expect(screen.getByRole("status", { name: "" }).textContent).toBe("Token missing");
  expect(screen.getByRole("alert").textContent).toBe("Failed");
  expect(screen.getByText("Nothing here.")).toBeTruthy();
  expect([...container.querySelectorAll(".settings-keycap")].map(key => key.textContent)).toEqual(["⌘", "⇧", "N"]);
});

it("stacks a field row's control under its text when asked", () => {
  const { container } = render(<SettingsFieldRow stacked title="Arguments" subtitle="One per line."><SettingsTextField /></SettingsFieldRow>);
  expect(container.querySelector(".settings-field-row.settings-field-row-long")).toBeTruthy();
  expect(container.querySelector(".settings-field-info")?.textContent).toContain("One per line.");
});

it("splits shortcut labels into one keycap per key", () => {
  expect(shortcutKeys("⌘⇧N")).toEqual(["⌘", "⇧", "N"]);
  expect(shortcutKeys("⇧tab")).toEqual(["⇧", "Tab"]);
  expect(shortcutKeys("⌘⌃↓")).toEqual(["⌘", "⌃", "↓"]);
  expect(shortcutKeys("Ctrl+Alt+Down")).toEqual(["Ctrl", "Alt", "Down"]);
});

it("shows the save controls only while there are unsaved edits", () => {
  const discard = vi.fn(), save = vi.fn();
  const { container, rerender } = render(<SettingsUnsaved dirty={false} onDiscard={discard} onSave={save} />);
  expect(container.textContent).toBe("");
  rerender(<SettingsUnsaved dirty onDiscard={discard} onSave={save} />);
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(discard).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
});
