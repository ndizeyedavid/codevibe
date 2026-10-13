/**
 * Issue #6/#7: "file is not a database" at activation.
 *
 * sql.js accepts a corrupt buffer in the Database constructor and only throws
 * on the first exec(), so the failure surfaces in createTables() and takes
 * down activate() with the extension unusable.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { DatabaseManager } from "../DatabaseManager";

jest.setTimeout(60000);

/** Bytes that are definitely not a SQLite file. */
const CORRUPT = Buffer.from(
  "this is not a sqlite database, it is just some text someone wrote",
);

describe("DatabaseManager corruption recovery", () => {
  let tempDir: string;
  let db: DatabaseManager | null = null;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `codepause-corrupt-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, "global.db"), CORRUPT);
  });

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(tempDir + "-seed", { recursive: true, force: true });
  });

  it("does not throw 'file is not a database' on a corrupt db file", async () => {
    // Before the fix this rejected here, so activate() failed and the
    // extension was unusable with no in-product way out.
    db = new DatabaseManager(tempDir);
    await expect(db.initialize()).resolves.toBeUndefined();
  });

  it("recovers by quarantining the corrupt file and starting fresh", async () => {
    db = new DatabaseManager(tempDir);
    await db.initialize();

    // Usable again.
    await db.setConfig("k", { a: 1 });
    expect(await db.getConfig("k")).toEqual({ a: 1 });

    // The corrupt bytes were preserved, not destroyed.
    const files = fs.readdirSync(tempDir);
    const quarantined = files.filter((f) => /corrupt/i.test(f));
    expect(quarantined.length).toBe(1);
    const preserved = fs.readFileSync(path.join(tempDir, quarantined[0]));
    expect(preserved.equals(CORRUPT)).toBe(true);

    // And the live database is a real SQLite file now. Autosave is on a timer,
    // so flush explicitly before reading it back off disk.
    db.sync();
    const live = fs.readFileSync(path.join(tempDir, "global.db"));
    expect(live.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
  });

  it("reports how many quarantined files exist for diagnostics", async () => {
    db = new DatabaseManager(tempDir);
    await db.initialize();
    expect(db.recoveredFromCorruption).toBe(true);
    expect(db.quarantinedDbPath).toBeTruthy();
  });

  it("does not flag corruption on a healthy database", async () => {
    fs.rmSync(path.join(tempDir, "global.db"));
    db = new DatabaseManager(tempDir);
    await db.initialize();

    expect(db.recoveredFromCorruption).toBe(false);
    expect(db.quarantinedDbPath).toBeNull();
    expect(fs.readdirSync(tempDir).filter((f) => /corrupt/i.test(f))).toEqual(
      [],
    );
  });

  it("does not quarantine an existing healthy database", async () => {
    const seedDir = tempDir + "-seed";
    fs.mkdirSync(seedDir, { recursive: true });
    const healthy = new DatabaseManager(seedDir);
    await healthy.initialize();
    healthy.close();
    fs.rmSync(seedDir, { recursive: true, force: true });

    db = new DatabaseManager(tempDir);
    await db.initialize();
    await db.setConfig("k", "v");
    db.sync();

    const reopened = new DatabaseManager(tempDir);
    await reopened.initialize();
    expect(reopened.recoveredFromCorruption).toBe(false);
    expect(await reopened.getConfig("k")).toBe("v");
    reopened.close();
  });
});
