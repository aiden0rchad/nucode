import { useState } from "react";
import { ProjectAvatar } from "@/features/app/components/ProjectAvatar";
import { ChevronDown, Download, Plus, SquarePen } from "lucide-react";

type HomeActionsProps = {
  onAddWorkspace: () => void;
  onAddWorkspaceFromUrl: () => void;
  newThread?: { projectName: string; projectId?: string; projects?: { id: string; name: string }[]; onStart: (projectId?: string) => void };
};

export function HomeActions({
  onAddWorkspace,
  onAddWorkspaceFromUrl,
  newThread,
}: HomeActionsProps) {
  const [projectId, setProjectId] = useState(newThread?.projectId);
  const projects = newThread?.projects ?? [];
  const selected = projects.find(project => project.id === projectId)?.id ?? newThread?.projectId;
  return (
    <div className="home-actions">
      {/* The action is "New thread"; where it starts is its own small picker beside it. */}
      {newThread && <div className="home-new-thread">
        <button
          className="home-button primary home-new-thread-button"
          onClick={() => newThread.onStart(selected)}
          data-tauri-drag-region="false"
        >
          <SquarePen className="home-icon" aria-hidden />
          New thread
        </button>
        {projects.length > 1 ? <label className="home-project-picker" title="Project for the new thread">
          <ProjectAvatar name={projects.find(project => project.id === selected)?.name ?? ""} />
          <span className="home-project-picker-prefix">in</span>
          {/* The native select is as wide as its longest option; the visible name is its own text and the select covers the chip. */}
          <span className="home-project-picker-value" aria-hidden>{projects.find(project => project.id === selected)?.name}</span>
          <select aria-label="Project for the new thread" value={selected} onChange={event => setProjectId(event.target.value)}>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <ChevronDown className="home-icon home-project-picker-chevron" aria-hidden />
        </label> : <span className="home-project-picker is-fixed"><ProjectAvatar name={newThread.projectName ?? ""} /><span className="home-project-picker-prefix">in</span> {newThread.projectName}</span>}
      </div>}
      <button
        className={`home-button ${newThread ? "secondary" : "primary"} home-add-workspaces-button`}
        onClick={onAddWorkspace}
        data-tauri-drag-region="false"
      >
        <Plus className="home-icon" aria-hidden />
        Add project
      </button>
      <button
        className="home-button secondary home-add-workspace-from-url-button"
        onClick={onAddWorkspaceFromUrl}
        data-tauri-drag-region="false"
      >
        <Download className="home-icon" aria-hidden />
        Add from URL
      </button>
    </div>
  );
}
