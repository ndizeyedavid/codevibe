/**
 * AssignmentManager
 * Manages assignment lifecycle and policies for academic AI usage tracking.
 */

import { matchesAnyGlob } from "../utils/globMatch";
import { MetricsRepository } from '../storage/MetricsRepository';
import {
  Assignment,
  AssignmentPolicy,
  AIDetectionMethod
} from '../types';
import { DEFAULT_EXCLUDED_GLOBS } from '../utils/ExcludedPaths';

export interface CreateAssignmentInput {
  id?: string;
  name: string;
  courseId?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  repoUrl?: string;
  policy?: Partial<AssignmentPolicy>;
}

export class AssignmentManager {
  constructor(private metricsRepo: MetricsRepository) {}

  /**
   * Create a new assignment and optionally activate it
   */
  async createAssignment(input: CreateAssignmentInput): Promise<Assignment> {
    const id = input.id || this.generateAssignmentId();
    const now = Date.now();

    const assignment: Assignment = {
      id,
      name: input.name,
      courseId: input.courseId,
      startDate: input.startDate,
      endDate: input.endDate,
      repoUrl: input.repoUrl,
      policy: this.buildPolicy(input.policy ?? {}),
      createdAt: now,
      updatedAt: now,
      isActive: false
    };

    await this.metricsRepo.saveAssignment(assignment);
    return assignment;
  }

  /**
   * Activate an assignment by ID. Only one assignment can be active at a time.
   */
  async activateAssignment(id: string): Promise<Assignment | null> {
    await this.metricsRepo.setActiveAssignment(id);
    const assignment = await this.metricsRepo.getAssignment(id);
    // Tamper-evidence marker: brackets the lockdown window in the audit trail
    try {
      await this.metricsRepo.recordExclusionAudit(Date.now(), [], 'assignment-activated');
    } catch {
      // Audit is best-effort; activation must not fail because of it
    }
    return assignment;
  }

  /**
   * Deactivate the currently active assignment
   */
  async deactivateAssignment(): Promise<void> {
    await this.metricsRepo.setActiveAssignment(null);
    try {
      await this.metricsRepo.recordExclusionAudit(Date.now(), [], 'assignment-deactivated');
    } catch {
      // Audit is best-effort; deactivation must not fail because of it
    }
  }

  /**
   * Get the currently active assignment, or null if none is active
   */
  async getActiveAssignment(): Promise<Assignment | null> {
    return await this.metricsRepo.getActiveAssignment();
  }

  /**
   * List all stored assignments, most recent first
   */
  async listAssignments(): Promise<Assignment[]> {
    return await this.metricsRepo.getAssignments();
  }

  /**
   * Get a single assignment by ID
   */
  async getAssignment(id: string): Promise<Assignment | null> {
    return await this.metricsRepo.getAssignment(id);
  }

  /**
   * Update assignment policy or metadata
   */
  async updateAssignment(
    id: string,
    // policy accepts PARTIAL overrides, matching buildPolicy() and
    // createAssignment(). It was typed as a full AssignmentPolicy, which made
    // the documented "update policy" path impossible to call without
    // constructing a complete policy object by hand.
    updates: Partial<Omit<Assignment, 'id' | 'createdAt' | 'policy'>> & {
      policy?: Partial<AssignmentPolicy>;
    },
  ): Promise<Assignment | null> {
    const existing = await this.metricsRepo.getAssignment(id);
    if (!existing) {
      return null;
    }

    const updated: Assignment = {
      ...existing,
      ...updates,
      policy: updates.policy ? this.buildPolicy(updates.policy) : existing.policy,
      updatedAt: Date.now()
    };

    await this.metricsRepo.saveAssignment(updated);
    return updated;
  }

  /**
   * Build a complete policy from partial overrides and defaults
   */
  buildPolicy(overrides: Partial<AssignmentPolicy>): AssignmentPolicy {
    const defaults = this.getDefaultPolicy();
    return {
      ...defaults,
      ...overrides,
      prohibitedMethods: overrides.prohibitedMethods ?? defaults.prohibitedMethods,
      permittedMethods: overrides.permittedMethods ?? defaults.permittedMethods,
      flaggedMethods: overrides.flaggedMethods ?? defaults.flaggedMethods,
      exemptFileGlobs: overrides.exemptFileGlobs ?? defaults.exemptFileGlobs
    };
  }

  /**
   * Default academic policy:
   * - Agentic/external file changes are prohibited (Claude Code, Cursor Composer, etc.)
   * - Git commit markers are prohibited
   * - Inline completions are permitted (review still required for ownership)
   * - Large pastes and velocity are flagged and counted toward authorship
   */
  getDefaultPolicy(): AssignmentPolicy {
    return {
      maxAuthorshipPercentage: 30,
      minOwnershipScore: 40,
      exemptFileGlobs: [
        '**/README*',
        '**/*.md',
        '**/package.json',
        '**/package-lock.json',
        '**/npm-shrinkwrap.json',
        '**/yarn.lock',
        '**/pnpm-lock.yaml',
        '**/poetry.lock',
        '**/Pipfile.lock',
        '**/Gemfile.lock',
        '**/Cargo.lock',
        '**/composer.lock',
        '**/go.sum',
        '**/.gitignore',
        '**/LICENSE*',
        '**/tsconfig.json',
        '**/.eslintrc*',
        '**/.prettierrc*',
        // Generated/dependency dirs are hard-ignored at collection time;
        // listing them here too filters pre-existing events from reports.
        ...DEFAULT_EXCLUDED_GLOBS
      ],
      prohibitedMethods: [
        AIDetectionMethod.ExternalFileChange,
        AIDetectionMethod.GitCommitMarker
      ],
      permittedMethods: [
        AIDetectionMethod.InlineCompletionAPI
      ],
      flaggedMethods: [
        AIDetectionMethod.LargePaste,
        AIDetectionMethod.ChangeVelocity
      ],
      minLargePasteReviewTimeMs: 5000,
      maxTrackingGapSeconds: 1800
    };
  }

  /**
   * Check if a file path matches any exempt glob in the policy
   */
  isExemptFile(filePath: string, policy: AssignmentPolicy): boolean {
    return matchesAnyGlob(filePath, policy.exemptFileGlobs);
  }

  private generateAssignmentId(): string {
    return `assignment-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
