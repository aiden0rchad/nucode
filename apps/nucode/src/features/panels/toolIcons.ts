import { Bot, FileDiff, Folder, Globe, ListTodo, MessagesSquare, ScrollText, Terminal, type LucideIcon } from "lucide-react";

/** One glyph per tool in every mode: the Code dock, the Chat and Work side panel, and their new-tab lists. */
export const panelToolIcons: Record<string, LucideIcon> = {
  git: FileDiff, terminal: Terminal, sidechat: MessagesSquare, files: Folder, agents: Bot, prompts: ScrollText,
  background: ListTodo, task: ListTodo, previews: Globe, browser: Globe,
};
