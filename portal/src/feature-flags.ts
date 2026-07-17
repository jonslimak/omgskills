const connectPathPattern = /^\/(?:app\/)?connect\/?$/;

export function isSkillGroupsAuthEnabled(value: unknown): boolean {
  return value === "1";
}

export function isEnabledConnectRoute(pathname: string, authEnabled: boolean): boolean {
  return authEnabled && connectPathPattern.test(pathname);
}
