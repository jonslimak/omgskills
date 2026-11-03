import type { Config } from "@netlify/functions";
import { getPgPool } from "./_shared/db.js";
import { createCloudObjectStore } from "./_shared/cloud-store.js";
import { sweepCloudStorage } from "./_shared/cloud-storage-sweep.js";

export const config: Config = { schedule: "0 * * * *" };

export default async () => {
  try {
    const result = await sweepCloudStorage(getPgPool(), createCloudObjectStore());
    console.info("cloud storage sweep", result);
    return new Response(null, { status: 204 });
  } catch {
    console.error("cloud storage sweep failed; retrying next hour");
    return new Response(null, { status: 500 });
  }
};
