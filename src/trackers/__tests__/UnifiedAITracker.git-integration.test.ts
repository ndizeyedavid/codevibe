/**
 * Git operation detection against real git directories (not mocks).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { UnifiedAITracker } from '../UnifiedAITracker';
import { isGitOperationActive, isGitOperationInProgress, GIT_OPERATION_WINDOW_MS } from '../../utils/GitOperationDetector';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock vscode
jest.mock('vscode', () => ({
  workspace: {
    onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
    createFileSystemWatcher: jest.fn(() => ({
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
      onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
      dispose: jest.fn()
    })),
    openTextDocument: jest.fn(),
    textDocuments: [],
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }]
  },
  window: {
    onDidChangeActiveTextEditor: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeVisibleTextEditors: jest.fn(() => ({ dispose: jest.fn() })),
    activeTextEditor: undefined,
    visibleTextEditors: []
  },
  commands: {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() }))
  },
  Uri: {
    parse: jest.fn((p: string) => ({ fsPath: p })),
    file: jest.fn((p: string) => ({ fsPath: p }))
  }
}), { virtual: true });

// Mock AIDetector
jest.mock('../../detection/AIDetector', () => ({
  AIDetector: jest.fn().mockImplementation(() => ({
    detect: jest.fn().mockReturnValue({ isAI: false, confidence: 'low' }),
    detectFromExternalFileChange: jest.fn().mockReturnValue({
      isAI: true,
      confidence: 'high',
      method: 'external-file-change',
      metadata: {
        source: 'external-file-change',
        charactersCount: 500,
        linesOfCode: 20
      }
    }),
    reset: jest.fn()
  }))
}));

describe('UnifiedAITracker - GitOperationDetector with Real Git Dir', () => {
  let testGitDir: string;

  beforeEach(() => {
    testGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codevibe-integration-'));
    fs.mkdirSync(path.join(testGitDir, 'logs', 'refs'), { recursive: true });
  });

  afterEach(() => {
    if (testGitDir && fs.existsSync(testGitDir)) {
      fs.rmSync(testGitDir, { recursive: true, force: true });
    }
  });

  function writeGitFile(rel: string, content = '') {
    fs.writeFileSync(path.join(testGitDir, rel), content);
  }

  function setGitFileMtime(rel: string, msAgo: number) {
    const t = new Date(Date.now() - msAgo);
    fs.utimesSync(path.join(testGitDir, rel), t, t);
  }

  const REFLOG_LINE = 'a'.repeat(40) + ' ' + 'b'.repeat(40) + ' Dev <dev@example.com> 1760000000 +0000\t';

  describe('isGitOperationActive - Git operations that rewrite working tree', () => {
    it('returns true for recent ORIG_HEAD (git pull/merge/rebase/reset just finished)', () => {
      writeGitFile('ORIG_HEAD', 'a'.repeat(40));
      expect(isGitOperationActive(testGitDir)).toBe(true);
    });

    it('returns true for recent HEAD reflog pull entry', () => {
      writeGitFile(path.join('logs', 'HEAD'), REFLOG_LINE + 'pull: Fast-forward\n');
      expect(isGitOperationActive(testGitDir)).toBe(true);
    });

    it('returns true for recent HEAD reflog checkout entry', () => {
      writeGitFile(path.join('logs', 'HEAD'), REFLOG_LINE + 'checkout: moving from main to feature\n');
      expect(isGitOperationActive(testGitDir)).toBe(true);
    });

    it('returns true for recent HEAD reflog merge entry', () => {
      writeGitFile(path.join('logs', 'HEAD'), REFLOG_LINE + 'merge origin/main: Merge made by ort\n');
      expect(isGitOperationActive(testGitDir)).toBe(true);
    });

    it('returns true for recent HEAD reflog rebase entry', () => {
      writeGitFile(path.join('logs', 'HEAD'), REFLOG_LINE + 'rebase (finish): returning to refs/heads/main\n');
      expect(isGitOperationActive(testGitDir)).toBe(true);
    });

    it('returns true for recent HEAD reflog reset entry', () => {
      writeGitFile(path.join('logs', 'HEAD'), REFLOG_LINE + 'reset: moving to HEAD~1\n');
      expect(isGitOperationActive(testGitDir)).toBe(true);
    });

    it('returns true for recent stash reflog (stash pop/apply)', () => {
      writeGitFile(path.join('logs', 'refs', 'stash'), REFLOG_LINE + 'WIP on main\n');
      expect(isGitOperationActive(testGitDir)).toBe(true);
    });

    describe('Operations that do NOT rewrite working tree', () => {
      it('returns FALSE for commit-only reflog (no working tree change)', () => {
        writeGitFile(path.join('logs', 'HEAD'), REFLOG_LINE + 'commit: add feature\n' + REFLOG_LINE + 'commit: fix bug\n');
        expect(isGitOperationActive(testGitDir)).toBe(false);
      });

      it('returns FALSE for FETCH_HEAD (autofetch changes no files)', () => {
        writeGitFile('FETCH_HEAD', 'a'.repeat(40) + "\t\tbranch 'main' of origin\n");
        expect(isGitOperationActive(testGitDir)).toBe(false);
      });

      it('returns FALSE after window expires', () => {
        writeGitFile('ORIG_HEAD', 'a'.repeat(40));
        setGitFileMtime('ORIG_HEAD', GIT_OPERATION_WINDOW_MS + 1000);
        expect(isGitOperationActive(testGitDir)).toBe(false);
      });

      it('returns FALSE in a quiet repo', () => {
        expect(isGitOperationActive(testGitDir)).toBe(false);
      });
    });
  });

  describe('isGitOperationInProgress - Mid-flight operations', () => {
    it('returns true while index.lock exists (git writing working tree)', () => {
      writeGitFile('index.lock');
      expect(isGitOperationInProgress(testGitDir)).toBe(true);
    });

    it('returns true for MERGE_HEAD (merge in progress, may have conflicts)', () => {
      writeGitFile('MERGE_HEAD', 'a'.repeat(40));
      expect(isGitOperationInProgress(testGitDir)).toBe(true);
    });

    it('returns true for CHERRY_PICK_HEAD (cherry-pick in progress)', () => {
      writeGitFile('CHERRY_PICK_HEAD', 'a'.repeat(40));
      expect(isGitOperationInProgress(testGitDir)).toBe(true);
    });

    it('returns true for REVERT_HEAD (revert in progress)', () => {
      writeGitFile('REVERT_HEAD', 'a'.repeat(40));
      expect(isGitOperationInProgress(testGitDir)).toBe(true);
    });

    it('returns true for rebase-merge directory', () => {
      fs.mkdirSync(path.join(testGitDir, 'rebase-merge'));
      expect(isGitOperationInProgress(testGitDir)).toBe(true);
    });

    it('returns true for rebase-apply directory', () => {
      fs.mkdirSync(path.join(testGitDir, 'rebase-apply'));
      expect(isGitOperationInProgress(testGitDir)).toBe(true);
    });
  });

  describe('Tracker integration: isGitOperationActiveFor() uses real git dir', () => {
    it('resolves git dir via rev-parse and checks markers', async () => {
      const tracker = new UnifiedAITracker(jest.fn());
      await tracker.initialize();

      // Spy on resolveGitDir to verify it's called
      const resolveGitDirSpy = jest.spyOn(tracker as any, 'resolveGitDir').mockReturnValue(testGitDir);

      // Write a marker that should trigger detection
      writeGitFile('ORIG_HEAD', 'a'.repeat(40));

      // Call the private method via reflection
      const result = (tracker as any).isGitOperationActiveFor();

      expect(resolveGitDirSpy).toHaveBeenCalledWith('/workspace');
      expect(result).toBe(true);

      resolveGitDirSpy.mockRestore();
      tracker.dispose();
    });
  });
});