export interface ParsedArgs {
  resume: boolean;
  resumeId?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const idx = argv.indexOf("--resume");
  if (idx === -1) return { resume: false };
  const next = argv[idx + 1];
  if (next && !next.startsWith("--")) return { resume: true, resumeId: next };
  return { resume: true };
}
