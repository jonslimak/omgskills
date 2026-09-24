import { useAuth } from "@clerk/clerk-react";
import { PortalApiError } from "./api-error";

export type PortalApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export function usePortalApi(): PortalApi {
  const { getToken } = useAuth();

  return async function portalApi<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    init.signal?.throwIfAborted();
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
      throw new PortalApiError(body?.error ?? `Request failed with ${response.status}`, response.status);
    }
    return body as T;
  };
}
