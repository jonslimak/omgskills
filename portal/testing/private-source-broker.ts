import { GitHubBrokerClient, GitHubBrokerError, type BrokerRepository } from "../../netlify/functions/_shared/github-broker.js";
import { gitObjectSha, validateSkillPackage } from "../../netlify/functions/_shared/skill-package.js";

export const fixtureInstallation = {
  installationId: "930000001", accountId: "930000002", accountLogin: "local-github-simulation", accountType: "Organization" as const,
};
export const fixtureRepository: BrokerRepository = {
  id: "930000003", fullName: "local-github-simulation/skills", name: "skills", isPrivate: true, defaultBranch: "main",
};

// Server/test-only substitute. Never reads credentials and never falls back to network access.
export class PrivateSourceFixtureBroker extends GitHubBrokerClient {
  constructor(readonly scenario: "connected" | "empty" | "revoked" | "rate-limited" = "connected") {
    super({ appId: 1, privateKey: "LOCAL-SIMULATION-NOT-A-KEY" }, async () => { throw new Error("Fixture network access forbidden"); });
  }
  override async getInstallation(id: string) {
    if (this.scenario === "rate-limited") throw new GitHubBrokerError("rate_limited", "Simulated rate limit", 60);
    if (id !== fixtureInstallation.installationId || this.scenario === "revoked") {
      throw new GitHubBrokerError("installation_unavailable", "Simulated installation unavailable");
    }
    return { ...fixtureInstallation };
  }
  override async listRepositories(id: string) {
    await this.getInstallation(id);
    return this.scenario === "empty" ? [] : [{ ...fixtureRepository }];
  }
  override async verifySkillRoot(id: string, repository: BrokerRepository, root: string) {
    const granted = await this.listRepositories(id);
    if (!granted.some((repo) => repo.id === repository.id && repo.fullName === repository.fullName)) {
      throw new GitHubBrokerError("repository_unavailable", "Repository is not in the fixture");
    }
    if (![".", "skills/design-review", ".claude/skills/Design"].includes(root)) {
      throw new GitHubBrokerError("skill_root_missing", "SKILL.md was not found at that root");
    }
  }
  override async fetchCurrentSkillPackage(id: string, repository: BrokerRepository, root: string) {
    await this.verifySkillRoot(id, repository, root);
    const data = Buffer.from(`---\nname: local-design-review\ndescription: Local-only fixture\n---\nReview ${root}.\n`);
    const blobSha = gitObjectSha("blob", data);
    const treeSha = gitObjectSha("tree", Buffer.concat([Buffer.from("100644 SKILL.md\0"), Buffer.from(blobSha, "hex")]));
    const result = { coordinates: { commitSha: "d".repeat(40), treeSha, skillMdSha: blobSha },
      entries: [{ path: "SKILL.md", mode: "100644", data, blobSha }] };
    validateSkillPackage(result, result.coordinates);
    return result;
  }
}
