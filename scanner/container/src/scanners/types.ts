import type { ContainerFile, Finding, ScanStatus } from "../../../src/protocol.js";

/** One scanner. Add one by writing a module like omg-rules.ts and listing it in index.ts. */
export type Scanner = {
  name: string;
  version: string;
  scan(files: ContainerFile[]): Promise<{
    status: ScanStatus;
    findings: Finding[];
    filesScanned: number;
    filesSkipped: number;
  }>;
};
