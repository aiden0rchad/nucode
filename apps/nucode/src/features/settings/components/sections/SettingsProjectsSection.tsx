import { ProjectAvatar } from "@/features/app/components/ProjectAvatar";
import { SettingsEmpty, SettingsRow, SettingsTextField, SettingsButton, SettingsSelect, SettingsPage, SettingsGroup } from "@/features/design-system/components/settings/SettingsPrimitives";
import { CodegraphProjectSettings } from "./CodegraphProjectSettings";
import type { WorkspaceSettings } from "@/types";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import Search from "lucide-react/dist/esm/icons/search";
import { Fragment, useState, type ReactNode } from "react";
import { RowMenu } from "@/features/chat/RowMenu";
import FolderMinus from "lucide-react/dist/esm/icons/folder-minus";
import type { Dispatch, SetStateAction } from "react";
import type { WorkspaceGroup, WorkspaceInfo } from "@/types";

type GroupedWorkspaces = Array<{
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
}>;

type SettingsProjectsSectionProps = {
  codegraphEnabled: boolean;
  onUpdateWorkspaceSettings: (id: string, settings: Partial<WorkspaceSettings>) => Promise<void>;
  workspaceGroups: WorkspaceGroup[];
  groupedWorkspaces: GroupedWorkspaces;
  ungroupedLabel: string;
  groupDrafts: Record<string, string>;
  newGroupName: string;
  groupError: string | null;
  projects: WorkspaceInfo[];
  canCreateGroup: boolean;
  onSetNewGroupName: Dispatch<SetStateAction<string>>;
  onSetGroupDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onCreateGroup: () => Promise<void>;
  onRenameGroup: (group: WorkspaceGroup) => Promise<void>;
  onMoveWorkspaceGroup: (id: string, direction: "up" | "down") => Promise<boolean | null>;
  onDeleteGroup: (group: WorkspaceGroup) => Promise<void>;
  onChooseGroupCopiesFolder: (group: WorkspaceGroup) => Promise<void>;
  onClearGroupCopiesFolder: (group: WorkspaceGroup) => Promise<void>;
  onAssignWorkspaceGroup: (workspaceId: string, groupId: string | null) => Promise<boolean | null>;
  onMoveWorkspace: (id: string, direction: "up" | "down") => void;
  onDeleteWorkspace: (id: string) => void;
  /** Rendered at the end of the page, inside the page column. */
  children?: ReactNode;
};

const NO_SECTION = "No section";

function SectionRow({ group, index, count, draft, onDraft, onRename, onMove, onDelete, onChooseFolder, onClearFolder }: {
  group: WorkspaceGroup; index: number; count: number; draft: string | undefined; onDraft: (value: string) => void; onRename: () => void;
  onMove: (direction: "up" | "down") => void; onDelete: () => void; onChooseFolder: () => void; onClearFolder: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const finish = () => { setEditing(false); onRename(); };
  return (
    <SettingsRow className="settings-list-row">
      <div className="settings-list-copy">
        <div className="settings-list-name">
          {editing ? (
            <SettingsTextField
              autoFocus
              aria-label={`Name of section ${group.name}`}
              value={draft ?? group.name}
              onChange={(event) => onDraft(event.target.value)}
              onBlur={finish}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); finish(); }
                if (event.key === "Escape") { event.stopPropagation(); onDraft(group.name); setEditing(false); }
              }}
            />
          ) : (
            <span className="settings-list-title">{group.name}</span>
          )}
        </div>
        <div className="settings-list-meta settings-meta-plain" title={group.copiesFolder ?? ""}>
          {group.copiesFolder ? <>Clones go to <span className="settings-path">{group.copiesFolder}</span></> : "Clones go to the default folder"}
        </div>
      </div>
      <div className="settings-list-actions">
        <SettingsButton type="button" onClick={onChooseFolder}>Choose folder…</SettingsButton>
        <RowMenu portal size="md" label={`section ${group.name}`} actions={[
          { label: "Rename", icon: <Pencil size={14} />, onClick: () => setEditing(true) },
          ...(group.copiesFolder ? [{ label: "Use the default folder", icon: <FolderMinus size={14} />, onClick: onClearFolder }] : []),
          { label: "Move up", icon: <ChevronUp size={14} />, disabled: index === 0, onClick: () => onMove("up") },
          { label: "Move down", icon: <ChevronDown size={14} />, disabled: index === count - 1, onClick: () => onMove("down") },
          { label: "Delete section", icon: <Trash2 size={14} />, danger: true, onClick: onDelete },
        ]}>{null}</RowMenu>
      </div>
    </SettingsRow>
  );
}

