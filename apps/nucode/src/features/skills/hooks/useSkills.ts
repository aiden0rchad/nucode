import { useFeatureSettings } from "@settings/features";
import { codexReady } from "@settings/registry";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugEntry, SkillOption, WorkspaceInfo } from "../../../types";
import { getSkillsList, skillsRequest, type SkillsResolution } from "../../../services/tauri";
import { subscribeAppServerEvents } from "../../../services/events";
import { isSkillsUpdateAvailableEvent } from "../../../utils/appServerEvents";

export const SKILLS_CHANGED = "nucode:skills-changed";

type UseSkillsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  engine?: import("@/types").EngineKind;
  onDebug?: (entry: DebugEntry) => void;
};

export function useSkills({ activeWorkspace, engine, onDebug }: UseSkillsOptions) {
  const settings = useFeatureSettings();
  const activeEngine = engine ?? activeWorkspace?.settings.agentPolicy?.defaultEngine ?? settings?.agentPolicy?.defaultEngine ?? "pi";
  // Codex lists its own skills through its app server; pi and omp use nucode's resolved list.
  const isCodex = activeEngine === "codex";
  const enabled = isCodex ? codexReady(settings) : activeEngine === "pi" || activeEngine === "omp";
  const eligibility = useRef(enabled);
  eligibility.current = enabled;
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const lastFetchedWorkspaceId = useRef<string | null>(null);
  const inFlight = useRef(false);

  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);

  const refreshSkills = useCallback(async () => {
    if (!enabled || !eligibility.current || !workspaceId || !isConnected) {
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      if (!isCodex) {
        const resolved = await skillsRequest<SkillsResolution>("resolve");
        if (!eligibility.current) return;
        setSkills(resolved.skills.filter((skill) => skill.enabled).map((skill) => ({
          name: skill.name,
          path: skill.path,
          description: skill.description || undefined,
          invocation: `/skill:${skill.name} `,
        })));
        lastFetchedWorkspaceId.current = workspaceId;
        return;
      }
      onDebug?.({
        id: `${Date.now()}-client-skills-list`,
        timestamp: Date.now(),
        source: "client",
        label: "skills/list",
        payload: { workspaceId },
      });
      const response = await getSkillsList(workspaceId);
      if (!eligibility.current) return;
      onDebug?.({
        id: `${Date.now()}-server-skills-list`,
        timestamp: Date.now(),
        source: "server",
        label: "skills/list response",
        payload: response,
      });
      const dataBuckets = response.result?.data ?? response.data ?? [];
      const rawSkills =
        response.result?.skills ??
        response.skills ??
        (Array.isArray(dataBuckets)
          ? dataBuckets.flatMap((bucket: any) => bucket?.skills ?? [])
          : []);
      const data: SkillOption[] = rawSkills.map((item: any) => ({
        name: String(item.name ?? ""),
        path: String(item.path ?? ""),
        description: item.description ? String(item.description) : undefined,
      }));
      setSkills(data);
      lastFetchedWorkspaceId.current = workspaceId;
    } catch (error) {
      if (!eligibility.current) return;
      onDebug?.({
        id: `${Date.now()}-client-skills-list-error`,
        timestamp: Date.now(),
        source: "error",
        label: "skills/list error",
        payload: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight.current = false;
    }
  }, [enabled, isCodex, isConnected, onDebug, workspaceId]);

  // The two sources differ in shape, so a list fetched for one engine kind is never reused for the other.
  useEffect(() => { setSkills([]); lastFetchedWorkspaceId.current = null; }, [isCodex]);

  // Installing, removing or toggling a skill in Settings announces itself here.
  useEffect(() => {
    if (isCodex) return;
    const reload = () => { void refreshSkills(); };
    window.addEventListener(SKILLS_CHANGED, reload);
    return () => window.removeEventListener(SKILLS_CHANGED, reload);
  }, [isCodex, refreshSkills]);

  useEffect(() => {
    if (!enabled) { setSkills([]); lastFetchedWorkspaceId.current = null; return; }
    if (!workspaceId || !isConnected) {
      return;
    }
    if (lastFetchedWorkspaceId.current === workspaceId && skills.length > 0) {
      return;
    }
    refreshSkills();
  }, [enabled, isConnected, refreshSkills, skills.length, workspaceId]);

  useEffect(() => {
    if (!enabled || !workspaceId || !isConnected) {
      return;
    }

    return subscribeAppServerEvents((event) => {
      if (event.workspace_id !== workspaceId) {
        return;
      }
      if (!isSkillsUpdateAvailableEvent(event)) {
        return;
      }

      onDebug?.({
        id: `${Date.now()}-server-skills-update-available`,
        timestamp: Date.now(),
        source: "server",
        label: "skills/update available",
        payload: event,
      });
      void refreshSkills();
    });
  }, [enabled, isConnected, onDebug, refreshSkills, workspaceId]);

  const skillOptions = useMemo(
    () => skills.filter((skill) => skill.name),
    [skills],
  );

  return {
    skills: enabled ? skillOptions : [],
    refreshSkills,
  };
}
