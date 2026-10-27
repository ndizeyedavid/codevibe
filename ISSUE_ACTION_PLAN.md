# CodeVibe Issue Action Plan (Prioritized)

Date: 2026-10-27  
Repo: waka-man/codevibe  
Branch: main (v0.1.13 shipped)

## Current state
- Open issues: 11 (after closing #21,#27,#17,#22)
- Recent fix: PR #20 (merged) fixed dashboard loading (#27), export failures (#18), Emmet/undo/auto-close false positives (#15/#21). Shipped in v0.1.13.
- Known hot spots: external-file-change attribution, duplicate view/command registration in some activation paths, git diff on Windows, copy/paste/refactor attribution.

## Priority matrix (Severity × Fixability)
Use P0 highest. Fixability assumes existing patterns in codebase (tests, existing fixes like CommandRegistration).

| P | Issue | Type | Severity | Fixability | Root area | Action |
|---|---|---|---|---|---|---|
| P0 | #14 | Bug - activation duplicate view provider | High (activation crash) | High | `src/extension.ts:381`, `src/ui/DashboardProvider.ts` | Make view registration idempotent. Track registered view type in a module-level flag; if already registered, log and skip pushing duplicate subscription. Also check if activation can be called twice in some cases. Add test coverage. |
| P0 | #26 | Bug - activation duplicate view provider (same as #14) | High (activation crash) | High | same as #14 | Duplicate of #14 - close as duplicate after fix or fix together. |
| P0 | #10 | Bug - git pull/merge counted as AI on Windows (external-file-change) | High (false AI %) | Medium-High | `src/trackers/UnifiedAITracker.ts`, `src/detection/AIDetector.ts`, git diff handling | Improve Windows git diff robustness (path escaping/quoting, handle line endings), better detection of merge/pull induced changes vs user edits. Add Windows-specific tests/mocks. Consider skipping or down-weighting when git shows bulk merge changes across many files in short window. |
| P0 | #9 | Bug - external-file-change loops/duplicates | High (inflation) | Medium-High | `src/storage/MetricsRepository.ts` (dedup logic), `src/trackers/UnifiedAITracker.ts` | Tighten deduplication window/heuristics (same file+line count+timestamp range) as hinted in repo comments. Add guards against re-emitting same closed-file event. Regression tests exist partially. |
| P1 | #24 | Bug - AI jumps after git pull/merge | High (false %) | Medium-High | same as #10 | Closely related to #10; may be fixed together with better git/change detection. |
| P1 | #8 | Bug - flags VSCode default files as agentic | Medium-High | High | `src/trackers/UnifiedAITracker.ts`, exclusions/config | Expand default excluded paths/patterns (e.g. `.vscode/`, generated files) or treat VSCode auto-generated files as neutral/excluded. Check config/exclusion logic. |
| P1 | #11 | Bug - Prettier auto-format detected as AI | Medium-High | Medium | `src/detection/ChangeAttributionClassifier.ts`, tracker heuristics | Add formatter-aware heuristics (bulk whitespace/format-only changes) or detect formatting patterns. Could leverage existing neutral classification from PR #20 where applicable. |
| P1 | #12 | Bug - copy/paste/refactor flagged as AI | Medium-High | Medium | `src/detection/ChangeAttributionClassifier.ts`, `src/trackers/UnifiedAITracker.ts` | Extend neutral classification for large copy/paste across files/sessions where no AI source detected; improve context. PR #20 added some cases but issue says legitimate copy-paste still problematic. |
| P2 | #25 | Bug - ownership/thresholds not updating | Medium | Medium | `src/core/MetricsCollector.ts`, `src/ui/*`, config | Reproduce; likely UI/state sync or threshold recalculation issue. Add debug/telemetry-free logging and tests. |
| P2 | #29 | Feature - show which code is AI generated | Feature | Low-Medium | UI/visualization | Larger feature; needs design discussion. Deprioritize unless user explicitly wants. |
| P2 | #16 | Feature - Zed support | Feature | Low | Platform abstraction | Major integration work; defer. |

## Action plan by subagent

### Subagent 1: Activation stability (P0)
**Goal:** Fix duplicate view provider registration (#14,#26)
1. Read `src/extension.ts` `initializeUI` and how `dashboardProvider`/subscriptions are managed.
2. Make `registerWebviewViewProvider` idempotent: guard with a static/closure flag (e.g. `let dashboardViewRegistered = false`) or catch "already registered" error and log warning instead of failing activation.
3. Also consider if extension activates multiple times in workspace; ensure safe.
4. Add unit test in `src/ui/__tests__/DashboardProvider.test.ts` or new test for extension behavior.
5. Verify fix resolves both issues; close #26 as duplicate of #14 if fixed together.

### Subagent 2: Git/external-file-change hardening (P0-P1)
**Goal:** Fix #10,#24,#9
1. Examine `src/trackers/UnifiedAITracker.ts` git diff logic (Windows paths/escaping). Look for `execSync` usage.
2. Improve path quoting and error handling on Windows; normalize paths.
3. Enhance dedup in `MetricsRepository` for external-file-change bursts (same file, similar line counts, time window).
4. Add regression tests with mocked git outputs.
5. Consider rate-limiting/burst detection to avoid inflation.

### Subagent 3: Attribution accuracy (P1)
**Goal:** Fix #8,#11,#12
1. Extend `ChangeAttributionClassifier` with formatter/VSCode-generated/external-copy heuristics.
2. Expand exclusions for `.vscode/` and common generated files.
3. Add tests mirroring reported scenarios.
4. Be careful not to weaken integrity enforcement.

### Subagent 4: Misc (P2)
**Goal:** Investigate #25; file issues/design notes for #16,#29 if needed.

## Verification
- Run `npm test` / relevant test suites after changes.
- `npm run compile` / tsc check.
- Manual smoke: load extension, dashboard opens, no activation errors.

## Notes
- Keep public issue comments concise (no internal deliberation). 
- Follow repo patterns (use existing utilities like CommandRegistration). 
- CI disabled in repo; rely on local tests.
