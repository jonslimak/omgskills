import record from "./distribution.json";

// Bootstrap A deliberately: the separate manual app-update test must discover B.
export const candidateDistribution = Object.freeze({ ...record, client: "candidate" as const });
export type CandidateDistribution = typeof candidateDistribution;
