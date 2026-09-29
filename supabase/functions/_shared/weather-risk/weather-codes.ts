/**
 * Open-Meteo WMO weather code → farmer-friendly condition label.
 * Never show raw codes in the UI.
 */

export function weatherCodeToCondition(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) {
    return "Unknown";
  }
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Cloudy";
}

export function isThunderstormCode(
  code: number | null | undefined,
  codes: readonly number[],
): boolean {
  return code != null && codes.includes(code);
}
