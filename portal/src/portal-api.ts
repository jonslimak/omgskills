import { useAuth } from "@clerk/clerk-react";

export type PortalApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export function usePortalApi(): PortalApi {
  const { getToken } = useAuth();

  return async function portalApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error ?? `Request failed with ${response.status}`);
    }
    return body as T;
  };
}
