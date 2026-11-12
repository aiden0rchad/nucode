import { useCallback, useRef, useState } from "react";
import {
  loadThreadSections,
  makeThreadSectionKey,
  saveThreadSections,
  type ThreadSectionsMap,
} from "@threads/utils/threadStorage";

/** Which sidebar section (workspace group) each chat was filed under. */
export function useThreadSections() {
  const sectionsRef = useRef<ThreadSectionsMap>(loadThreadSections());
  const [version, setVersion] = useState(0);

  const getThreadSection = useCallback(
    (workspaceId: string, threadId: string): string | null =>
      sectionsRef.current[makeThreadSectionKey(workspaceId, threadId)] ?? null,
    [],
  );
  const setThreadSection = useCallback(
    (workspaceId: string, threadId: string, sectionId: string | null) => {
      const key = makeThreadSectionKey(workspaceId, threadId);
      if ((sectionsRef.current[key] ?? null) === sectionId) {
        return;
      }
      const { [key]: _removed, ...rest } = sectionsRef.current;
      sectionsRef.current = sectionId ? { ...rest, [key]: sectionId } : rest;
      saveThreadSections(sectionsRef.current);
      setVersion((value) => value + 1);
    },
    [],
  );

  return { getThreadSection, setThreadSection, version };
}
