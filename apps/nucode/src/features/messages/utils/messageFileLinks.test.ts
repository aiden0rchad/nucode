import { describe, expect, it } from "vitest";
import { formatFileLocation } from "../../../utils/fileLinks";
import { relativeDisplayPath, resolveMessageFileHref } from "./messageFileLinks";

function expectResolvedHref(url: string, expected: string | null) {
  const resolved = resolveMessageFileHref(url);
  const formatted = resolved
    ? formatFileLocation(resolved.path, resolved.line, resolved.column)
    : null;
  expect(formatted).toBe(expected);
}

describe("resolveMessageFileHref", () => {
  it("resolves short relative file links only with workspace context", () => {
    expectResolvedHref("outputs/report.md", null);
    expect(resolveMessageFileHref("outputs/report.md", "/project")).toEqual({ path: "outputs/report.md", line: null, column: null });
    expect(resolveMessageFileHref("https://example.com/report.md", "/project")).toBeNull();
    expect(resolveMessageFileHref("/workspace/settings", "/project")).toBeNull();
  });
  it("ignores non-line file URL fragments", () => {
    expectResolvedHref("file:///tmp/report.md#overview", "/tmp/report.md");
  });

  it("preserves line anchors for file URLs", () => {
    expectResolvedHref("file:///tmp/report.md#L12", "/tmp/report.md:12");
  });

  it("preserves Windows drive paths with unescaped percent characters", () => {
    expectResolvedHref("file:///C:/repo/100%.tsx#L12", "C:/repo/100%.tsx:12");
  });

  it("preserves UNC host paths with unescaped percent characters", () => {
    expectResolvedHref("file://server/share/100%.tsx#L12", "//server/share/100%.tsx:12");
  });

  it("keeps encoded #L-like filenames intact for file URLs", () => {
    expectResolvedHref("file:///tmp/report%23L12.md", "/tmp/report#L12.md");
    expectResolvedHref("file:///tmp/%23L12", "/tmp/#L12");
  });

  it("keeps encoded #L-like filename endings intact for markdown hrefs", () => {
    expectResolvedHref("./report.md%23L12", "./report.md#L12");
    expectResolvedHref("./report.md%23L12C3", "./report.md#L12C3");
  });
});

describe("relativeDisplayPath", () => {
  it("shortens paths inside or near the project and shows far ones whole", () => {
    expect(relativeDisplayPath("/work/app/src/main.ts", "/work/app")).toBe("src/main.ts");
    expect(relativeDisplayPath("/work/app", "/work/app")).toBe("app");
    expect(relativeDisplayPath("/tmp/notes/brief.md", "/work/app")).toBe("/tmp/notes/brief.md");
    expect(relativeDisplayPath("/work/other/readme.md", "/work/app")).toBe("../other/readme.md");
    expect(relativeDisplayPath("/tmp/notes/brief.md", "/home/me/work/app")).toBe("/tmp/notes/brief.md");
    expect(relativeDisplayPath("C:/Temp/notes.md", "C:/Work/app")).toBe("C:/Temp/notes.md");
    expect(relativeDisplayPath("C:/Work/other/a.md", "C:/Work/app")).toBe("../other/a.md");
  });
});
