/**
 * GitOperationDetector - tells "git rewrote this file" apart from "an AI
 * agent rewrote this file".
 *
 * Both look identical to the file watcher: a file changes on disk without any
 * keystrokes. Git leaves a trail in the git directory while and after it
 * touches the working tree, so this module reads that trail instead of
 * guessing. It never runs git, so it is cheap enough for every file change.
 */

import * as fs from 'fs';
import * as path from 'path';

/** How long after a git operation file changes are still attributed to it. */
export const GIT_OPERATION_WINDOW_MS = 30000;

/**
 * Present only while an operation is mid-flight. index.lock is held while
 * git writes the working tree; the others persist until a merge / rebase /
 * cherry-pick / revert is finished or aborted (including conflict states).
 */
const IN_PROGRESS_MARKERS = [
  'index.lock',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'rebase-merge',
  'rebase-apply',
];

/**
 * Rewritten by operations that change the working tree:
 * - ORIG_HEAD: merge, pull, rebase, reset. Written BEFORE the files change,
 *   which covers the race where the watcher fires before HEAD moves.
 * - logs/refs/stash: stash push / pop / apply / drop.
 *
 * FETCH_HEAD is deliberately excluded: VS Code's git.autofetch rewrites it
 * every few minutes without touching any file, which would blind agent
 * detection for 30s after every background fetch.
 */
const RECENT_MARKERS = ['ORIG_HEAD', path.join('logs', 'refs', 'stash')];

/** HEAD reflog entries that move HEAD without changing working-tree files. */
const NON_WORKTREE_REFLOG_PREFIXES = ['commit'];

function isRecent(filePath: string, now: number, windowMs: number): boolean {
  try {
    return now - fs.statSync(filePath).mtimeMs < windowMs;
  } catch {
    return false;
  }
}

/**
 * Message of the last HEAD reflog entry, e.g. "pull: Fast-forward",
 * "checkout: moving from main to dev", "commit: fix bug".
 * Reads only the tail so huge reflogs stay cheap.
 */
function readLastReflogMessage(reflogPath: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(reflogPath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 4096);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf-8').trim().split('\n');
    const last = lines[lines.length - 1] || '';
    const tab = last.indexOf('\t');
    return tab >= 0 ? last.slice(tab + 1) : '';
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export function isGitOperationInProgress(gitDir: string): boolean {
  return IN_PROGRESS_MARKERS.some((marker) => fs.existsSync(path.join(gitDir, marker)));
}

/**
 * True if git is currently changing files, or did so within `windowMs`.
 * A plain commit does not count: it changes no files, and an agent that
 * commits and keeps writing must still be detected.
 */
export function isGitOperationActive(
  gitDir: string,
  now: number = Date.now(),
  windowMs: number = GIT_OPERATION_WINDOW_MS
): boolean {
  if (isGitOperationInProgress(gitDir)) {
    return true;
  }

  if (RECENT_MARKERS.some((marker) => isRecent(path.join(gitDir, marker), now, windowMs))) {
    return true;
  }

  // checkout / switch / pull / merge / rebase / reset all log a HEAD move
  const headReflog = path.join(gitDir, 'logs', 'HEAD');
  if (isRecent(headReflog, now, windowMs)) {
    const message = readLastReflogMessage(headReflog);
    if (message === null) {
      // Recently moved but unreadable - don't blame the user for it
      return true;
    }
    return !NON_WORKTREE_REFLOG_PREFIXES.some((prefix) => message.startsWith(prefix));
  }

  return false;
}

/**
 * Wait (bounded) for an in-flight git write to finish, so the file is
 * compared against the HEAD git is moving to rather than the old one.
 */
export async function waitForGitIdle(
  gitDir: string,
  timeoutMs: number = 10000,
  pollMs: number = 250
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (fs.existsSync(path.join(gitDir, 'index.lock')) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
