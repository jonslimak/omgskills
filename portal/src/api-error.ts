export class PortalApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PortalApiError";
  }
}

export function isAccessError(error: unknown) {
  return error instanceof PortalApiError && (error.status === 401 || error.status === 403);
}
