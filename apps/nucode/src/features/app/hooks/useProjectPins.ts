import { useCallback, useRef, useState } from "react";
import {
  loadPinnedProjects,
  savePinnedProjects,
  type PinnedProjectsMap,
} from "@threads/utils/threadStorage";

/** Pinned projects, stored next to the thread pins. `version` changes with every update. */
export function useProjectPins() {
  const pinsRef = useRef<PinnedProjectsMap>(loadPinnedProjects());
  const [version, setVersion] = useState(0);

  const isProjectPinned = useCallback(
    (workspaceId: string) => workspaceId in pinsRef.current,
    [],
  );
  const getProjectPinTimestamp = useCallback(
    (workspaceId: string): number | null => pinsRef.current[workspaceId] ?? null,
    [],
  );
  const pinProject = useCallback((workspaceId: string) => {
    if (workspaceId in pinsRef.current) {
      return;
    }
    pinsRef.current = { ...pinsRef.current, [workspaceId]: Date.now() };
    savePinnedProjects(pinsRef.current);
    setVersion((value) => value + 1);
  }, []);
  const unpinProject = useCallback((workspaceId: string) => {
    if (!(workspaceId in pinsRef.current)) {
      return;
    }
    const { [workspaceId]: _removed, ...rest } = pinsRef.current;
    pinsRef.current = rest;
    savePinnedProjects(rest);
    setVersion((value) => value + 1);
  }, []);

  return { isProjectPinned, getProjectPinTimestamp, pinProject, unpinProject, version };
}