function ProjectRow({ workspace, sections, groupValue, first, last, codegraphEnabled, onUpdateWorkspaceSettings, onAssign, onMove, onRemove }: {
  workspace: WorkspaceInfo; sections: WorkspaceGroup[]; groupValue: string; first: boolean; last: boolean; codegraphEnabled: boolean;
  onUpdateWorkspaceSettings: (id: string, settings: Partial<WorkspaceSettings>) => Promise<void>;
  onAssign: (id: string | null) => void; onMove: (direction: "up" | "down") => void; onRemove: () => void;
}) {
  const [codegraph, setCodegraph] = useState(false);
  return (
    <>
      <SettingsRow className="settings-list-row settings-project-row">
        <div className="settings-list-identity">
          <span className="settings-list-icon"><ProjectAvatar name={workspace.name} /></span>
          <div className="settings-list-copy">
            <div className="settings-list-name">{workspace.name}</div>
            <div className="settings-list-meta settings-project-path">{workspace.path}</div>
          </div>
        </div>
        <div className="settings-list-actions">
          <SettingsSelect aria-label={"Section for " + workspace.name} value={groupValue} onChange={(event) => onAssign(event.target.value || null)}>
            <option value="">{NO_SECTION}</option>
            {sections.map((entry) => (<option key={entry.id} value={entry.id}>{entry.name}</option>))}
          </SettingsSelect>
          <RowMenu portal size="md" label={workspace.name} actions={[
            { label: "Move up", icon: <ChevronUp size={14} />, disabled: first, onClick: () => onMove("up") },
            { label: "Move down", icon: <ChevronDown size={14} />, disabled: last, onClick: () => onMove("down") },
            { label: codegraph ? "Hide CodeGraph" : "CodeGraph…", icon: <Search size={14} />, onClick: () => setCodegraph(!codegraph) },
            { label: "Remove from nucode…", icon: <Trash2 size={14} />, danger: true, onClick: onRemove },
          ]}>{null}</RowMenu>
        </div>
      </SettingsRow>
      {codegraph && <div className="settings-project-body"><CodegraphProjectSettings workspace={workspace} globalEnabled={codegraphEnabled} onUpdate={onUpdateWorkspaceSettings} /></div>}
    </>
  );
}

export function SettingsProjectsSection({
  codegraphEnabled,
  onUpdateWorkspaceSettings,
  workspaceGroups,
  groupedWorkspaces,
  groupDrafts,
  newGroupName,
  groupError,
  projects,
  canCreateGroup,
  onSetNewGroupName,
  onSetGroupDrafts,
  onCreateGroup,
  onRenameGroup,
  onMoveWorkspaceGroup,
  onDeleteGroup,
  onChooseGroupCopiesFolder,
  onClearGroupCopiesFolder,
  onAssignWorkspaceGroup,
  onMoveWorkspace,
  onDeleteWorkspace,
  children,
}: SettingsProjectsSectionProps) {
  const [adding, setAdding] = useState(false);
  const addSection = async () => { await onCreateGroup(); setAdding(false); };
  return (
    <SettingsPage
      title="Projects"
      subtitle="Organize projects into sections and set their order in the sidebar."
    >
      <SettingsGroup
        title="Sections"
        subtitle="Sections group related projects in the sidebar; each can send its clones to its own folder."
        actions={<SettingsButton type="button" onClick={() => setAdding(true)} disabled={adding}><Plus aria-hidden />Add section</SettingsButton>}
      >
        {adding && (
          <SettingsRow>
            <SettingsTextField
              autoFocus
              aria-label="New section name"
              value={newGroupName}
              placeholder="Section name"
              onChange={(event) => onSetNewGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canCreateGroup) { event.preventDefault(); void addSection(); }
                if (event.key === "Escape") { event.stopPropagation(); setAdding(false); }
              }}
            />
            <div className="settings-row-controls">
              <SettingsButton type="button" className="ghost" onClick={() => setAdding(false)}>Cancel</SettingsButton>
              <SettingsButton type="button" className="primary" onClick={() => { void addSection(); }} disabled={!canCreateGroup}>Add</SettingsButton>
            </div>
          </SettingsRow>
        )}
        {groupError && <div className="settings-card-block settings-help-error" role="alert">{groupError}</div>}
        {workspaceGroups.map((group, index) => (
          <SectionRow
            key={group.id}
            group={group}
            index={index}
            count={workspaceGroups.length}
            draft={groupDrafts[group.id]}
            onDraft={(value) => onSetGroupDrafts((prev) => ({ ...prev, [group.id]: value }))}
            onRename={() => { void onRenameGroup(group); }}
            onMove={(direction) => { void onMoveWorkspaceGroup(group.id, direction); }}
            onDelete={() => { void onDeleteGroup(group); }}
            onChooseFolder={() => { void onChooseGroupCopiesFolder(group); }}
            onClearFolder={() => { void onClearGroupCopiesFolder(group); }}
          />
        ))}
        {workspaceGroups.length === 0 && !adding && <SettingsEmpty>No sections yet. Add one to group related projects.</SettingsEmpty>}
      </SettingsGroup>
      <SettingsGroup
        title="Project placement"
        subtitle="Each project's section in the sidebar. Use ⋯ to move a project up or down within its section, or to remove it from nucode."
      >
        {groupedWorkspaces.map((group) => (
          <Fragment key={group.id ?? "ungrouped"}>
            {group.workspaces.map((workspace, index) => {
              const groupValue = workspaceGroups.some((entry) => entry.id === workspace.settings.groupId)
                ? workspace.settings.groupId ?? ""
                : "";
              return (
                <ProjectRow key={workspace.id} workspace={workspace} sections={workspaceGroups} groupValue={groupValue} first={index === 0} last={index === group.workspaces.length - 1}
                  codegraphEnabled={codegraphEnabled} onUpdateWorkspaceSettings={onUpdateWorkspaceSettings} onAssign={(id) => { void onAssignWorkspaceGroup(workspace.id, id); }}
                  onMove={(direction) => onMoveWorkspace(workspace.id, direction)} onRemove={() => onDeleteWorkspace(workspace.id)} />
              );
            })}
          </Fragment>
        ))}
        {projects.length === 0 && <SettingsEmpty>No projects yet. Add a project from the sidebar.</SettingsEmpty>}
      </SettingsGroup>
      {children}
    </SettingsPage>
  );
}
