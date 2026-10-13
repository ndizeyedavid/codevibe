/**
 * Issue #5 end-to-end check against a real sql.js database.
 *
 * Reproduces the reported scenario: AI-generated text pasted into README.md
 * drove the dashboard from 2% to 88% AI even though README is exempt.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { DatabaseManager } from "../DatabaseManager";
import { MetricsRepository } from "../MetricsRepository";
import { TrackingEvent, EventType, AITool } from "../../types";
import { toLocalDateString } from "../../utils/DateUtils";

jest.setTimeout(60000);

describe("Issue #5 integration: README paste must not spike authorship", () => {
  let db: DatabaseManager;
  let repo: MetricsRepository;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `codepause-issue5-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    db = new DatabaseManager(tempDir);
    await db.initialize();
    repo = new MetricsRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("ignores AI lines in an exempt README but counts exempt-exempt source", async () => {
    const now = Date.now();
    const today = toLocalDateString(now);

    // The student's real work.
    await db.insertEvent({
      timestamp: now,
      tool: AITool.Copilot,
      eventType: EventType.SuggestionAccepted,
      filePath: "/proj/src/app.ts",
      linesOfCode: 20,
      charactersCount: 200,
      source: "ai",
      detectionMethod: "inline-completion-api",
    } as unknown as TrackingEvent);

    // The reported paste: AI text into an exempt README.
    await db.insertEvent({
      timestamp: now,
      tool: AITool.Copilot,
      eventType: EventType.SuggestionAccepted,
      filePath: "/proj/README.md",
      linesOfCode: 400,
      charactersCount: 40000,
      source: "ai",
      detectionMethod: "large-paste",
    } as unknown as TrackingEvent);

    await db.insertOrUpdateFileReviewStatus({
      filePath: "/proj/src/app.ts",
      date: today,
      tool: AITool.Copilot,
      reviewQuality: "good" as any,
      reviewScore: 80,
      isReviewed: true,
      linesGenerated: 20,
      linesChanged: 20,
      linesSinceReview: 20,
      linesAdded: 20,
      linesRemoved: 0,
      charactersCount: 200,
      isAgentGenerated: false,
      wasFileOpen: true,
      firstGeneratedAt: now,
      lastReviewedAt: now,
      totalReviewTime: 60000,
      agentSessionId: null,
      wasReviewedInTerminal: false,
      language: "typescript",
      modificationCount: 1,
      totalTimeInFocus: 60000,
      scrollEventCount: 10,
      cursorMovementCount: 50,
      editsMade: true,
      reviewSessionsCount: 1,
      lastOpenedAt: now,
    } as any);

    await db.insertOrUpdateFileReviewStatus({
      filePath: "/proj/README.md",
      date: today,
      tool: AITool.Copilot,
      reviewQuality: "flag" as any,
      reviewScore: 10,
      isReviewed: false,
      linesGenerated: 400,
      linesChanged: 400,
      linesSinceReview: 400,
      linesAdded: 400,
      linesRemoved: 0,
      charactersCount: 40000,
      isAgentGenerated: false,
      wasFileOpen: true,
      firstGeneratedAt: now,
      lastReviewedAt: null,
      totalReviewTime: 0,
      agentSessionId: null,
      wasReviewedInTerminal: false,
      language: "typescript",
      modificationCount: 1,
      totalTimeInFocus: 60000,
      scrollEventCount: 10,
      cursorMovementCount: 50,
      editsMade: true,
      reviewSessionsCount: 1,
      lastOpenedAt: now,
    } as any);

    const metrics = await repo.calculateDailyMetrics(today);

    console.log(
      `  [issue #5] totalAILines=${metrics.totalAILines} aiPercentage=${metrics.aiPercentage.toFixed(1)}`,
    );

    // 400 README lines must not count; only the 20 source lines should.
    // (aiPercentage is 100% here only because this fixture records no manual
    // lines, so AI is the whole denominator - the assertion that matters is
    // the line count, which is where the spike came from.)
    expect(metrics.totalAILines).toBe(20);
  });

  it("still counts a non-exempt source file fully", async () => {
    const now = Date.now();
    const today = toLocalDateString(now);

    await db.insertOrUpdateFileReviewStatus({
      filePath: "/proj/src/app.ts",
      date: today,
      tool: AITool.Copilot,
      reviewQuality: "good" as any,
      reviewScore: 80,
      isReviewed: true,
      linesGenerated: 120,
      linesChanged: 120,
      linesSinceReview: 120,
      linesAdded: 120,
      linesRemoved: 0,
      charactersCount: 900,
      isAgentGenerated: false,
      wasFileOpen: true,
      firstGeneratedAt: now,
      lastReviewedAt: now,
      totalReviewTime: 60000,
      agentSessionId: null,
      wasReviewedInTerminal: false,
      language: "typescript",
      modificationCount: 1,
      totalTimeInFocus: 60000,
      scrollEventCount: 10,
      cursorMovementCount: 50,
      editsMade: true,
      reviewSessionsCount: 1,
      lastOpenedAt: now,
    } as any);

    const metrics = await repo.calculateDailyMetrics(today);

    expect(metrics.totalAILines).toBe(120);
  });
});
