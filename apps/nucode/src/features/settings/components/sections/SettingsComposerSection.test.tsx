// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { SettingsComposerSection } from "./SettingsComposerSection";

afterEach(cleanup);

const renderSection = (appSettings: Partial<AppSettings> = {}) => {
  const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
  render(
    <SettingsComposerSection
      appSettings={{ steerEnabled: true, followUpMessageBehavior: "queue", ...appSettings } as AppSettings}
      optionKeyLabel="Option"
      followUpShortcutLabel="Shift+Cmd+Enter"
      composerPresetLabels={{ default: "Default", helpful: "Helpful", smart: "Smart" } as never}
      onComposerPresetChange={vi.fn()}
      onUpdateAppSettings={onUpdateAppSettings}
    />,
  );
  return onUpdateAppSettings;
};

describe("Composer response style", () => {
  it("defaults to Standard and saves In depth as detailed", () => {
    const update = renderSection();
    const select = screen.getByLabelText("Response style") as HTMLSelectElement;
    expect(select.value).toBe("standard");
    expect(Array.from(select.options).map(option => option.text)).toEqual(["Concise", "Standard", "In depth"]);
    fireEvent.change(select, { target: { value: "detailed" } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ responseStyle: "detailed" }));
  });

  it("shows the saved value", () => {
    renderSection({ responseStyle: "concise" });
    expect((screen.getByLabelText("Response style") as HTMLSelectElement).value).toBe("concise");
  });
});
