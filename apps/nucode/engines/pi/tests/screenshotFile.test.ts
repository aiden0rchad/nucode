import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCREENSHOT_TOOL, saveScreenshot, screenshotFilename } from "../extensions/lib/screenshotFile.ts";

const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");

test("finds the filename on direct calls and on xd:// device writes", () => {
  assert.equal(screenshotFilename(SCREENSHOT_TOOL, { filename: "shots/a.png" }, undefined), "shots/a.png");
  assert.equal(screenshotFilename("write", { path: `xd://${SCREENSHOT_TOOL}`, content: "{}" }, { xdev: { tool: SCREENSHOT_TOOL, args: { filename: "b.png", scale: "css" } } }), "b.png");
  assert.equal(screenshotFilename("write", { path: `xd://${SCREENSHOT_TOOL}`, content: JSON.stringify({ filename: "c.png" }) }, undefined), "c.png");
  assert.equal(screenshotFilename(SCREENSHOT_TOOL, { scale: "css" }, undefined), undefined);
  assert.equal(screenshotFilename("write", { path: "notes.md", content: "{\"filename\":\"x.png\"}" }, undefined), undefined);
});

test("saves the returned image where the thread may write, and says why when it doesn't", t => {
  const dir = mkdtempSync(join(tmpdir(), "nucode-shot-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const image = [{ type: "image", data: png, mimeType: "image/png" }];
  assert.match(saveScreenshot(image, "phase/shots/a.png", dir, () => true), /^Saved the screenshot to .*phase\/shots\/a\.png\.$/);
  assert.deepEqual(readFileSync(join(dir, "phase/shots/a.png")), Buffer.from(png, "base64"));
  assert.match(saveScreenshot(image, "b.png", dir, () => false), /^Not saved to .*b\.png: this thread can't write there/);
  assert.equal(existsSync(join(dir, "b.png")), false);
  assert.match(saveScreenshot(image, "c.jpg", dir, () => true), /give the filename a \.png extension/);
  assert.match(saveScreenshot([{ type: "text", text: "Error" }], "d.png", dir, () => true), /^No image came back/);
});
