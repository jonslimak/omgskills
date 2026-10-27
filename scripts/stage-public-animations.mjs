import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

export const publicAnimations = [
  "skill-management-mobile5.html",
  "skill-management-v4.html",
];

export async function stagePublicAnimations(repoRoot, outputDir) {
  const destination = path.join(outputDir, "animation");
  await mkdir(destination, { recursive: true });
  for (const filename of publicAnimations) {
    await cp(path.join(repoRoot, "animation", filename), path.join(destination, filename), {
      force: false,
      errorOnExist: true,
    });
  }
}
