/**
 * Glob matcher regression tests.
 *
 * The semantics here are what assignment reports have always used, so they are
 * pinned explicitly: other consumers (the dashboard, via MetricsRepository)
 * now depend on them agreeing.
 */

import { globToRegExp, matchesAnyGlob, matchesGlob } from "../globMatch";

describe("matchesGlob", () => {
  it("matches a markdown file at the repo root", () => {
    expect(matchesGlob("/proj/README.md", "**/*.md")).toBe(true);
  });

  it("matches markdown nested at any depth", () => {
    expect(matchesGlob("/proj/docs/guide/notes.md", "**/*.md")).toBe(true);
  });

  it("matches a README prefix glob", () => {
    expect(matchesGlob("/proj/README.md", "**/README*")).toBe(true);
    expect(matchesGlob("/proj/README", "**/README*")).toBe(true);
  });

  it("does not match a non-exempt source file", () => {
    expect(matchesGlob("/proj/src/app.ts", "**/*.md")).toBe(false);
  });

  it("does not match a directory glob against a file", () => {
    expect(matchesGlob("/proj/src/app.ts", "**/node_modules/**")).toBe(false);
  });

  it("matches generated directories", () => {
    expect(matchesGlob("/proj/node_modules/lodash/index.js", "**/node_modules/**")).toBe(
      true,
    );
  });

  it("honours ? as a single character", () => {
    expect(matchesGlob("/proj/a1.ts", "**/a?.ts")).toBe(true);
    expect(matchesGlob("/proj/a12.ts", "**/a?.ts")).toBe(false);
  });

  it("returns false for empty inputs instead of throwing", () => {
    expect(matchesGlob("", "**/*.md")).toBe(false);
    expect(matchesGlob("/proj/a.md", "")).toBe(false);
  });
});

describe("matchesAnyGlob", () => {
  it("is true when any one glob matches", () => {
    const globs = ["**/node_modules/**", "**/*.md"];
    expect(matchesAnyGlob("/proj/README.md", globs)).toBe(true);
    expect(matchesAnyGlob("/proj/src/app.ts", globs)).toBe(false);
  });

  it("is false for an empty or missing glob list", () => {
    expect(matchesAnyGlob("/proj/a.md", [])).toBe(false);
    expect(matchesAnyGlob("/proj/a.md", undefined)).toBe(false);
    expect(matchesAnyGlob("/proj/a.md", null)).toBe(false);
  });
});

describe("globToRegExp", () => {
  it("anchors the pattern to the whole path", () => {
    const re = globToRegExp("**/*.md");
    expect(re.test("/proj/README.md")).toBe(true);
    expect(re.test("/proj/README.md.bak")).toBe(false);
    // ** spans separators, so a leading **/ does match multiple segments.
    expect(re.test("prefix/proj/README.md")).toBe(true);
  });

  it("keeps * inside a single segment", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/app.ts")).toBe(true);
    expect(re.test("src/nested/app.ts")).toBe(false);
  });
});
