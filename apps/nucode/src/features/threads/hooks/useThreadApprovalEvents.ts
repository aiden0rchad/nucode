import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { ApprovalRequest } from "@/types";
import {
  getApprovalCommandInfo,
  matchesCommandPrefix,
} from "@utils/approvalRules";
import { respondToServerRequest } from "@services/tauri";
import { useThreadWindowEffects } from "@app/threadWindow";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadApprovalEventsOptions = {
  dispatch: Dispatch<ThreadAction>;
  approvalAllowlistRef: MutableRefObject<Record<string, string[][]>>;
};

export function useThreadApprovalEvents({
  dispatch,
  approvalAllowlistRef,
}: UseThreadApprovalEventsOptions) {
  // A thread window only shows the card; a click answers it.
  const { automaticApprovals } = useThreadWindowEffects();
  return useCallback(
    (approval: ApprovalRequest) => {
      const commandInfo = getApprovalCommandInfo(approval.params ?? {});
      const allowlist =
        approvalAllowlistRef.current[approval.workspace_id] ?? [];
      if (automaticApprovals && !String(approval.request_id).startsWith("pi:") && commandInfo && matchesCommandPrefix(commandInfo.tokens, allowlist)) {
        void respondToServerRequest(
          approval.workspace_id,
          approval.request_id,
          "accept",
        );
        return;
      }
      dispatch({ type: "addApproval", approval });
    },
    [approvalAllowlistRef, automaticApprovals, dispatch],
  );
}
