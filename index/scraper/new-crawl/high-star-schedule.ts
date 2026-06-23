export const HIGH_STAR_SKILL_MD_WEEKLY_UTC_DAY = 0;

export function shouldRunWeeklyHighStarSkillMdDiscovery(
  checkedAt: string,
  weeklyUtcDay = HIGH_STAR_SKILL_MD_WEEKLY_UTC_DAY,
): boolean {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return false;
  return date.getUTCDay() === weeklyUtcDay;
}
