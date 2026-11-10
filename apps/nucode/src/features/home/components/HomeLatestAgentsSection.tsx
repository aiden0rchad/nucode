import { formatRelativeTimeShort } from "../../../utils/time";
import { ProjectAvatar } from "@/features/app/components/ProjectAvatar";
import type { LatestAgentRun } from "../homeTypes";

type HomeLatestAgentsSectionProps = {
  isLoadingLatestAgents: boolean;
  latestAgentRuns: LatestAgentRun[];
  onSelectThread: (workspaceId: string, threadId: string) => void;
};

export function HomeLatestAgentsSection({
  isLoadingLatestAgents,
  latestAgentRuns,
  onSelectThread,
}: HomeLatestAgentsSectionProps) {
  // When every card is from one project (the one the picker above names), the cards drop its badge.
  const oneProject = new Set(latestAgentRuns.map((run) => run.projectName)).size === 1 ? latestAgentRuns[0]?.projectName ?? null : null;
  return (
    <div className="home-latest">
      <div className="home-latest-header">
        <div className="home-latest-label">Recent threads</div>
      </div>
      {latestAgentRuns.length > 0 ? (
        <div className="home-latest-grid">
          {latestAgentRuns.map((run) => (
            <button
              className="home-latest-card home-latest-card-button"
              key={run.threadId}
              onClick={() => onSelectThread(run.workspaceId, run.threadId)}
              type="button"
            >
              <div className="home-latest-card-header">
                {oneProject ? (run.groupName ? <span className="home-latest-group">{run.groupName}</span> : <span />) : <div className="home-latest-project" title={run.projectName}>
                  <ProjectAvatar name={run.projectName} /><span className="home-latest-project-name">{run.projectName}</span>
                  {run.groupName && (
                    <span className="home-latest-group">{run.groupName}</span>
                  )}
                </div>}
                <div className="home-latest-time">
                  {formatRelativeTimeShort(run.timestamp)}
                </div>
              </div>
              <div className="home-latest-message">
                {run.message.trim() || "Agent replied."}
              </div>
              {run.isProcessing && (
                <div className="home-latest-status">Running</div>
              )}
            </button>
          ))}
        </div>
      ) : isLoadingLatestAgents ? (
        <div className="home-latest-grid home-latest-grid-loading" aria-label="Loading agents">
          {Array.from({ length: 3 }).map((_, index) => (
            <div className="home-latest-card home-latest-card-skeleton" key={index}>
              <div className="home-latest-card-header">
                <span className="home-latest-skeleton home-latest-skeleton-title" />
                <span className="home-latest-skeleton home-latest-skeleton-time" />
              </div>
              <span className="home-latest-skeleton home-latest-skeleton-line" />
              <span className="home-latest-skeleton home-latest-skeleton-line short" />
            </div>
          ))}
        </div>
      ) : (
        <div className="home-latest-empty">
          <div className="home-latest-empty-title">No agent activity yet</div>
          <div className="home-latest-empty-subtitle">
            Start a thread to see the latest responses here.
          </div>
        </div>
      )}
    </div>
  );
}
