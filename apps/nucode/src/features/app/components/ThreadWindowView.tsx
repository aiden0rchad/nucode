import type { CSSProperties, ReactNode, RefObject } from "react";
import { ChatPane } from "@/features/layout/components/ChatPane";
import { isMacPlatform } from "@utils/platformPaths";
import "./thread-window.css";

type ThreadWindowViewProps = {
  title: string;
  /** False until the conversation is open; the window then shows a placeholder instead of an empty thread. */
  ready: boolean;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  approvalToastsNode: ReactNode;
  errorToastsNode: ReactNode;
  appStyle: CSSProperties;
  appRef: RefObject<HTMLDivElement | null>;
};

/** A thread window: the thread's name over its transcript and composer, and nothing else. */
export function ThreadWindowView({
  title,
  ready,
  messagesNode,
  composerNode,
  approvalToastsNode,
  errorToastsNode,
  appStyle,
  appRef,
}: ThreadWindowViewProps) {
  return (
    <div className={`thread-window${isMacPlatform() ? " is-mac" : ""}`} style={appStyle} ref={appRef}>
      <header className="thread-window-bar" data-tauri-drag-region>
        <span className="thread-window-title" data-tauri-drag-region>
          {title}
        </span>
      </header>
      {errorToastsNode}
      {approvalToastsNode}
      <div className="thread-window-body">
        {ready ? (
          <ChatPane messagesNode={messagesNode} composerNode={composerNode} />
        ) : (
          <p className="thread-window-empty" role="status">
            Opening conversation…
          </p>
        )}
      </div>
    </div>
  );
}
