const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPO_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;

export function normalizePolicyHandle(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidPolicyHandle(value) {
  const normalized = normalizePolicyHandle(value);
  return normalized.length <= 80 && HANDLE_PATTERN.test(normalized);
}

export function normalizePolicyRepo(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

export function isValidPolicyRepo(value) {
  return REPO_PATTERN.test(String(value ?? "").trim());
}

export function normalizePolicySkillId(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function policyRepoFromSkillId(value) {
  const normalized = normalizePolicySkillId(value);
  const separator = normalized.indexOf(":");
  return normalizePolicyRepo(separator >= 0 ? normalized.slice(0, separator) : normalized);
}

export function isValidPolicySkillId(value) {
  const normalized = normalizePolicySkillId(value);
  if (!normalized || /[\r\n\0]/.test(normalized)) return false;
  const separator = normalized.indexOf(":");
  const repo = separator >= 0 ? normalized.slice(0, separator) : normalized;
  const skillPath = separator >= 0 ? normalized.slice(separator + 1) : null;
  return isValidPolicyRepo(repo) && (skillPath === null || skillPath.trim().length > 0);
}
