import { listThreadHistory, readThread } from "@services/tauri";
import { pushErrorToast } from "@services/toasts";
import { buildItemsFromThread } from "@utils/threadItems";
import { extractThreadFromResponse } from "@threads/utils/threadSummary";
import type { ConversationItem } from "@/types";

/** Upper bound on older-history pages fetched for one export. */
export const MAX_HISTORY_PAGES = 200;

/**
 * Reads a whole thread without side effects: no resume (so no engine process is
 * started), no dispatch to thread state, no timers. Older history pages are
 * fetched until there are none left.
 */
export async function readThreadItems(
  workspaceId: string,
  threadId: string,
): Promise<ConversationItem[]> {
  const thread = extractThreadFromResponse(await readThread(workspaceId, threadId));
  if (!thread) {
    return [];
  }
  let items = buildItemsFromThread(thread);
  let cursor = typeof thread.historyCursor === "string" && thread.historyCursor ? thread.historyCursor : null;
  const seen = new Set<string>();
  let pages = 0;
  while (cursor) {
    if (pages >= MAX_HISTORY_PAGES || seen.has(cursor)) {
      pushErrorToast({
        title: "Chat history is incomplete",
        message: "Only part of the older history could be loaded, so the result may be missing the start of the chat.",
      });
      break;
    }
    seen.add(cursor);
    pages += 1;
    const page = await listThreadHistory(workspaceId, threadId, cursor);
    items = [...buildItemsFromThread({ turns: page.data }), ...items];
    cursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
  }
  return items;
}
