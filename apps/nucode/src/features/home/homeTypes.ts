export type LatestAgentRun = {
  message: string;
  timestamp: number;
  projectName: string;
  groupName?: string | null;
  workspaceId: string;
  threadId: string;
  isProcessing: boolean;
};

export type UsageMetric = "tokens" | "time";

export type UsageWorkspaceOption = {
  id: string;
  label: string;
};

export type HomeStatCard = {
  label: string;
  value: string;
  suffix?: string | null;
  caption: string;
  /** Exact figures behind a rounded caption, shown on hover. */
  captionTitle?: string;
  compact?: boolean;
};
