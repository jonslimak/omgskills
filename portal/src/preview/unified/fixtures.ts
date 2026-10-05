import type { CatalogDisplay } from "../../app/unified/model";
import { makeFixtures as makeBaseFixtures, type Scenario } from "../fixtures";
import anthropics from "../../../../web-handoff/app/assets/anthropics.png";
import matt from "../../../../web-handoff/app/assets/mattpocock.png";
import emil from "../../../../web-handoff/app/assets/emilkowalski.jpg";
import garry from "../../../../web-handoff/app/assets/garrytan.jpg";
import paul from "../../../../web-handoff/app/assets/twostraws.jpg";
import blader from "../../../../web-handoff/app/assets/blader.jpg";
import hermes from "../../../../web-handoff/app/assets/hermes.png";
import sam from "../../../../web-handoff/app/assets/sam.jpg";

export type { Scenario };

export function makeFixtures(scenario: Scenario = "populated") {
  const data = makeBaseFixtures(scenario);
  if (scenario === "long-content") {
    const first = data.skills[0];
    data.skills = data.skills.map((skill) =>
      skill.catalogSkillId === first.catalogSkillId
        ? { ...skill, name: first.name, description: first.description }
        : skill,
    );
  }
  return data;
}

export function makeCatalog(): CatalogDisplay {
  const creators = [
    {
      handle: "anthropics",
      name: "Anthropic",
      tagline: "Skills from the people behind Claude",
      avatar: anthropics,
    },
    {
      handle: "mattpocock",
      name: "Matt Pocock",
      tagline: "Better thinking. Better TypeScript.",
      avatar: matt,
    },
    {
      handle: "emilkowalski",
      name: "Emil Kowalski",
      tagline: "Interfaces that feel right",
      avatar: emil,
    },
    {
      handle: "garrytan",
      name: "Garry Tan",
      tagline: "Build something people want",
      avatar: garry,
    },
    {
      handle: "twostraws",
      name: "Paul Hudson",
      tagline: "Swift and SwiftUI, done well",
      avatar: paul,
    },
    {
      handle: "blader",
      name: "Blader",
      tagline: "Practical tools for builders",
      avatar: blader,
    },
    {
      handle: "coreyhaines31",
      name: "Corey Haines",
      tagline: "Marketing skills for your next launch",
    },
    {
      handle: "hermes",
      name: "Hermes",
      tagline: "A thoughtful research toolkit",
      avatar: hermes,
    },
    {
      handle: "sam",
      name: "Sam",
      tagline: "Everyday workflows, simplified",
      avatar: sam,
    },
  ];
  const base = makeFixtures();
  const publicSkills = [
    ...new Map(
      base.skills
        .filter((s) => s.catalogSkillId)
        .map((s) => [s.catalogSkillId!, s]),
    ).values(),
  ];
  const skills = publicSkills.map((skill, i) => {
    const author = skill.catalogSkillId!.split("/")[0];
    return {
      id: skill.catalogSkillId!,
      name: skill.name,
      description: skill.description || "",
      author,
      avatar: creators.find((c) => c.handle === author)?.avatar,
      githubUrl: skill.githubUrl!,
      stars: 178400 - i * 9200,
      tags:
        author === "anthropics"
          ? ["Design system", "React", "Testing"]
          : ["Copywriting", "SEO", "Social media"],
    };
  });
  skills.push(
    ...[
      [
        "mattpocock",
        "grill-me",
        "Turn a half-formed idea into a clear plan through thoughtful questions.",
        "Deep research",
      ],
      [
        "emilkowalski",
        "design-engineering",
        "Build polished interfaces with thoughtful motion and interaction.",
        "Animation",
      ],
      [
        "twostraws",
        "swiftui-pro",
        "Write modern SwiftUI with reliable state and accessible components.",
        "SwiftUI",
      ],
      [
        "garrytan",
        "gstack",
        "A toolkit for shipping software with confidence.",
        "Code review",
      ],
      [
        "blader",
        "humanizer",
        "Make your writing sound like you, not your language model.",
        "Writing",
      ],
      [
        "anthropics",
        "pdf",
        "Read, create, merge, and work with PDF documents.",
        "PDF",
      ],
      [
        "hermes",
        "research",
        "Explore a topic and build a clear, sourced research brief.",
        "Deep research",
      ],
      [
        "sam",
        "api-design",
        "Design readable APIs with predictable contracts.",
        "API design",
      ],
    ].map(([author, name, description, tag], i) => ({
      id: `${author}/skills:${name}`,
      name,
      description,
      author,
      avatar: creators.find((c) => c.handle === author)?.avatar,
      githubUrl: `https://github.com/${author}`,
      stars: 21800 + i * 4300,
      tags: [tag],
    })),
  );
  return {
    skills,
    creators,
    collections: [
      {
        id: "build",
        name: "Build your next thing",
        description: "From the first idea to a polished app.",
        skillIds: skills
          .filter((s) => s.author === "anthropics" || s.author === "twostraws")
          .map((s) => s.id),
      },
      {
        id: "design",
        name: "A little more craft",
        description: "Interfaces worth paying attention to.",
        skillIds: skills
          .filter((s) =>
            s.tags.some((t) => ["Animation", "React", "Writing"].includes(t)),
          )
          .map((s) => s.id),
      },
      {
        id: "launch",
        name: "Ready for launch",
        description: "Find your voice. Reach your people.",
        skillIds: skills
          .filter((s) => s.author === "coreyhaines31")
          .map((s) => s.id),
      },
    ],
    categories: [
      {
        label: "Design + Apps",
        items: [
          "Design system",
          "SwiftUI",
          "React",
          "App Store",
          "Landing page",
          "Animation",
        ],
      },
      {
        label: "Marketing",
        items: [
          "Brand",
          "Copywriting",
          "SEO",
          "Blog",
          "Social media",
          "Market research",
        ],
      },
      {
        label: "Coding",
        items: [
          "Code review",
          "Testing",
          "Debugging",
          "Refactoring",
          "API design",
          "Security audit",
        ],
      },
      {
        label: "Practical",
        items: [
          "MCP server",
          "Deep research",
          "PDF",
          "Deck",
          "Excel",
          "Writing",
        ],
      },
    ],
    trendingIds: [...skills.slice(8, 13), ...skills.slice(0, 8)].map(
      (s) => s.id,
    ),
  };
}
