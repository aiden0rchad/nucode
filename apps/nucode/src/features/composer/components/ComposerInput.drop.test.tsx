/** @vitest-environment jsdom */
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerInput } from "./ComposerInput";

type DropEvent = { payload: { type: string; position: { x: number; y: number }; paths?: string[] } };
const webviewHandlers: Array<(event: DropEvent) => void> = [];
const windowListen = vi.fn();

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (event: DropEvent) => void) => {
      webviewHandlers.push(handler);
      return Promise.resolve(() => {});
    },
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: windowListen }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://${path}`,
}));

function Harness({
  projectPath,
  disabled = false,
  onAttachImages,
  initialText = "",
}: {
  projectPath: string | null;
  disabled?: boolean;
  onAttachImages: (paths: string[]) => void;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ComposerInput
      text={text}
      disabled={disabled}
      sendLabel="Send"
      canStop={false}
      canSend={false}
      isProcessing={false}
      onStop={() => {}}
      onSend={() => {}}
      projectPath={projectPath}
      onAttachImages={onAttachImages}
      onTextChange={(next) => setText(next)}
      onSelectionChange={() => {}}
      onKeyDown={() => {}}
      textareaRef={textareaRef}
      suggestionsOpen={false}
      suggestions={[]}
      highlightIndex={0}
      onHighlightIndex={() => {}}
      onSelectSuggestion={() => {}}
    />
  );
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function mount(props: Parameters<typeof Harness>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness {...props} />);
  });
  const area = container.querySelector(".composer-input-area") as HTMLElement;
  area.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 200 }) as DOMRect;
}

const frames: FrameRequestCallback[] = [];

function drop(paths: string[], position = { x: 50, y: 50 }) {
  act(() => {
    for (const handler of webviewHandlers) handler({ payload: { type: "drop", position, paths } });
  });
  // Animation frames run after React has committed the new text.
  act(() => {
    frames.splice(0).forEach((callback) => callback(0));
  });
}

const textarea = () => container.querySelector("textarea") as HTMLTextAreaElement;

beforeEach(() => {
  webviewHandlers.length = 0;
  windowListen.mockReset();
  frames.length = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ComposerInput native drops", () => {
  it("receives a drop through the webview subscription, not the window one", async () => {
    await mount({ projectPath: "/projects/demo", onAttachImages: vi.fn() });
    expect(webviewHandlers).toHaveLength(1);
    expect(windowListen).not.toHaveBeenCalled();
    drop(["/projects/demo/src/app.ts"]);
    expect(textarea().value).toBe("src/app.ts ");
  });

  it("attaches images and inserts the other paths in drop order", async () => {
    const onAttachImages = vi.fn();
    await mount({ projectPath: "/projects/demo", onAttachImages });
    drop([
      "/projects/demo/shot.png",
      "/projects/demo/src/app.ts",
      "/elsewhere/data.csv",
      "/projects/demo/my notes.txt",
      "/projects/demo/docs",
      "/elsewhere/photo.JPG",
    ]);
    expect(onAttachImages).toHaveBeenCalledWith(["/projects/demo/shot.png", "/elsewhere/photo.JPG"]);
    expect(textarea().value).toBe('src/app.ts /elsewhere/data.csv "my notes.txt" docs ');
  });

  it("inserts absolute paths when no project is known", async () => {
    await mount({ projectPath: null, onAttachImages: vi.fn() });
    drop(["/projects/demo/src/app.ts"]);
    expect(textarea().value).toBe("/projects/demo/src/app.ts ");
  });

  it("inserts at the caret, replacing the selection, and leaves the caret after the paths", async () => {
    await mount({ projectPath: "/projects/demo", onAttachImages: vi.fn(), initialText: "look at  please" });
    textarea().setSelectionRange(8, 8);
    drop(["/projects/demo/a.ts", "/projects/demo/b.ts"]);
    expect(textarea().value).toBe("look at a.ts b.ts  please");
    expect(textarea().selectionStart).toBe(8 + "a.ts b.ts ".length);
  });

  it("ignores drops outside the composer and while disabled", async () => {
    const onAttachImages = vi.fn();
    await mount({ projectPath: "/projects/demo", onAttachImages });
    drop(["/projects/demo/a.ts", "/projects/demo/a.png"], { x: 900, y: 900 });
    expect(textarea().value).toBe("");
    expect(onAttachImages).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
    webviewHandlers.length = 0;
    await mount({ projectPath: "/projects/demo", onAttachImages, disabled: true });
    expect(webviewHandlers).toHaveLength(0);
  });

  it("shows the drop highlight for non-image files too", async () => {
    await mount({ projectPath: "/projects/demo", onAttachImages: vi.fn() });
    act(() => {
      for (const handler of webviewHandlers) handler({ payload: { type: "enter", position: { x: 10, y: 10 }, paths: ["/projects/demo/a.ts"] } });
    });
    expect(container.querySelector(".composer-input-area.is-drag-over")).toBeTruthy();
    expect(container.querySelector(".composer-drop-overlay")).toBeTruthy();
  });
});
