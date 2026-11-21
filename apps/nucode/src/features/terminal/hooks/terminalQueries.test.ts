import { describe, expect, it } from "vitest";
import { stripTerminalQueries } from "./terminalQueries";

describe("stripTerminalQueries", () => {
  it("removes device, cursor and colour queries and keeps text", () => {
    const history =
      "a\x1b[c\x1b[6n\x1b]11;?\x07b\x1b]10;?\x1b\\c\x1bZ\x1b[>q\x1b[?2004$p\x1bP$qm\x1b\\d\x1b]4;1;?;2;?\x07";
    expect(stripTerminalQueries(history)).toBe("abcd");
  });

  it("keeps styling, setters and truncated sequences", () => {
    const keep = "\x1b[31mred\x1b[0m\x1b[2 q\x1b]0;title\x07\x1b[2J\x1b[u\x1b]11;rgb:00/00/00\x07".replace(
      "\x1b]11;rgb:00/00/00\x07",
      "",
    );
    expect(stripTerminalQueries(keep)).toBe(keep);
    expect(stripTerminalQueries("x\x1b[6")).toBe("x\x1b[6");
    expect(stripTerminalQueries("x\x1b")).toBe("x\x1b");
    expect(stripTerminalQueries("plain")).toBe("plain");
  });
});
