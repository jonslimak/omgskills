export type PrivateSourceRepository = {
  id: string;
  fullName: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
};

export type PrivateSourceInstallation = {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositories: PrivateSourceRepository[];
};

export type PrivateSkillSource = {
  id: string;
  installationId: string;
  repositoryId: string;
  repositorySlug: string;
  normalizedRoot: string;
  createdAt: string;
};

export type PrivateSkillRelease = {
  id: string;
  sourceId: string;
  commitSha: string;
  treeSha: string;
  skillMdSha: string;
  createdAt: string;
};

export type PrivateSourceView = {
  installations: PrivateSourceInstallation[];
  sources: PrivateSkillSource[];
};
