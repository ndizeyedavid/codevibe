/**
 * GitOperationDetector - uses a real temp git directory so the marker files
 * and HEAD reflog are read exactly as git leaves them.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isGitOperationActive,
  isGitOperationInProgress,
  waitForGitIdle,
  GIT_OPERATION_WINDOW_MS,
} from '../GitOperationDetector';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function reflogLine(message: string): string {
  return `${SHA_A} ${SHA_B} Dev <dev@example.com> 1760000000 +0000\t${message}\n`;
}

describe('GitOperationDetector', () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codevibe-git-'));
    fs.mkdirSync(path.join(gitDir, 'logs', 'refs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  const write = (rel: string, content = '') => fs.writeFileSync(path.join(gitDir, rel), content);
  const age = (rel: string, ms: number) => {
    const t = new Date(Date.now() - ms);
    fs.utimesSync(path.join(gitDir, rel), t, t);
  };

  it('is idle in a quiet repo', () => {
    expect(isGitOperationActive(gitDir)).toBe(false);
  });

  it.each(['index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'])(
    'is in progress while %s exists',
    (marker) => {
      write(marker);
      expect(isGitOperationInProgress(gitDir)).toBe(true);
      expect(isGitOperationActive(gitDir)).toBe(true);
    }
  );

  it.each(['rebase-merge', 'rebase-apply'])('is in progress during a rebase (%s)', (dir) => {
    fs.mkdirSync(path.join(gitDir, dir));
    expect(isGitOperationActive(gitDir)).toBe(true);
  });

  it('is active right after a pull/merge/reset writes ORIG_HEAD', () => {
    write('ORIG_HEAD', SHA_A);
    expect(isGitOperationActive(gitDir)).toBe(true);
  });

  it('is active right after a stash pop', () => {
    write(path.join('logs', 'refs', 'stash'), reflogLine('WIP on main'));
    expect(isGitOperationActive(gitDir)).toBe(true);
  });

  it.each([
    'pull: Fast-forward',
    'checkout: moving from main to feature',
    'merge origin/main: Merge made by the \'ort\' strategy.',
    'rebase (finish): returning to refs/heads/main',
    'reset: moving to HEAD~1',
  ])('is active right after HEAD reflog entry "%s"', (message) => {
    write(path.join('logs', 'HEAD'), reflogLine('commit (initial): init') + reflogLine(message));
    expect(isGitOperationActive(gitDir)).toBe(true);
  });

  it.each(['commit: add feature', 'commit (amend): fix typo'])(
    'stays idle after "%s" (commits change no files; agents that commit must still be caught)',
    (message) => {
      write(path.join('logs', 'HEAD'), reflogLine('pull: Fast-forward') + reflogLine(message));
      expect(isGitOperationActive(gitDir)).toBe(false);
    }
  );

  it('ignores FETCH_HEAD (background autofetch changes no files)', () => {
    write('FETCH_HEAD', `${SHA_A}\t\tbranch 'main' of origin\n`);
    expect(isGitOperationActive(gitDir)).toBe(false);
  });

  it('expires once the window has passed', () => {
    write('ORIG_HEAD', SHA_A);
    write(path.join('logs', 'HEAD'), reflogLine('pull: Fast-forward'));
    age('ORIG_HEAD', GIT_OPERATION_WINDOW_MS + 1000);
    age(path.join('logs', 'HEAD'), GIT_OPERATION_WINDOW_MS + 1000);
    expect(isGitOperationActive(gitDir)).toBe(false);
  });

  it('waitForGitIdle returns once index.lock is released', async () => {
    write('index.lock');
    setTimeout(() => fs.rmSync(path.join(gitDir, 'index.lock')), 100);
    const start = Date.now();
    await waitForGitIdle(gitDir, 5000, 20);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(isGitOperationInProgress(gitDir)).toBe(false);
  });

  it('waitForGitIdle gives up after the timeout (stale lock)', async () => {
    write('index.lock');
    const start = Date.now();
    await waitForGitIdle(gitDir, 200, 20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(150);
  });
});
