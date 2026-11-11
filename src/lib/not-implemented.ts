// Marks scaffolded entry points. Every call site maps to a milestone in SCOPE.md §11.
export function notImplemented(what: string, milestone: string): never {
  throw new Error(`[shiplog] Not implemented: ${what} (${milestone})`);
}
