import { describe, expect, it } from "vitest";
import type { LocalUsageSnapshot } from "../../types";
import { buildHomeUsageViewModel } from "./homeUsageViewModel";

const snapshot: LocalUsageSnapshot = {
  updatedAt: Date.now(),
  days: [],
  topModels: [],
  totals: {
    allTimeTokens: 123456,
    allTimeAgentRuns: 42,
    allTimeAgentTimeMs: 3_600_000,
    last7DaysTokens: 0,
    last30DaysTokens: 0,
    averageDailyTokens: 0,
    cacheHitRatePercent: 0,
    peakDay: null,
    peakDayTokens: 0,
  },
};

describe("persistent usage totals", () => {
  it("shows lifetime usage even when there is no usage in the chart range", () => {
    const { usageCards } = buildHomeUsageViewModel({ localUsageSnapshot: snapshot, usageMetric: "tokens" });
    expect(usageCards.find(card => card.label === "All time")?.value).toBe("123K");
    expect(usageCards.find(card => card.label === "Last 30 days")?.value).toBe("0");
  });

  it("rounds a card and its caption the same way and keeps exact figures for the tooltip", () => {
    const day = { day: "2026-11-09", inputTokens: 11_447_708, cachedInputTokens: 0, outputTokens: 28_296, totalTokens: 11_476_004, agentTimeMs: 0, agentRuns: 3 };
    const { usageCards } = buildHomeUsageViewModel({ localUsageSnapshot: { ...snapshot, days: [day] }, usageMetric: "tokens" });
    expect(usageCards.find(card => card.label === "Today")).toMatchObject({ value: "11.5M", caption: "11.4M in · 28.3K out" });
    expect(usageCards.find(card => card.label === "Today")?.captionTitle).toMatch(/11,447,708 in, 28,296 out$/);
  });

  it("uses lifetime response counts and estimated time in the time view", () => {
    const { usageCards } = buildHomeUsageViewModel({ localUsageSnapshot: snapshot, usageMetric: "time" });
    expect(usageCards.find(card => card.label === "All time")).toMatchObject({
      value: "1.0h", caption: "42 recorded model responses · estimated time",
    });
  });
});
