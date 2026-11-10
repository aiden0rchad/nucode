import { useFeatureSettings } from "@settings/features";
import { formatModelRef } from "@settings/registry";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { useEffect, useState } from "react";
import type {
  LocalUsageSnapshot,
} from "../../../types";
import {
  formatCompactNumber,
  formatCount,
  formatDayLabel,
  formatDuration,
  formatWeekRange,
} from "../homeFormatters";
import type { HomeStatCard, UsageMetric, UsageWorkspaceOption } from "../homeTypes";
import { buildHomeUsageViewModel } from "../homeUsageViewModel";

type HomeUsageSectionProps = {
  isLoadingLocalUsage: boolean;
  localUsageError: string | null;
  localUsageSnapshot: LocalUsageSnapshot | null;
  onRefreshLocalUsage: () => void;
  onUsageMetricChange: (metric: UsageMetric) => void;
  onUsageWorkspaceChange: (workspaceId: string | null) => void;
  usageMetric: UsageMetric;
  usageWorkspaceId: string | null;
  usageWorkspaceOptions: UsageWorkspaceOption[];
};

function HomeUsageCard({ card }: { card: HomeStatCard }) {
  return (
    <div className={card.compact ? "home-usage-card is-compact" : "home-usage-card"}>
      <div className="home-usage-label">{card.label}</div>
      <div className="home-usage-value">
        <span className="home-usage-number">{card.value}</span>
        {card.suffix && <span className="home-usage-suffix">{card.suffix}</span>}
      </div>
      <div className="home-usage-caption" title={card.captionTitle}>{card.caption}</div>
    </div>
  );
}

