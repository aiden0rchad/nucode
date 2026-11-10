import { Bot, Code2, FilePenLine, FileText, Globe, Image, ListChecks, MousePointerClick, Search, Terminal, Wrench } from "lucide-react";
import type { ConversationItem } from "../../../types";
import { toolNameFromTitle, describeTool, type ToolDescription } from "./messageRenderUtils";

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

/** The glyph for a tool step, shared by Code's tool rows and Work's steps so the same action looks the same in both. */
export function toolIcon(item: ToolItem, description: ToolDescription = describeTool(item)) {
  if (item.toolType === "imageView") return Image;
  if (item.toolType === "webSearch" || ["web_search", "web_fetch"].includes(toolNameFromTitle(item.title))) return Globe;
  if (item.toolType === "subAgentActivity") return Bot;
  switch (description.category) {
    case "command": return Terminal;
    case "edit": return FilePenLine;
    case "read": return FileText;
    case "search": return Search;
    case "agent": return Bot;
    case "plan": return ListChecks;
    case "browser":
      // Browser and app tools share one tool type; the verb says what the step did.
      return /^(Clicked|Selected|Typed|Pressed|Scrolled|Hovered|Dragged)/i.test(description.verb) ? MousePointerClick
        : /^Ran page script/i.test(description.verb) ? Code2 : Globe;
    default: return Wrench;
  }
}
