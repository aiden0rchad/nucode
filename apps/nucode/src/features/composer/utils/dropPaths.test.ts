import { describe, expect, it } from "vitest";
import { droppedPathsText, formatDroppedPath, isImagePath } from "./dropPaths";

describe("dropped paths", () => {
  it("recognises images by extension", () => {
    expect(isImagePath("/projects/demo/shot.PNG")).toBe(true);
    expect(isImagePath("/projects/demo/notes.txt")).toBe(false);
  });

  it("is relative inside the project and absolute outside", () => {
    expect(formatDroppedPath("/projects/demo/src/app.ts", "/projects/demo")).toBe("src/app.ts");
    expect(formatDroppedPath("/projects/demo/src/app.ts", "/projects/demo/")).toBe("src/app.ts");
    expect(formatDroppedPath("/projects/other/app.ts", "/projects/demo")).toBe("/projects/other/app.ts");
    expect(formatDroppedPath("/projects/demo-two/app.ts", "/projects/demo")).toBe("/projects/demo-two/app.ts");
    expect(formatDroppedPath("/projects/demo", "/projects/demo")).toBe("/projects/demo");
  });

  it("is absolute when no project is known", () => {
    expect(formatDroppedPath("/projects/demo/src/app.ts", null)).toBe("/projects/demo/src/app.ts");
  });

  it("quotes paths with spaces and handles Windows separators", () => {
    expect(formatDroppedPath("/projects/demo/my notes.txt", "/projects/demo")).toBe('"my notes.txt"');
    expect(formatDroppedPath("/elsewhere/my notes.txt", "/projects/demo")).toBe('"/elsewhere/my notes.txt"');
    expect(formatDroppedPath("C:\\work\\demo\\src\\app.ts", "C:\\work\\demo")).toBe("src\\app.ts");
  });

  it("follows each path with one space, in order", () => {
    expect(droppedPathsText(["/projects/demo/a.ts", "/x/b c.ts"], "/projects/demo")).toBe('a.ts "/x/b c.ts" ');
  });
});
