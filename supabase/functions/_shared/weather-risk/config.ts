/**
 * Configurable weather-risk thresholds for AquaPrana farmer alerts.
 * Change values here (or override via DB later) without touching rule logic.
 */

export type RiskLevel = "green" | "yellow" | "orange" | "red";

export type AlertType =
  | "rain"
  | "temperature_low"
  | "temperature_high"
  | "wind"
  | "pressure"
  | "thunderstorm";

export const WEATHER_RISK_CONFIG = {
  rain: {
    yellowProbabilityPercent: 60,
    yellowRainMm24h: 10,
    orangeRainMm24h: 30,
    orangeProbabilityPercent: 80,
    orangeProlongedHours: 4,
    redRainMm24h: 60,
  },
  temperature: {
    yellowMinC: 24,
    orangeMaxC: 34,
    redMaxC: 36,
    highDensityPerAcre: 80_000,
    minAeratorsForHighDensity: 4,
  },
  wind: {
    yellowSpeedKmh: 30,
    yellowGustKmh: 40,
    orangeSpeedKmh: 45,
    orangeGustKmh: 60,
  },
  pressure: {
    yellowBelowHpa: 1005,
    rapidDropHpaIn6h: 4,
  },
  thunderstormCodes: [95, 96, 99] as readonly number[],
  dedupe: {
    yellowOrangeHours: 6,
    redHours: 2,
  },
  quietHoursBypassLevels: ["orange", "red"] as readonly RiskLevel[],
} as const;

export type WeatherRiskConfig = typeof WEATHER_RISK_CONFIG;
