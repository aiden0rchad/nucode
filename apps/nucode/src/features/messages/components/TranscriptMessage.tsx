import type { ComponentProps, ReactNode } from "react";
import type { ConversationItem } from "@/types";
import { Markdown } from "./Markdown";

type TranscriptMessageProps = Pick<Extract<ConversationItem, { kind: "message" }>, "role" | "text" | "images"> & {
  actions?: ReactNode;
  fileLinks?: Pick<ComponentProps<typeof Markdown>, "workspacePath" | "onOpenFileLink">;
  "aria-label"?: string;
};

export function TranscriptMessage({ role, text, images, actions, fileLinks, "aria-label": ariaLabel }: TranscriptMessageProps) {
  return <article className={`message chat-message ${role}`} aria-label={ariaLabel}>
    <div className="chat-message-body">
      <h2>{role === "user" ? "You" : "Assistant"}</h2>
      {images?.map((url, index) => <img key={index} src={url} alt={`Attachment ${index + 1}`} />)}
      <Markdown {...fileLinks} codeBlockStyle="message" className="markdown" value={text} showFilePath={false} />
    </div>
    {actions && <div className="message-hover-actions">{actions}</div>}
  </article>;
}
