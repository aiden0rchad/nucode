import Bell from "lucide-react/dist/esm/icons/bell";
import { useMemo } from "react";
import { IconButton } from "@/features/design-system/components/IconButton";
import { ProjectAvatar } from "@/features/app/components/ProjectAvatar";
import type { ThreadSummary, WorkspaceInfo } from "../../../types";
import { formatRelativeTimeShort } from "../../../utils/time";
import { getThreadStatusClass, type ThreadStatusById, type ThreadStatusClass } from "../../../utils/threadStatus";
import { useMenuController } from "../hooks/useMenuController";

const STATUS_LABEL: Record<ThreadStatusClass, string> = {
  processing: "Running", reviewing: "Reviewing", unread: "Needs you", ready: "", failed: "Failed", stopped: "Stopped",
};

type SidebarActivityProps = {
  workspaces: WorkspaceInfo[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadStatusById: ThreadStatusById;
  pendingUserInputKeys: Set<string>;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  limit?: number;
};

export type ActivityItem = { key: string; title: string; meta?: string; status: ThreadStatusClass; time: number; onSelect: () => void };

/** Recent work as in Codex: a bell beside search lists the latest items with their state, and carries a dot while
 * something runs or waits on the user. Code, Chat and Work each pass their own items. */
export function ActivityMenu({ items, limit = 8, avatar = true }: { items: ActivityItem[]; limit?: number; avatar?: boolean }) {
  const menu = useMenuController();
  const recent = useMemo(() => [...items].sort((a, b) => b.time - a.time).slice(0, limit), [items, limit]);
  const attention = recent.some(entry => entry.status === "processing" || entry.status === "unread");
  return <div className="sidebar-activity" ref={menu.containerRef}>
    <IconButton type="button" className="ghost sidebar-activity-toggle" aria-label="Activity" title="Activity" aria-haspopup="dialog" aria-expanded={menu.isOpen} onClick={menu.toggle}>
      <Bell aria-hidden />{attention && <span className="sidebar-activity-dot" aria-hidden />}
    </IconButton>
    {menu.isOpen && <div className="sidebar-activity-popover ds-popover" role="dialog" aria-label="Recent activity">
      <div className="sidebar-activity-title">Activity</div>
      {recent.length ? <ul className="sidebar-activity-list">
        {recent.map(entry => <li key={entry.key}>
          <button type="button" className="ds-popover-item sidebar-activity-item" onClick={() => { menu.close(); entry.onSelect(); }}>
            {avatar && entry.meta && <ProjectAvatar name={entry.meta} />}
            <span className="sidebar-activity-text">
              <span className="sidebar-activity-name">{entry.title}</span>
              {entry.meta && <span className="sidebar-activity-meta">{entry.meta}</span>}
            </span>
            <span className={`sidebar-activity-state is-${entry.status}`}>{STATUS_LABEL[entry.status] || formatRelativeTimeShort(entry.time)}</span>
          </button>
        </li>)}
      </ul> : <p className="sidebar-activity-empty">Nothing recent yet.</p>}
    </div>}
  </div>;
}

/** Code: the latest threads across every project. */
export function SidebarActivity({ workspaces, threadsByWorkspace, threadStatusById, pendingUserInputKeys, onSelectThread, limit = 8 }: SidebarActivityProps) {
  const items = useMemo(() => workspaces.flatMap(workspace => (threadsByWorkspace[workspace.id] ?? [])
    .filter(thread => !thread.isSubagent && !thread.sideOf)
    .map((thread): ActivityItem => ({
      key: `${workspace.id}:${thread.id}`, title: thread.name || "Untitled thread", meta: workspace.name, time: thread.updatedAt,
      status: getThreadStatusClass(threadStatusById[thread.id], pendingUserInputKeys.has(`${workspace.id}:${thread.id}`)),
      onSelect: () => onSelectThread(workspace.id, thread.id),
    }))), [workspaces, threadsByWorkspace, threadStatusById, pendingUserInputKeys, onSelectThread]);
  return <ActivityMenu items={items} limit={limit} />;
}
