/**
 * Glob matching for assignment exemption rules.
 *
 * Three copies of this matcher used to exist (AssignmentManager, PolicyEngine
 * and, implicitly, nowhere in the dashboard path). Issue #5 was caused by that
 * drift: the report honoured exemptFileGlobs but the dashboard did not. Keep a
 * single implementation so every consumer agrees on what an exemption means.
 *
 * Supported syntax, matching the behaviour the assignment reports already had:
 *   **  matches any number of path segments (including none)
 *   *   matches any run of characters within one segment
 *   ?   matches a single character
 */

const ANY_DEPTH = "<<<ANYDEPTH>>>";

/**
 * Build a RegExp for a single glob. The result is anchored to the whole path.
 */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/\*\*/g, ANY_DEPTH)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(ANY_DEPTH, "g"), ".*")
    .replace(/\?/g, ".");

  return new RegExp(`^${pattern}$`);
}

/**
 * True when `filePath` matches `glob` in full.
 */
export function matchesGlob(filePath: string, glob: string): boolean {
  if (!filePath || !glob) {
    return false;
  }
  return globToRegExp(glob).test(filePath);
}

/**
 * True when `filePath` matches at least one of `globs`.
 */
export function matchesAnyGlob(
  filePath: string | undefined | null,
  globs: readonly string[] | undefined | null,
): boolean {
  if (!filePath || !globs || globs.length === 0) {
    return false;
  }
  return globs.some((glob) => matchesGlob(filePath, glob));
}
