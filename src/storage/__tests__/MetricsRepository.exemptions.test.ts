/**
 * Dashboard authorship must honour the active assignment's exemptFileGlobs.
 *
 * Issue #5: pasting AI-generated text into README.md spiked the dashboard
 * from 2% to 88% AI even though the default policy exempts README files and
 * markdown. Assignment reports honoured the exemptions (PolicyEngine filters
 * on them) but the dashboard's own authorship calculation never looked at
 * them, so the two views disagreed.
 */

jest.mock("../DatabaseManager");

import { MetricsRepository } from "../MetricsRepository";
import { DatabaseManager } from "../DatabaseManager";
import { AITool, EventType } from "../../types";

const TARGET_DATE = "2026-01-13";

/** Local midnight for TARGET_DATE, matching MetricsRepository's day basis. */
const DAY_START = new Date(2026, 0, 13).getTime();
const MIDDAY = DAY_START + 12 * 60 * 60 * 1000;

describe("MetricsRepository exemptFileGlobs", () => {
  let metricsRepo: MetricsRepository;
  let mockDb: jest.Mocked<DatabaseManager>;

  const fileWith = (overrides: Record<string, any>) => ({
    filePath: "/proj/src/app.ts",
    linesAdded: 0,
    linesRemoved: 0,
    firstGeneratedAt: MIDDAY,
    totalReviewTime: 0,
    ...overrides,
  });

  /** Globs an active assignment would contribute: README + markdown exempt. */
  const MARKDOWN_EXEMPT = ["**/README*", "**/*.md", "**/node_modules/**"];

  beforeEach(() => {
    mockDb = new DatabaseManager("") as jest.Mocked<DatabaseManager>;
    mockDb.getAllFilesForDate = jest.fn().mockResolvedValue([]);
    mockDb.getFileReviewsForDate = jest.fn().mockResolvedValue([]);
    mockDb.getUnreviewedFiles = jest.fn().mockResolvedValue([]);
    mockDb.getEvents = jest.fn().mockResolvedValue([]);
    // DatabaseManager resolves the active assignment's globs, falling back to
    // its default policy when none is active. Default exempts README/markdown.
    mockDb.getActiveExemptFileGlobs = jest
      .fn()
      .mockResolvedValue(["**/README*", "**/*.md", "**/package-lock.json"]);

    metricsRepo = new MetricsRepository(mockDb);
  });

  it("excludes an exempt README.md from AI authorship lines", async () => {
    mockDb.getActiveExemptFileGlobs.mockResolvedValue(MARKDOWN_EXEMPT);
    mockDb.getAllFilesForDate.mockResolvedValue([
      fileWith({
        filePath: "/proj/README.md",
        linesAdded: 400,
        firstGeneratedAt: MIDDAY,
      }) as any,
    ]);

    const metrics = await (metricsRepo as any).calculateMetricsFromEvents(
      TARGET_DATE,
      [],
    );

    expect(metrics.totalAILines).toBe(0);
    expect(metrics.aiPercentage).toBe(0);
  });

  it("still counts a non-exempt file's AI lines", async () => {
    mockDb.getActiveExemptFileGlobs.mockResolvedValue(MARKDOWN_EXEMPT);
    mockDb.getAllFilesForDate.mockResolvedValue([
      fileWith({ filePath: "/proj/src/app.ts", linesAdded: 100 }) as any,
    ]);

    const metrics = await (metricsRepo as any).calculateMetricsFromEvents(
      TARGET_DATE,
      [],
    );

    expect(metrics.totalAILines).toBe(100);
  });

  it("counts AI lines in a non-markdown file even when a README is also present", async () => {
    mockDb.getActiveExemptFileGlobs.mockResolvedValue(MARKDOWN_EXEMPT);
    mockDb.getAllFilesForDate.mockResolvedValue([
      fileWith({ filePath: "/proj/README.md", linesAdded: 400 }) as any,
      fileWith({ filePath: "/proj/src/app.ts", linesAdded: 100 }) as any,
    ]);

    const metrics = await (metricsRepo as any).calculateMetricsFromEvents(
      TARGET_DATE,
      [],
    );

    // The README must not contribute, so the total is the app.ts lines alone.
    expect(metrics.totalAILines).toBe(100);
  });

  it("exempts a file when no assignment is active, using the default policy", async () => {
    // No assignment: the database default policy exempts README and markdown,
    // so the dashboard must not contradict it either.
    mockDb.getActiveExemptFileGlobs.mockResolvedValue(["**/README*", "**/*.md"]);
    mockDb.getAllFilesForDate.mockResolvedValue([
      fileWith({
        filePath: "/proj/README.md",
        linesAdded: 400,
        firstGeneratedAt: MIDDAY,
      }) as any,
    ]);

    const metrics = await (metricsRepo as any).calculateMetricsFromEvents(
      TARGET_DATE,
      [],
    );

    expect(metrics.totalAILines).toBe(0);
  });

  it("leaves events in exempt files out of manual-line and tool totals", async () => {
    mockDb.getActiveExemptFileGlobs.mockResolvedValue(MARKDOWN_EXEMPT);
    mockDb.getAllFilesForDate.mockResolvedValue([]);

    const events = [
      {
        eventType: EventType.SuggestionAccepted,
        tool: AITool.Copilot,
        timestamp: MIDDAY,
        filePath: "/proj/README.md",
        linesOfCode: 50,
        acceptanceTimeDelta: 2000,
        source: "ai" as any,
      },
    ];

    const metrics = await (metricsRepo as any).calculateMetricsFromEvents(
      TARGET_DATE,
      events,
    );

    expect(metrics.toolBreakdown[AITool.Copilot].linesGenerated).toBe(0);
    expect(metrics.totalAILines).toBe(0);
  });
});