export function HomeUsageSection({
  isLoadingLocalUsage,
  localUsageError,
  localUsageSnapshot,
  onRefreshLocalUsage,
  onUsageMetricChange,
  onUsageWorkspaceChange,
  usageMetric,
  usageWorkspaceId,
  usageWorkspaceOptions,
}: HomeUsageSectionProps) {
  const settings = useFeatureSettings();
  const [chartWeekOffset, setChartWeekOffset] = useState(0);
  const {
    updatedLabel,
    usageCards,
    usageDays,
    usageInsights,
  } = buildHomeUsageViewModel({
    localUsageSnapshot,
    usageMetric,
  });

  const maxHistoricalWeekOffset = Math.max(0, Math.ceil(usageDays.length / 7) - 1);
  useEffect(() => {
    setChartWeekOffset((previous) => Math.min(previous, maxHistoricalWeekOffset));
  }, [maxHistoricalWeekOffset]);

  const chartWeekEnd = Math.max(0, usageDays.length - chartWeekOffset * 7);
  const chartWeekStart = Math.max(0, chartWeekEnd - 7);
  const chartDays = usageDays.slice(chartWeekStart, chartWeekEnd);
  const maxUsageValue = Math.max(
    1,
    ...chartDays.map((day) =>
      usageMetric === "tokens" ? day.totalTokens : day.agentTimeMs ?? 0,
    ),
  );
  const canShowOlderWeek = chartWeekOffset < maxHistoricalWeekOffset;
  const canShowNewerWeek = chartWeekOffset > 0;
  const chartRangeLabel = formatWeekRange(chartDays);
  const chartRangeAriaLabel =
    chartDays.length > 0
      ? `Usage week ${chartDays[0]?.day} to ${chartDays[chartDays.length - 1]?.day}`
      : "Usage week";
  const showUsageSkeleton = isLoadingLocalUsage && !localUsageSnapshot;
  // An all-zero snapshot is still "no usage": show one quiet line instead of a wall of zeros.
  const hasUsage = usageDays.some((day) => day.totalTokens > 0 || (day.agentTimeMs ?? 0) > 0);
  const showUsageEmpty = !isLoadingLocalUsage && (!localUsageSnapshot || !hasUsage);
  // A week chart with one bar says nothing the cards do not; it appears once two days have usage.
  const activeDays = usageDays.filter((day) => (usageMetric === "tokens" ? day.totalTokens : day.agentTimeMs ?? 0) > 0).length;
  // A week with at most one active day reads better as one sentence than as six empty tracks.
  const weekValue = (day: (typeof chartDays)[number]) => (usageMetric === "tokens" ? day.totalTokens : day.agentTimeMs ?? 0);
  const weekActive = chartDays.filter((day) => weekValue(day) > 0);
  const weekFormat = (value: number) => (usageMetric === "tokens" ? `${formatCompactNumber(value)} tokens` : formatDuration(value));
  // "Last 30 days" that equals "All time" is the same number twice: keep All time.
  const allTime = usageCards.find((card) => card.label === "All time");
  const cards = usageCards.filter((card) => !(allTime && card !== allTime && /^Last \d+ days$/.test(card.label) && card.value === allTime.value && card.suffix === allTime.suffix));

  return (
    <div className="home-usage">
      <div className="home-section-header">
        <div className="home-section-title">Usage snapshot</div>
        <div className="home-section-meta-row">
          {updatedLabel && <div className="home-section-meta">{updatedLabel}</div>}
          <button
            type="button"
            className={
              isLoadingLocalUsage
                ? "home-usage-refresh is-loading"
                : "home-usage-refresh"
            }
            onClick={onRefreshLocalUsage}
            disabled={isLoadingLocalUsage}
            aria-label="Refresh usage"
            title="Refresh usage"
          >
            <RefreshCw
              className={
                isLoadingLocalUsage
                  ? "home-usage-refresh-icon spinning"
                  : "home-usage-refresh-icon"
              }
              aria-hidden
            />
          </button>
        </div>
      </div>
      {!showUsageEmpty && <div className="home-usage-controls">
        <div className="home-usage-control-group">
          <span className="home-usage-control-label">Workspace</span>
          <div className="home-usage-select-wrap">
            <select
              className="home-usage-select"
              value={usageWorkspaceId ?? ""}
              onChange={(event) => onUsageWorkspaceChange(event.target.value || null)}
              disabled={usageWorkspaceOptions.length === 0}
            >
              <option value="">All workspaces</option>
              {usageWorkspaceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="home-usage-control-group">
          <span className="home-usage-control-label">View</span>
          <div className="home-usage-toggle" role="group" aria-label="Usage view">
            <button
              type="button"
              className={
                usageMetric === "tokens"
                  ? "home-usage-toggle-button is-active"
                  : "home-usage-toggle-button"
              }
              onClick={() => onUsageMetricChange("tokens")}
              aria-pressed={usageMetric === "tokens"}
            >
              Tokens
            </button>
            <button
              type="button"
              className={
                usageMetric === "time"
                  ? "home-usage-toggle-button is-active"
                  : "home-usage-toggle-button"
              }
              onClick={() => onUsageMetricChange("time")}
              aria-pressed={usageMetric === "time"}
            >
              Time
            </button>
          </div>
        </div>
      </div>}
      {showUsageSkeleton ? (
        <div className="home-usage-skeleton">
          <div className="home-usage-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="home-usage-card" key={index}>
                <span className="home-latest-skeleton home-usage-skeleton-label" />
                <span className="home-latest-skeleton home-usage-skeleton-value" />
              </div>
            ))}
          </div>
          <div className="home-usage-chart-card">
            <span className="home-latest-skeleton home-usage-skeleton-chart" />
          </div>
        </div>
      ) : showUsageEmpty ? (
        <div className="home-usage-empty">
          <div className="home-usage-empty-title">No usage yet</div>
          <div className="home-usage-empty-subtitle">
            Token and time totals appear here after your first agent run.
          </div>
          {localUsageError && (
            <div className="home-usage-error">{localUsageError}</div>
          )}
        </div>
      ) : (
        <>
          <div className="home-usage-grid">
            {cards.slice(0, 4).map((card) => (
              <HomeUsageCard card={card} key={card.label} />
            ))}
          </div>
          {activeDays >= 2 && <div className="home-usage-chart-card">
            <div className="home-usage-chart-nav">
              <div
                className="home-usage-chart-range"
                aria-label={chartRangeAriaLabel}
                aria-live="polite"
              >
                {chartRangeLabel}
              </div>
              <div className="home-usage-chart-actions">
                {canShowOlderWeek && (
                  <button
                    type="button"
                    className="home-usage-chart-button"
                    onClick={() => setChartWeekOffset((current) => current + 1)}
                    aria-label="Show previous week"
                    title="Show previous week"
                  >
                    <ChevronLeft aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="home-usage-chart-button"
                  onClick={() => setChartWeekOffset((current) => Math.max(0, current - 1))}
                  aria-label="Show next week"
                  title="Show next week"
                  disabled={!canShowNewerWeek}
                >
                  <ChevronRight aria-hidden />
                </button>
              </div>
            </div>
            {weekActive.length <= 1 ? <p className="home-usage-chart-note" title={weekActive.length === 1 && usageMetric === "tokens" ? `${formatCount(weekValue(weekActive[0]))} tokens` : undefined}>
              {weekActive.length === 1 ? `Only ${formatDayLabel(weekActive[0].day)} had activity this week · ${weekFormat(weekValue(weekActive[0]))}` : "No activity this week"}
            </p> : <div className="home-usage-chart">
              {chartDays.map((day) => {
                const value =
                  usageMetric === "tokens" ? day.totalTokens : day.agentTimeMs ?? 0;
                // Days with no usage are a baseline tick, not a stub bar that reads as "some".
                const height = value > 0 ? Math.max(6, Math.round((value / maxUsageValue) * 100)) : 0;
                const tooltip =
                  usageMetric === "tokens"
                    ? `${formatDayLabel(day.day)} · ${formatCount(day.totalTokens)} tokens`
                    : `${formatDayLabel(day.day)} · ${formatDuration(day.agentTimeMs ?? 0)} agent time`;
                return (
                  <div className="home-usage-bar" key={day.day} data-value={tooltip}>
                    {value > 0 && <span className="home-usage-bar-value">{usageMetric === "tokens" ? formatCompactNumber(value) : formatDuration(value)}</span>}
                    <span
                      className={value > 0 ? "home-usage-bar-fill" : "home-usage-bar-fill is-zero"}
                      style={{ height: `${height}%` }}
                    />
                    <span className="home-usage-bar-label">{formatDayLabel(day.day)}</span>
                  </div>
                );
              })}
            </div>}
          </div>}
          {/* The headline row and the chart answer "how much"; the rest is detail, one click away. */}
          <details className="home-usage-more">
          <summary>More usage details</summary>
          {cards.length > 4 && <div className="home-usage-grid">
            {cards.slice(4).map((card) => (
              <HomeUsageCard card={card} key={card.label} />
            ))}
          </div>}
          <div className="home-usage-insights">
            {usageInsights.map((card) => (
              <HomeUsageCard card={card} key={card.label} />
            ))}
          </div>
          <div className="home-usage-models">
            <div className="home-usage-models-label">
              Models · all time
              {usageMetric === "time" && (
                <span className="home-usage-models-hint">Tokens</span>
              )}
            </div>
            <div className="home-usage-models-list">
              {localUsageSnapshot?.topModels?.length ? (
                localUsageSnapshot.topModels.map((model) => (
                  <span
                    className="home-usage-model-chip"
                    key={model.model}
                    title={`${formatModelRef(settings, model.model).title}: ${formatCount(model.tokens)} tokens`}
                  >
                    {formatModelRef(settings, model.model).name}
                    <span className="home-usage-model-share">
                      {model.sharePercent.toFixed(1)}%
                    </span>
                  </span>
                ))
              ) : (
                <span className="home-usage-model-empty">No models yet</span>
              )}
            </div>
            {localUsageError && <div className="home-usage-error">{localUsageError}</div>}
          </div>
          </details>
        </>
      )}

    </div>
  );
}
