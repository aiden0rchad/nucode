// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LaunchScriptButton } from "./LaunchScriptButton";

afterEach(cleanup);

it.each([
  [null, "Set launch script"],
  [" \n ", "Set launch script"],
  ["  npm run dev  \r\nnpm run build", "Run launch script: npm run dev"],
  ["x".repeat(60), `Run launch script: ${"x".repeat(60)}`],
  ["x".repeat(61), `Run launch script: ${"x".repeat(59)}…`],
])("names the script in accessible labels without widening Run (%s)", (launchScript, label) => {
  const onRun = vi.fn();
  const onOpenEditor = vi.fn();
  render(<LaunchScriptButton launchScript={launchScript} editorOpen={false} draftScript="" isSaving={false} error={null}
    onRun={onRun} onOpenEditor={onOpenEditor} onCloseEditor={vi.fn()} onDraftChange={vi.fn()} onSave={vi.fn()} />);
  const button = screen.getByRole("button", { name: label });
  expect(button.title).toBe(label);
  expect(button.getAttribute("data-tooltip")).toBe(label);
  expect(button.textContent).toBe("Run");
  fireEvent.click(button);
  expect(onRun).toHaveBeenCalledOnce();
  fireEvent.contextMenu(button);
  expect(onOpenEditor).toHaveBeenCalledOnce();
});
