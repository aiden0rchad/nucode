// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { expectOpenedFileTarget } from "../test/fileLinkAssertions";
import { TranscriptMessage } from "./TranscriptMessage";

afterEach(cleanup);

it.each([['user', 'You'], ['assistant', 'Assistant']] as const)("preserves Chat's %s DOM and action order", (role, heading) => {
  const copy = vi.fn();
  const { container } = render(<TranscriptMessage role={role} text="**Hello**" images={["first.png", "second.png"]} actions={<><button aria-label="Copy message" onClick={copy}>Copy</button><button disabled>Edit and resend</button></>} />);
  expect(container.innerHTML).toBe(`<article class="message chat-message ${role}"><div class="chat-message-body"><h2>${heading}</h2><img alt="Attachment 1" src="first.png"><img alt="Attachment 2" src="second.png"><div class="markdown"><p><strong>Hello</strong></p></div></div><div class="message-hover-actions"><button aria-label="Copy message">Copy</button><button disabled="">Edit and resend</button></div></article>`);
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  expect(copy).toHaveBeenCalledOnce();
});

it("keeps message code blocks and Work file links", () => {
  const onOpenFileLink = vi.fn();
  const { container } = render(<TranscriptMessage role="assistant" text={'[Report](/synthetic/outputs/report.md)\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```'} fileLinks={{ workspacePath: "/synthetic", onOpenFileLink }} />);
  fireEvent.click(screen.getByRole("link", { name: "Report" }));
  expectOpenedFileTarget(onOpenFileLink, "/synthetic/outputs/report.md");
  expect(screen.getByRole("link", { name: "Report" }).textContent).toBe("Report");
  expect(screen.getByRole("button", { name: "Copy code block" }).closest(".chat-message-body .markdown .markdown-codeblock")).toBeTruthy();
  expect(container.querySelector(".message-hover-actions")).toBeNull();
});

it("preserves the pending message label without adding images or actions", () => {
  const { container } = render(<TranscriptMessage role="user" text="Waiting" aria-label="Waiting to send" />);
  expect(screen.getByRole("article", { name: "Waiting to send" }).className).toBe("message chat-message user");
  expect(screen.getByRole("heading", { name: "You", level: 2 })).toBeTruthy();
  expect(container.querySelector("img, .message-hover-actions")).toBeNull();
});

it("applies Work bubble rules once and preserves the separate task brief", async () => {
  const { container } = render(<div className="work-layout"><TranscriptMessage role="user" text="Follow-up" /><article className="message chat-message user"><h2>Task brief</h2></article></div>);
  const row = container.querySelector("article")!;
  const body = row.querySelector(".chat-message-body")!;
  const brief = container.querySelectorAll("article")[1];
  const { readFileSync } = await vi.importActual<{ readFileSync: (path: string, encoding: "utf8") => string }>("node:fs");
  const styles = readFileSync("src/styles/visual-refresh.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bubbleRules = [...styles.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(match => match[1].trim()).filter(selector => selector.includes(".work-layout .chat-message.user"));
  expect(bubbleRules).toHaveLength(3);
  for (const selector of bubbleRules) {
    expect(row.matches(selector)).toBe(false);
    expect(body.matches(selector)).toBe(true);
    expect(brief.matches(selector)).toBe(true);
  }
});
