type NetlifyEnv = {
  env?: {
    get?: (key: string) => string | undefined;
  };
};

export function getEnv(key: string): string | undefined {
  const netlifyValue = (globalThis as typeof globalThis & { Netlify?: NetlifyEnv }).Netlify?.env?.get?.(key);
  return netlifyValue ?? process.env[key];
}
