/**
 * Idempotent command registration.
 *
 * Issue #4: two copies of the extension loaded at once (0.1.9 and a newer
 * version both present in ~/.vscode/extensions) meant activate() ran twice
 * and the second run threw
 *
 *   command 'codePause.openDashboard' already exists
 *
 * from vscode.commands.registerCommand, taking down the whole activation.
 *
 * Two things are needed to cover that:
 *
 *  1. A module-level record of what this module instance registered, so a
 *     repeated activate() in the same process replaces its own registrations
 *     instead of colliding with them.
 *  2. A check against vscode.commands.getCommands(), because the duplicate in
 *     issue #4 was a *different* copy of the extension - a separate module
 *     instance with its own module-level state. Only the global registry sees
 *     it.
 *
 * When a command is already present from elsewhere we deliberately do not
 * register over it and do not throw: a command whose handler lost the race is
 * better than an extension that fails to activate.
 */

import * as vscode from "vscode";

/** Commands registered by this module instance, keyed by command id. */
const registered = new Map<string, vscode.Disposable>();

/** Ids we skipped because another copy of the extension already owns them. */
const skipped = new Set<string>();

/**
 * Every command id VS Code currently has registered, including commands
 * contributed by other extensions. Returns an empty set if the API is
 * unavailable, which downgrades us to local-only protection.
 */
async function getRegisteredCommandIds(): Promise<Set<string>> {
  try {
    // getCommands returns a Thenable, so it has to be awaited before the
    // result can go in a Set.
    return new Set(await vscode.commands.getCommands(true));
  } catch {
    return new Set();
  }
}

/**
 * Register a command, tolerating an id that is already taken.
 *
 * Returns a disposable either way: a real one when we registered, a no-op when
 * we skipped. Always push it to context.subscriptions so deactivation stays
 * symmetrical.
 */
export async function registerCommandSafe(
  commandId: string,
  callback: (...args: any[]) => any,
): Promise<vscode.Disposable> {
  // Our own earlier registration: dispose it before replacing.
  const previous = registered.get(commandId);
  if (previous) {
    try {
      previous.dispose();
    } catch {
      // Already disposed; nothing to do.
    }
    registered.delete(commandId);
  }

  // Someone else's registration (a second copy of this extension).
  if ((await getRegisteredCommandIds()).has(commandId)) {
    skipped.add(commandId);
    console.warn(
      `[CodeVibe] Command "${commandId}" is already registered by another ` +
        `copy of the extension. Skipping so activation can continue. ` +
        `Uninstall the duplicate version to remove this message.`,
    );
    return { dispose: () => undefined };
  }

  try {
    const disposable = vscode.commands.registerCommand(commandId, callback);
    registered.set(commandId, disposable);
    return disposable;
  } catch (error) {
    // Lost a race between the check above and here. Same reasoning as the
    // skip path: never let registration take down activation.
    skipped.add(commandId);
    console.warn(
      `[CodeVibe] Could not register "${commandId}": ${
        error instanceof Error ? error.message : String(error)
      }. Continuing without it.`,
    );
    return { dispose: () => undefined };
  }
}

/**
 * Command ids skipped because another copy already owned them. Surfaced for
 * diagnostics so the "why is this command dead" question has an answer.
 */
export function getSkippedCommandIds(): string[] {
  return Array.from(skipped);
}

/**
 * Clear module state. For tests, and for deactivate() so a reload starts
 * clean.
 */
export function resetCommandRegistration(): void {
  for (const disposable of registered.values()) {
    try {
      disposable.dispose();
    } catch {
      // Ignore.
    }
  }
  registered.clear();
  skipped.clear();
}
