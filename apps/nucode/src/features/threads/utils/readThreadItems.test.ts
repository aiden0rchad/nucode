import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_HISTORY_PAGES, readThreadItems } from "./readThreadItems";

const readThread = vi.hoisted(() => vi.fn());
const listThreadHistory = vi.hoisted(() => vi.fn());
const resumeThread = vi.hoisted(() => vi.fn());
const pushErrorToast = vi.hoisted(() => vi.fn());

vi.mock("@services/tauri", () => ({
  readThread: (...args: unknown[]) => readThread(...args),
  listThreadHistory: (...args: unknown[]) => listThreadHistory(...args),
  resumeThread: (...args: unknown[]) => resumeThread(...args),
}));
vi.mock("@services/toasts", () => ({
  pushErrorToast: (...args: unknown[]) => pushErrorToast(...args),
}));

const turn = (id: string, text: string) => ({
  id,
  status: "completed",
  items: [{ type: "userMessage", id: `${id}-u`, content: [{ type: "text", text, text_elements: [] }] }],
});

const texts = (items: Array<{ kind: string; text?: string }>) =>
  items.filter((item) => item.kind === "message").map((item) => item.text);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readThreadItems", () => {
  it("reads a thread without resuming it", async () => {
    readThread.mockResolvedValue({ result: { thread: { id: "t", turns: [turn("a", "hello")] } } });
    const items = await readThreadItems("ws", "t");
    expect(texts(items)).toEqual(["hello"]);
    expect(readThread).toHaveBeenCalledWith("ws", "t");
    expect(resumeThread).not.toHaveBeenCalled();
    expect(listThreadHistory).not.toHaveBeenCalled();
  });

  it("pages older history until there is none left, oldest first", async () => {
    readThread.mockResolvedValue({
      result: { thread: { id: "t", historyCursor: "c1", turns: [turn("c", "third")] } },
    });
    listThreadHistory
      .mockResolvedValueOnce({ data: [turn("b", "second")], nextCursor: "c2" })
      .mockResolvedValueOnce({ data: [turn("a", "first")], nextCursor: null });
    const items = await readThreadItems("ws", "t");
    expect(texts(items)).toEqual(["first", "second", "third"]);
    expect(listThreadHistory.mock.calls.map((call) => call[2])).toEqual(["c1", "c2"]);
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("stops and says so when the page cap is hit", async () => {
    readThread.mockResolvedValue({
      result: { thread: { id: "t", historyCursor: "c0", turns: [turn("z", "latest")] } },
    });
    let n = 0;
    listThreadHistory.mockImplementation(async () => {
      n += 1;
      return { data: [turn(`p${n}`, `page ${n}`)], nextCursor: `c${n}` };
    });
    const items = await readThreadItems("ws", "t");
    expect(listThreadHistory).toHaveBeenCalledTimes(MAX_HISTORY_PAGES);
    expect(items.length).toBe(MAX_HISTORY_PAGES + 1);
    expect(pushErrorToast).toHaveBeenCalledTimes(1);
  });

  it("stops on a repeated cursor and reports it", async () => {
    readThread.mockResolvedValue({
      result: { thread: { id: "t", historyCursor: "same", turns: [] } },
    });
    listThreadHistory.mockResolvedValue({ data: [turn("a", "x")], nextCursor: "same" });
    await readThreadItems("ws", "t");
    expect(listThreadHistory).toHaveBeenCalledTimes(1);
    expect(pushErrorToast).toHaveBeenCalledTimes(1);
  });

  it("returns nothing for an unreadable response", async () => {
    readThread.mockResolvedValue({});
    expect(await readThreadItems("ws", "t")).toEqual([]);
  });
});
