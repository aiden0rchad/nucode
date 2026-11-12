import { ProjectAvatar } from "@/features/app/components/ProjectAvatar";
import { SettingsEmpty, SettingsFieldRow, SettingsIconButton, SettingsRow, SettingsTextField, SettingsButton, SettingsSelect, SettingsPage, SettingsGroup } from "@/features/design-system/components/settings/SettingsPrimitives";
import { CodegraphProjectSettings } from "./CodegraphProjectSettings";
import type { WorkspaceSettings } from "@/types";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import X from "lucide-react/dist/esm/icons/x";
import Plus from "lucide-react/dist/esm/icons/plus";
import { useState, type ReactNode } from "react";
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
            <>
              <span className="settings-list-title">{group.name}</span>
              <SettingsIconButton size="sm" aria-label={`Rename section ${group.name}`} title="Rename" onClick={() => setEditing(true)}><Pencil aria-hidden /></SettingsIconButton>
            </>
          )}
        </div>
        <div className="settings-list-meta" title={group.copiesFolder ?? ""}>
          <span>Folder for clones:</span>
          <span className={`settings-path${group.copiesFolder ? "" : " empty"}`}>{group.copiesFolder ?? "Not set"}</span>
        </div>
      </div>
      <div className="settings-list-actions">
        <SettingsButton type="button" onClick={onChooseFolder}>Choose…</SettingsButton>
        {group.copiesFolder && <SettingsIconButton className="settings-reveal" aria-label="Clear folder for clones" title="Clear folder" onClick={onClearFolder}><X aria-hidden /></SettingsIconButton>}
        <SettingsIconButton className="settings-reveal" aria-label="Move section up" title="Move up" onClick={() => onMove("up")} disabled={index === 0}><ChevronUp aria-hidden /></SettingsIconButton>
        <SettingsIconButton className="settings-reveal" aria-label="Move section down" title="Move down" onClick={() => onMove("down")} disabled={index === count - 1}><ChevronDown aria-hidden /></SettingsIconButton>
        <SettingsIconButton className="is-danger" aria-label="Delete section" title="Delete section" onClick={onDelete}><Trash2 aria-hidden /></SettingsIconButton>
      </div>
    </SettingsRow>
  );
}

export function SettingsProjectsSection({
  codegraphEnabled,
  onUpdateWorkspaceSettings,
  workspaceGroups,
  groupedWorkspaces,
  ungroupedLabel,
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
  return (
    <SettingsPage
      title="Projects"
      subtitle="Organize projects into sections and set their order in the sidebar."
    >
      <SettingsGroup
        title="Sections"
        subtitle="Sections group related projects in the sidebar."
      >
        <SettingsRow>
          <SettingsTextField
            className="is-fill"
            aria-label="New section name"
            value={newGroupName}
            placeholder="New section name"
            onChange={(event) => onSetNewGroupName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canCreateGroup) {
                event.preventDefault();
                void onCreateGroup();
              }
            }}
          />
          <SettingsButton type="button" onClick={() => { void onCreateGroup(); }} disabled={!canCreateGroup}><Plus aria-hidden />Add section</SettingsButton>
        </SettingsRow>
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
        {workspaceGroups.length === 0 && <SettingsEmpty>No sections yet. Name one above to get started.</SettingsEmpty>}
      </SettingsGroup>
      <SettingsGroup
        title="Order"
        subtitle="Choose each project's section and move projects up or down within it."
      >
        {groupedWorkspaces.map((group) => (
          <div key={group.id ?? "ungrouped"} className="settings-project-group">
            <div className="settings-project-group-label">{group.name}</div>
            {group.workspaces.map((workspace, index) => {
              const groupValue = workspaceGroups.some((entry) => entry.id === workspace.settings.groupId)
                ? workspace.settings.groupId ?? ""
                : "";
              return (
                <details key={workspace.id} className="settings-project-row">
                  <summary>
                    <span className="settings-list-identity">
                      <span className="settings-list-icon"><ProjectAvatar name={workspace.name} /></span>
                      <span className="settings-list-copy">
                        <span className="settings-list-name">{workspace.name}</span>
                        <span className="settings-list-meta settings-project-path">{workspace.path}</span>
                      </span>
                    </span>
                    <span className="settings-list-actions">
                      <SettingsIconButton className="settings-reveal" aria-label="Move project up" title="Move up" onClick={(event) => { event.preventDefault(); onMoveWorkspace(workspace.id, "up"); }} disabled={index === 0}><ChevronUp aria-hidden /></SettingsIconButton>
                      <SettingsIconButton className="settings-reveal" aria-label="Move project down" title="Move down" onClick={(event) => { event.preventDefault(); onMoveWorkspace(workspace.id, "down"); }} disabled={index === group.workspaces.length - 1}><ChevronDown aria-hidden /></SettingsIconButton>
                      <SettingsIconButton className="is-danger" aria-label="Delete project" title="Remove project" onClick={(event) => { event.preventDefault(); onDeleteWorkspace(workspace.id); }}><Trash2 aria-hidden /></SettingsIconButton>
                    </span>
                  </summary>
                  <div className="settings-project-body">
                    <SettingsFieldRow title="Section">
                      <SettingsSelect
                        aria-label={"Section for " + workspace.name}
                        value={groupValue}
                        onChange={(event) => {
                          const nextGroupId = event.target.value || null;
                          void onAssignWorkspaceGroup(workspace.id, nextGroupId);
                        }}
                      >
                        <option value="">{ungroupedLabel}</option>
                        {workspaceGroups.map((entry) => (
                          <option key={entry.id} value={entry.id}>{entry.name}</option>
                        ))}
                      </SettingsSelect>
                    </SettingsFieldRow>
                    <CodegraphProjectSettings workspace={workspace} globalEnabled={codegraphEnabled} onUpdate={onUpdateWorkspaceSettings} />
                  </div>
                </details>
              );
            })}
          </div>
        ))}
        {projects.length === 0 && <SettingsEmpty>No projects yet. Add a project from the sidebar.</SettingsEmpty>}
      </SettingsGroup>
      {children}
    </SettingsPage>
  );
}
