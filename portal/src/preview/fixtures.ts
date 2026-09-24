import type { PortalData, PortalSet, SetItem } from "../app/model";
import type { SyncedSkill } from "../synced-skill-grouping";

export type Scenario =
  | "populated"
  | "empty"
  | "loading"
  | "error"
  | "long-content"
  | "connected-source";
const entries = [
  [
    "brand-voice",
    "Keep every touchpoint consistent with your brand's tone and personality.",
    "coreyhaines31/marketingskills",
  ],
  [
    "copywriting",
    "Write clear, persuasive copy for landing pages, emails, and campaigns.",
    "coreyhaines31/marketingskills",
  ],
  [
    "design-system",
    "Build consistent interfaces with reusable components and design tokens.",
    "anthropics/skills",
  ],
  [
    "frontend-design",
    "Create distinctive, production-grade frontend interfaces with high design quality.",
    "anthropics/skills",
  ],
  [
    "landing-page",
    "Design focused landing pages that turn visitors into customers.",
    "",
  ],
  [
    "product-marketing-context",
    "Capture positioning, audience, and the story behind your product.",
    "coreyhaines31/marketingskills",
  ],
  [
    "seo-audit",
    "Find technical SEO issues and improve search visibility.",
    "coreyhaines31/marketingskills",
  ],
  [
    "social-content",
    "Plan, create, and refine content for your social channels.",
    "coreyhaines31/marketingskills",
  ],
  [
    "swift-concurrency",
    "Review async code for safe isolation and predictable execution.",
    "",
  ],
  [
    "webapp-testing",
    "Test local web applications with browser automation.",
    "anthropics/skills",
  ],
];

export function makeFixtures(scenario: Scenario = "populated"): PortalData {
  const skills: SyncedSkill[] = entries.flatMap(
    ([name, description, repo], index) =>
      (index % 3 === 0
        ? ["Claude", "Codex"]
        : [index % 2 ? "Claude" : "Codex"]
      ).map((source) => ({
        id: `${name}-${source}`,
        name,
        description,
        catalogSkillId: repo ? `${repo}:${name}` : null,
        identityStatus: repo ? ("resolved" as const) : ("localOnly" as const),
        githubUrl: repo ? `https://github.com/${repo}` : null,
        isLocalOnly: !repo,
        source,
        lastSeenAt: "2026-09-24T10:00:00Z",
      })),
  );
  const item = (index: number): SetItem => ({
    id: `item-${index}`,
    syncedSkillId: skills[index].id,
    name: skills[index].name,
    description: skills[index].description || "",
    githubUrl: skills[index].githubUrl,
    kind: "synced",
  });
  const sets: PortalSet[] = [
    {
      id: "favorites",
      name: "Favorites",
      description: "Your favorite skills, shared publicly.",
      visibility: "public",
      isFavorites: true,
      hidden: false,
      role: "owner",
      ownerName: "Jonathan",
      emails: [],
      items: [item(0), item(4)],
    },
    {
      id: "marketing",
      name: "Marketing essentials",
      description: "The everyday toolkit for telling a better story.",
      visibility: "restricted",
      isFavorites: false,
      hidden: false,
      role: "owner",
      ownerName: "Jonathan",
      emails: ["alex@example.com", "sam@example.com"],
      items: [item(0), item(2), item(8)],
    },
    {
      id: "design",
      name: "Design & development",
      description: "From first idea to polished interface.",
      visibility: "public",
      isFavorites: false,
      hidden: false,
      role: "owner",
      ownerName: "Jonathan",
      emails: [],
      items: [
        item(3),
        item(4),
        {
          id: "github-item",
          syncedSkillId: null,
          name: "interface-review",
          description: "A repository skill added directly to this set.",
          githubUrl: "https://github.com/anthropics/skills",
          kind: "github",
        },
      ],
    },
    {
      id: "personal",
      name: "Personal workspace",
      description: "Skills for work in progress.",
      visibility: "private",
      isFavorites: false,
      hidden: false,
      role: "owner",
      ownerName: "Jonathan",
      emails: [],
      items: [
        {
          id: "private-item",
          syncedSkillId: null,
          name: "internal-style-guide",
          description: "A private release. Access is managed separately.",
          githubUrl: null,
          kind: "private-release",
        },
      ],
    },
    {
      id: "shared",
      name: "Product launch",
      description: "A shared toolkit for launch day.",
      visibility: "restricted",
      isFavorites: false,
      hidden: false,
      role: "invited",
      ownerName: "Alex Morgan",
      emails: [],
      items: [item(2), item(8), item(10)],
    },
  ];
  const data: PortalData = {
    skills,
    sets,
    devices: [
      {
        id: "mac",
        name: "Jonathan's MacBook Pro",
        lastActive: "Sep 24, 2026",
        status: "active",
      },
      {
        id: "old-mac",
        name: "Mac mini",
        lastActive: "Sep 18, 2026",
        status: "expired",
      },
    ],
    profile: {
      name: "Jonathan Slimak",
      handle: "jonslimak",
      email: "jonathan@example.com",
      published: true,
    },
    privateSourceConnected: scenario === "connected-source",
  };
  if (scenario === "empty") {
    data.skills = [];
    data.sets = [];
    data.devices = [];
  }
  if (scenario === "long-content") {
    data.skills[0].name =
      "a-very-long-skill-name-for-checking-responsive-layout-and-readable-content";
    data.skills[0].description =
      "A deliberately long description that must remain accessible without stretching the table or pushing its action buttons outside the viewport. ".repeat(
        4,
      );
    data.sets[1].name =
      "Marketing, communications, and international product launch planning";
    data.sets[1].emails.push(
      "long.recipient.name.for.layout.review@example.com",
    );
  }
  return data;
}
