// marked-terminal v7 does not ship type declarations; provide a minimal ambient module.
declare module "marked-terminal" {
  import type { MarkedExtension } from "marked";
  export function markedTerminal(options?: Record<string, unknown>): MarkedExtension;
  export default markedTerminal;
}
