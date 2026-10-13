/**
 * The autosave write must be atomic (issues #6/#7).
 *
 * Writing straight to dbPath left a window where a crash or a killed process
 * left a half-written file, which sql.js then rejected with "file is not a
 * database". These tests pin the temp-file-then-rename behaviour that closes
 * that window.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { DatabaseManager } from "../DatabaseManager";

jest.setTimeout(60000);

describe("DatabaseManager atomic sync", () => {
  let tempDir: string;
  let db: DatabaseManager;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `codepause-sync-${Date.now()}-${Math.random()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    db = new DatabaseManager(tempDir);
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("survives a failed save followed by a successful one", () => {
    db.sync();
    const good = fs.readFileSync(path.join(tempDir, "global.db"));

    // Force a failure, then recover.
    fs.chmodSync(tempDir, 0o500);
    db.sync();
    fs.chmodSync(tempDir, 0o700);
    db.sync();

    expect(
      fs.readFileSync(path.join(tempDir, "global.db")).equals(good),
    ).toBe(true);
    expect(fs.readdirSync(tempDir).filter((f) => f.includes(".tmp-"))).toEqual(
      [],
    );
  });

  it("leaves no temp files behind after a successful save", () => {
    db.sync();
    db.sync();

    const leftovers = fs
      .readdirSync(tempDir)
      .filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("writes a valid SQLite file that reopens cleanly", () => {
    db.sync();

    const raw = fs.readFileSync(path.join(tempDir, "global.db"));
    expect(raw.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");

    const reopened = new DatabaseManager(tempDir);
    return reopened.initialize().then(() => {
      expect(reopened.recoveredFromCorruption).toBe(false);
      reopened.close();
    });
  });

  it("keeps the previous good file when a save fails", () => {
    db.sync();
    const good = fs.readFileSync(path.join(tempDir, "global.db"));

    // Make the directory read-only so the temp file cannot be created.
    fs.chmodSync(tempDir, 0o500);
    try {
      db.sync();
      // Whatever happened, the database on disk must still be readable.
      const after = fs.readFileSync(path.join(tempDir, "global.db"));
      expect(after.equals(good)).toBe(true);
    } finally {
      fs.chmodSync(tempDir, 0o700);
    }

    const reopened = new DatabaseManager(tempDir);
    return reopened.initialize().then(() => {
      expect(reopened.recoveredFromCorruption).toBe(false);
      reopened.close();
    });
  });

});
