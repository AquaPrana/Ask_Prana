import type { OpenMeteoForecast } from "./engine.ts";

const CURRENT =
  "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m";

const HOURLY =
  "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,rain,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m";

const DAILY =
  "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max";

export function buildOpenMeteoUrl(
  latitude: number,
  longitude: number,
): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY,
    timezone: "auto",
    wind_speed_unit: "kmh",
    forecast_days: "7",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export async function fetchOpenMeteoForecast(
  latitude: number,
  longitude: number,
  options?: { fetchImpl?: typeof fetch; maxRetries?: number },
): Promise<OpenMeteoForecast> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const maxRetries = options?.maxRetries ?? 3;
  const url = buildOpenMeteoUrl(latitude, longitude);
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP ${response.status}`);
      }
      const data = (await response.json()) as OpenMeteoForecast;
      if (data.latitude == null || data.longitude == null) {
        throw new Error("Open-Meteo returned incomplete payload");
      }
      return data;
    } catch (error) {
      lastError = error;
      const delayMs = Math.min(8000, 500 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Open-Meteo fetch failed");
}

/** Round coords for farm-location clustering (~100 m). */
export function locationKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

export function isValidCoordinate(
  latitude: unknown,
  longitude: unknown,
): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}
