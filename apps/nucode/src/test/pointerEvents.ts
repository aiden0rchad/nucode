import { afterEach, beforeEach, vi } from "vitest";

export function setupPointerEvents() {
  const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      readonly pointerId: number;
      readonly isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.isPrimary = init.isPrimary ?? true;
      }
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => null) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
    else Reflect.deleteProperty(document, "elementFromPoint");
  });
}
