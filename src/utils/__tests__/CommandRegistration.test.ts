/**
 * Idempotent command registration - issue #4.
 */

const registeredCommands = new Map<string, (() => void)>();
let commandThrows = false;

jest.mock("vscode", () => ({
  commands: {
    registerCommand: jest.fn((id: string, _cb: any) => {
      if (commandThrows) {
        throw new Error(`command '${id}' already exists`);
      }
      registeredCommands.set(id, () => {});
      return { dispose: () => registeredCommands.delete(id) };
    }),
    getCommands: jest.fn((_filterInternal?: boolean) =>
      Array.from(registeredCommands.keys()),
    ),
    executeCommand: jest.fn(),
  },
  window: {},
}), { virtual: true });

import * as vscode from "vscode";
import {
  getSkippedCommandIds,
  registerCommandSafe,
  resetCommandRegistration,
} from "../CommandRegistration";

describe("registerCommandSafe", () => {
  beforeEach(() => {
    resetCommandRegistration();
    registeredCommands.clear();
    commandThrows = false;
    (vscode.commands.getCommands as jest.Mock).mockImplementation(() =>
      Array.from(registeredCommands.keys()),
    );
  });

  it("registers a command that is not already taken", async () => {
    const d = await registerCommandSafe("codePause.openDashboard", () => {});
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "codePause.openDashboard",
      expect.any(Function),
    );
    expect(registeredCommands.has("codePause.openDashboard")).toBe(true);
    d.dispose();
  });

  it("skips a command another copy already registered instead of throwing", async () => {
    // Simulate the second copy of the extension from issue #4.
    registeredCommands.set("codePause.openDashboard", () => {});

    const d = await registerCommandSafe("codePause.openDashboard", () => {});

    // No throw, and we did not clobber the other copy's registration.
    expect(registeredCommands.has("codePause.openDashboard")).toBe(true);
    expect(getSkippedCommandIds()).toContain("codePause.openDashboard");
    expect(d.dispose).not.toThrow();
  });

  it("replaces its own registration on a repeated activate", async () => {
    const first = await registerCommandSafe("codePause.startOnboarding", () => {});
    first.dispose();
    // Re-activate without disposing, as a duplicate activate would.
    await registerCommandSafe("codePause.startOnboarding", () => {});
    expect(registeredCommands.has("codePause.startOnboarding")).toBe(true);
    expect(getSkippedCommandIds()).not.toContain("codePause.startOnboarding");
  });

  it("does not skip a command it registered itself", async () => {
    await registerCommandSafe("codePause.snooze", () => {});
    expect(getSkippedCommandIds()).not.toContain("codePause.snooze");
  });

  it("survives registerCommand throwing", async () => {
    commandThrows = true;
    const d = await registerCommandSafe("codePause.openDashboard", () => {});
    expect(getSkippedCommandIds()).toContain("codePause.openDashboard");
    expect(() => d.dispose()).not.toThrow();
  });

  it("still works when getCommands is unavailable", async () => {
    (vscode.commands.getCommands as jest.Mock).mockImplementation(() => {
      throw new Error("no such api");
    });
    const d = await registerCommandSafe("codePause.exportData", () => {});
    expect(registeredCommands.has("codePause.exportData")).toBe(true);
    d.dispose();
  });
});

describe("getSkippedCommandIds", () => {
  it("is empty after a reset", () => {
    resetCommandRegistration();
    expect(getSkippedCommandIds()).toEqual([]);
  });
});
