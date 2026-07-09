import { stat } from "node:fs/promises";
import path from "node:path";

const requiredWebLibraryArtifacts = [
  "profiles/anthropics/index.html",
  "skills/anthropics/skills/frontend-design/index.html",
  "collections/starter-pack/index.html",
  "skills/index.html",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
];

async function isFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function verifyWebLibraryDeployArtifacts(rootDir, label = "deploy artifact") {
  const missing = [];

  for (const relativePath of requiredWebLibraryArtifacts) {
    if (!(await isFile(path.join(rootDir, relativePath)))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${label} is unsafe: missing generated web library deploy artifacts: ${missing.join(", ")}`
    );
  }
}
