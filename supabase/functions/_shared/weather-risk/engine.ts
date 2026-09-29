import {
  WEATHER_RISK_CONFIG,
  type AlertType,
  type RiskLevel,
  type WeatherRiskConfig,
} from "./config.ts";
import { isThunderstormCode, weatherCodeToCondition } from "./weather-codes.ts";

export type HourlyWeatherPoint = {
  time: string;
  temperature_2m?: number | null;
  relative_humidity_2m?: number | null;
  precipitation_probability?: number | null;
  precipitation?: number | null;
  rain?: number | null;
  weather_code?: number | null;
  surface_pressure?: number | null;
  wind_speed_10m?: number | null;
  wind_direction_10m?: number | null;
  wind_gusts_10m?: number | null;
};

export type DailyWeatherPoint = {
  time: string;
  weather_code?: number | null;
  temperature_2m_max?: number | null;
  temperature_2m_min?: number | null;
  precipitation_sum?: number | null;
  rain_sum?: number | null;
  precipitation_probability_max?: number | null;
  wind_speed_10m_max?: number | null;
  wind_gusts_10m_max?: number | null;
};

export type CurrentWeather = {
  time?: string;
  temperature_2m?: number | null;
  relative_humidity_2m?: number | null;
  apparent_temperature?: number | null;
  precipitation?: number | null;
  rain?: number | null;
  weather_code?: number | null;
  cloud_cover?: number | null;
  surface_pressure?: number | null;
  wind_speed_10m?: number | null;
  wind_direction_10m?: number | null;
  wind_gusts_10m?: number | null;
};

export type OpenMeteoForecast = {
  latitude: number;
  longitude: number;
  timezone?: string;
  current?: CurrentWeather;
  hourly?: {
    time: string[];
    temperature_2m?: Array<number | null>;
    relative_humidity_2m?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    precipitation?: Array<number | null>;
    rain?: Array<number | null>;
    weather_code?: Array<number | null>;
    surface_pressure?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
  };
  daily?: {
    time: string[];
    weather_code?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    rain_sum?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    wind_speed_10m_max?: Array<number | null>;
    wind_gusts_10m_max?: Array<number | null>;
  };
};

export type PondContext = {
  pondId: string;
  pondName: string;
  farmName: string;
  areaAcres: number | null;
  depthFt: number | null;
  salinity: number | null;
  hasActiveCycle: boolean;
  cropCycleId: string | null;
  species: string | null;
  stockingDate: string | null;
  cultureDay: number | null;
  stockingDensity: number | null;
  biomassKg: number | null;
  aeratorCount: number | null;
  generatorAvailable: boolean | null;
  reservoirAvailable: boolean | null;
};

export type EvaluatedAlert = {
  alertType: AlertType;
  riskLevel: RiskLevel;
  title: string;
  message: string;
  recommendedAction: string;
  messageKey: string;
  messageVars: Record<string, string | number>;
  forecastStart: string;
  forecastEnd: string;
  pondId: string | null;
  cropCycleId: string | null;
  requiresAcknowledgement: boolean;
  weatherSnapshot: Record<string, unknown>;
  pondSnapshot: Record<string, unknown> | null;
  /** Farm-level severe weather (no active cycle required). */
  isFarmLevel: boolean;
};

function num(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function maxOf(values: Array<number | null | undefined>): number | null {
  let max: number | null = null;
  for (const v of values) {
    const n = num(v);
    if (n == null) continue;
    if (max == null || n > max) max = n;
  }
  return max;
}

function minOf(values: Array<number | null | undefined>): number | null {
  let min: number | null = null;
  for (const v of values) {
    const n = num(v);
    if (n == null) continue;
    if (min == null || n < min) min = n;
  }
  return min;
}

function sumOf(values: Array<number | null | undefined>): number {
  let sum = 0;
  for (const v of values) {
    const n = num(v);
    if (n != null) sum += n;
  }
  return sum;
}

export function flattenHourly(forecast: OpenMeteoForecast): HourlyWeatherPoint[] {
  const hourly = forecast.hourly;
  if (!hourly?.time?.length) return [];

  return hourly.time.map((time, i) => ({
    time,
    temperature_2m: hourly.temperature_2m?.[i] ?? null,
    relative_humidity_2m: hourly.relative_humidity_2m?.[i] ?? null,
    precipitation_probability: hourly.precipitation_probability?.[i] ?? null,
    precipitation: hourly.precipitation?.[i] ?? null,
    rain: hourly.rain?.[i] ?? null,
    weather_code: hourly.weather_code?.[i] ?? null,
    surface_pressure: hourly.surface_pressure?.[i] ?? null,
    wind_speed_10m: hourly.wind_speed_10m?.[i] ?? null,
    wind_direction_10m: hourly.wind_direction_10m?.[i] ?? null,
    wind_gusts_10m: hourly.wind_gusts_10m?.[i] ?? null,
  }));
}

export function flattenDaily(forecast: OpenMeteoForecast): DailyWeatherPoint[] {
  const daily = forecast.daily;
  if (!daily?.time?.length) return [];

  return daily.time.map((time, i) => ({
    time,
    weather_code: daily.weather_code?.[i] ?? null,
    temperature_2m_max: daily.temperature_2m_max?.[i] ?? null,
    temperature_2m_min: daily.temperature_2m_min?.[i] ?? null,
    precipitation_sum: daily.precipitation_sum?.[i] ?? null,
    rain_sum: daily.rain_sum?.[i] ?? null,
    precipitation_probability_max:
      daily.precipitation_probability_max?.[i] ?? null,
    wind_speed_10m_max: daily.wind_speed_10m_max?.[i] ?? null,
    wind_gusts_10m_max: daily.wind_gusts_10m_max?.[i] ?? null,
  }));
}

/** Next 24 hours of hourly points from `nowIso` (inclusive start). */
export function next24hPoints(
  hourly: HourlyWeatherPoint[],
  nowIso: string,
): HourlyWeatherPoint[] {
  const now = Date.parse(nowIso);
  const end = now + 24 * 60 * 60 * 1000;
  return hourly.filter((p) => {
    const t = Date.parse(p.time);
    return Number.isFinite(t) && t >= now && t <= end;
  });
}

export function next6hPoints(
  hourly: HourlyWeatherPoint[],
  nowIso: string,
): HourlyWeatherPoint[] {
  const now = Date.parse(nowIso);
  const end = now + 6 * 60 * 60 * 1000;
  return hourly.filter((p) => {
    const t = Date.parse(p.time);
    return Number.isFinite(t) && t >= now && t <= end;
  });
}

function isHighDensity(
  pond: PondContext,
  config: WeatherRiskConfig,
): boolean {
  const density = num(pond.stockingDensity);
  if (density == null) return false;
  return density >= config.temperature.highDensityPerAcre;
}

function aerationInsufficient(
  pond: PondContext,
  config: WeatherRiskConfig,
): boolean {
  if (!isHighDensity(pond, config)) return false;
  const aerators = num(pond.aeratorCount);
  if (aerators == null) return false;
  return aerators < config.temperature.minAeratorsForHighDensity;
}

function pondOverflowRiskHigh(
  pond: PondContext,
  rainMm24h: number | null,
): boolean {
  if (rainMm24h == null || rainMm24h < 60) return false;
  const depth = num(pond.depthFt);
  // Shallow ponds with heavy rain and no reservoir → overflow risk
  if (depth != null && depth <= 4 && pond.reservoirAvailable === false) {
    return true;
  }
  return false;
}

function prolongedRainHours(
  points: HourlyWeatherPoint[],
  minMmPerHour = 1,
): number {
  let streak = 0;
  let best = 0;
  for (const p of points) {
    const rain = num(p.rain) ?? num(p.precipitation) ?? 0;
    if (rain >= minMmPerHour) {
      streak += 1;
      best = Math.max(best, streak);
    } else {
      streak = 0;
    }
  }
  return best;
}

function pressureDropHpa(points: HourlyWeatherPoint[]): number | null {
  if (points.length < 2) return null;
  const first = num(points[0]?.surface_pressure);
  const last = num(points[points.length - 1]?.surface_pressure);
  if (first == null || last == null) return null;
  return first - last;
}

function riskRank(level: RiskLevel): number {
  switch (level) {
    case "green":
      return 0;
    case "yellow":
      return 1;
    case "orange":
      return 2;
    case "red":
      return 3;
    default:
      return 0;
  }
}

export function higherRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}

type MessageTemplate = {
  key: string;
  title: string;
  message: string;
  action: string;
};

function fill(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? ""),
  );
}

const MESSAGES: Record<string, MessageTemplate> = {
  rain_yellow: {
    key: "weather.alert.rain.yellow",
    title: "Rain expected",
    message:
      "Rain is expected near {farmName} within the next 24 hours. Reduce feed by 10–15% and inspect pond bunds and drainage.",
    action: "Reduce feed 10–15%. Inspect bunds and drainage.",
  },
  rain_orange: {
    key: "weather.alert.rain.orange",
    title: "Heavy rain warning",
    message:
      "Heavy rain is expected near {pondName}. Salinity, alkalinity and pH may decrease. Reduce feed and check drainage, pond bunds and water level.",
    action: "Reduce feed. Check drainage, bunds and water level.",
  },
  rain_red: {
    key: "weather.alert.rain.red",
    title: "Critical heavy-rain warning",
    message:
      "Critical heavy-rain warning for {pondName}. Pond overflow and rapid salinity change are possible. Inspect drainage immediately and monitor salinity and pH after rainfall.",
    action: "Inspect drainage now. Monitor salinity and pH after rain.",
  },
  temp_low_yellow: {
    key: "weather.alert.temp_low.yellow",
    title: "Low temperature",
    message:
      "Low temperature is expected near {pondName}. Shrimp feeding may decrease. Consider reducing feed by 15–20% and monitor behaviour.",
    action: "Reduce feed 15–20%. Monitor shrimp behaviour.",
  },
  temp_high_orange: {
    key: "weather.alert.temp_high.orange",
    title: "High temperature",
    message:
      "High temperature is expected near {pondName}. Dissolved oxygen may decrease. Increase aeration and monitor shrimp behaviour.",
    action: "Increase aeration. Monitor shrimp behaviour.",
  },
  temp_high_red: {
    key: "weather.alert.temp_high.red",
    title: "Critical heat risk",
    message:
      "Critical heat risk for {pondName}. Increase aeration immediately, monitor dissolved oxygen and avoid unnecessary feeding during peak heat.",
    action: "Increase aeration now. Avoid feeding in peak heat. Watch DO.",
  },
  wind_yellow: {
    key: "weather.alert.wind.yellow",
    title: "Strong winds",
    message:
      "Strong winds are expected near {farmName}. Inspect aerators, electrical connections and loose equipment.",
    action: "Inspect aerators, electrical connections and loose equipment.",
  },
  wind_orange: {
    key: "weather.alert.wind.orange",
    title: "Very strong winds",
    message:
      "Very strong winds are expected near {farmName}. Secure aerators and inspect power lines and electrical infrastructure.",
    action: "Secure aerators. Inspect power lines and electrical gear.",
  },
  pressure_yellow: {
    key: "weather.alert.pressure.yellow",
    title: "Low pressure",
    message:
      "Low-pressure conditions are expected near {pondName}. Dissolved oxygen may decrease before a storm. Operate aerators for longer and observe shrimp behaviour.",
    action: "Run aerators longer. Observe shrimp behaviour.",
  },
  storm_orange: {
    key: "weather.alert.thunderstorm.orange",
    title: "Thunderstorm warning",
    message:
      "Thunderstorm conditions are expected near {farmName}. Inspect electrical systems, aerators and backup power.",
    action: "Inspect electrical systems, aerators and backup power.",
  },
  storm_red: {
    key: "weather.alert.thunderstorm.red",
    title: "Critical thunderstorm warning",
    message:
      "Critical thunderstorm warning for {farmName}. No backup generator is registered. Arrange backup aeration and secure electrical equipment immediately.",
    action: "Arrange backup aeration. Secure electrical equipment now.",
  },
};

function buildAlert(params: {
  alertType: AlertType;
  riskLevel: Exclude<RiskLevel, "green">;
  templateKey: string;
  vars: Record<string, string | number>;
  forecastStart: string;
  forecastEnd: string;
  pond: PondContext | null;
  isFarmLevel: boolean;
  weatherSnapshot: Record<string, unknown>;
}): EvaluatedAlert {
  const template = MESSAGES[params.templateKey];
  const vars = params.vars;
  return {
    alertType: params.alertType,
    riskLevel: params.riskLevel,
    title: template?.title ?? params.templateKey,
    message: fill(template?.message ?? "", vars),
    recommendedAction: fill(template?.action ?? "", vars),
    messageKey: template?.key ?? params.templateKey,
    messageVars: vars,
    forecastStart: params.forecastStart,
    forecastEnd: params.forecastEnd,
    pondId: params.pond?.pondId ?? null,
    cropCycleId: params.pond?.cropCycleId ?? null,
    requiresAcknowledgement: params.riskLevel === "red",
    weatherSnapshot: params.weatherSnapshot,
    pondSnapshot: params.pond
      ? {
          pondId: params.pond.pondId,
          pondName: params.pond.pondName,
          species: params.pond.species,
          cultureDay: params.pond.cultureDay,
          stockingDensity: params.pond.stockingDensity,
          aeratorCount: params.pond.aeratorCount,
          generatorAvailable: params.pond.generatorAvailable,
          reservoirAvailable: params.pond.reservoirAvailable,
          hasActiveCycle: params.pond.hasActiveCycle,
        }
      : null,
    isFarmLevel: params.isFarmLevel,
  };
}

function evaluateRain(
  points24h: HourlyWeatherPoint[],
  pond: PondContext | null,
  farmName: string,
  config: WeatherRiskConfig,
  window: { start: string; end: string },
  weatherSnapshot: Record<string, unknown>,
): EvaluatedAlert | null {
  const rainMm = sumOf(points24h.map((p) => p.rain ?? p.precipitation));
  const maxProb = maxOf(points24h.map((p) => p.precipitation_probability));
  const prolonged =
    prolongedRainHours(points24h) >= config.rain.orangeProlongedHours;

  const vars = {
    farmName,
    pondName: pond?.pondName ?? farmName,
  };
  const snap = { ...weatherSnapshot, rainMm24h: rainMm, maxProb };
  const overflow = pond ? pondOverflowRiskHigh(pond, rainMm) : false;
  const heavyNoReservoir =
    rainMm >= config.rain.orangeRainMm24h &&
    pond?.reservoirAvailable === false;

  // Red: ≥60 mm OR heavy rain without reservoir OR overflow
  if (
    rainMm >= config.rain.redRainMm24h ||
    heavyNoReservoir ||
    overflow
  ) {
    // Pond-scoped red needs active cycle except farm-level ≥60 mm
    const allowFarmRed = rainMm >= config.rain.redRainMm24h;
    if (pond?.hasActiveCycle || allowFarmRed) {
      return buildAlert({
        alertType: "rain",
        riskLevel: "red",
        templateKey: "rain_red",
        vars,
        forecastStart: window.start,
        forecastEnd: window.end,
        pond: pond?.hasActiveCycle ? pond : null,
        isFarmLevel: !pond?.hasActiveCycle,
        weatherSnapshot: snap,
      });
    }
  }

  if (
    rainMm >= config.rain.orangeRainMm24h ||
    ((maxProb ?? 0) >= config.rain.orangeProbabilityPercent && prolonged)
  ) {
    const usePond = Boolean(pond?.hasActiveCycle);
    return buildAlert({
      alertType: "rain",
      riskLevel: "orange",
      templateKey: "rain_orange",
      vars: usePond ? vars : { ...vars, pondName: farmName },
      forecastStart: window.start,
      forecastEnd: window.end,
      pond: usePond ? pond : null,
      isFarmLevel: !usePond,
      weatherSnapshot: snap,
    });
  }

  if (
    (maxProb ?? 0) >= config.rain.yellowProbabilityPercent ||
    rainMm >= config.rain.yellowRainMm24h
  ) {
    return buildAlert({
      alertType: "rain",
      riskLevel: "yellow",
      templateKey: "rain_yellow",
      vars,
      forecastStart: window.start,
      forecastEnd: window.end,
      pond: null,
      isFarmLevel: true,
      weatherSnapshot: snap,
    });
  }

  return null;
}

function evaluateTemperature(
  points24h: HourlyWeatherPoint[],
  daily: DailyWeatherPoint[],
  pond: PondContext,
  config: WeatherRiskConfig,
  window: { start: string; end: string },
  weatherSnapshot: Record<string, unknown>,
): EvaluatedAlert | null {
  if (!pond.hasActiveCycle) return null;

  const minTemp =
    minOf(points24h.map((p) => p.temperature_2m)) ??
    minOf(daily.slice(0, 1).map((d) => d.temperature_2m_min));
  const maxTemp =
    maxOf(points24h.map((p) => p.temperature_2m)) ??
    maxOf(daily.slice(0, 1).map((d) => d.temperature_2m_max));

  const vars = {
    farmName: pond.farmName,
    pondName: pond.pondName,
  };

  const highDensity = isHighDensity(pond, config);
  const lowAeration = aerationInsufficient(pond, config);

  if (
    (maxTemp ?? 0) >= config.temperature.redMaxC &&
    (highDensity || lowAeration)
  ) {
    return buildAlert({
      alertType: "temperature_high",
      riskLevel: "red",
      templateKey: "temp_high_red",
      vars,
      forecastStart: window.start,
      forecastEnd: window.end,
      pond,
      isFarmLevel: false,
      weatherSnapshot: { ...weatherSnapshot, minTemp, maxTemp },
    });
  }

  if ((maxTemp ?? 0) >= config.temperature.orangeMaxC) {
    return buildAlert({
      alertType: "temperature_high",
      riskLevel: "orange",
      templateKey: "temp_high_orange",
      vars,
      forecastStart: window.start,
      forecastEnd: window.end,
      pond,
      isFarmLevel: false,
      weatherSnapshot: { ...weatherSnapshot, minTemp, maxTemp },
    });
  }

  if (minTemp != null && minTemp < config.temperature.yellowMinC) {
    return buildAlert({
      alertType: "temperature_low",
      riskLevel: "yellow",
      templateKey: "temp_low_yellow",
      vars,
      forecastStart: window.start,
      forecastEnd: window.end,
      pond,
      isFarmLevel: false,
      weatherSnapshot: { ...weatherSnapshot, minTemp, maxTemp },
    });
  }

  return null;
}

function evaluateWind(
  points24h: HourlyWeatherPoint[],
  farmName: string,
  config: WeatherRiskConfig,
  window: { start: string; end: string },
  weatherSnapshot: Record<string, unknown>,
): EvaluatedAlert | null {
  const maxSpeed = maxOf(points24h.map((p) => p.wind_speed_10m));
  const maxGust = maxOf(points24h.map((p) => p.wind_gusts_10m));
  const vars = { farmName, pondName: farmName };

  if (
    (maxSpeed ?? 0) >= config.wind.orangeSpeedKmh ||
    (maxGust ?? 0) >= config.wind.orangeGustKmh
  ) {
    return buildAlert({
      alertType: "wind",
      riskLevel: "orange",
      templateKey: "wind_orange",
      vars,
      forecastStart: window.start,
      forecastEnd: window.end,
      pond: null,
      isFarmLevel: true,
      weatherSnapshot: { ...weatherSnapshot, maxSpeed, maxGust },
    });
  }

  if (
    (maxSpeed ?? 0) >= config.wind.yellowSpeedKmh ||
    (maxGust ?? 0) >= config.wind.yellowGustKmh
  ) {
    return buildAlert({
      alertType: "wind",
      riskLevel: "yellow",
      templateKey: "wind_yellow",
      vars,
      forecastStart: window.start,
      forecastEnd: window.end,
      pond: null,
      isFarmLevel: true,
      weatherSnapshot: { ...weatherSnapshot, maxSpeed, maxGust },
    });
  }

  return null;
}

function evaluatePressure(
  points6h: HourlyWeatherPoint[],
  currentPressure: number | null,
  pond: PondContext | null,
  farmName: string,
  config: WeatherRiskConfig,
  window: { start: string; end: string },
  weatherSnapshot: Record<string, unknown>,
): EvaluatedAlert | null {
  const drop = pressureDropHpa(points6h);
  const low =
    (currentPressure != null &&
      currentPressure < config.pressure.yellowBelowHpa) ||
    (drop != null && drop >= config.pressure.rapidDropHpaIn6h);

  if (!low) return null;

  // Prefer pond with active cycle for messaging; else farm-level
  if (pond && !pond.hasActiveCycle) {
    return buildAlert({
      alertType: "pressure",
      riskLevel: "yellow",
      templateKey: "pressure_yellow",
      vars: { farmName, pondName: farmName },
      forecastStart: window.start,
      forecastEnd: window.end,
      pond: null,
      isFarmLevel: true,
      weatherSnapshot: {
        ...weatherSnapshot,
        currentPressure,
        pressureDropHpa: drop,
      },
    });
  }

  return buildAlert({
    alertType: "pressure",
    riskLevel: "yellow",
    templateKey: "pressure_yellow",
    vars: {
      farmName,
      pondName: pond?.pondName ?? farmName,
    },
    forecastStart: window.start,
    forecastEnd: window.end,
    pond: pond?.hasActiveCycle ? pond : null,
    isFarmLevel: !pond?.hasActiveCycle,
    weatherSnapshot: {
      ...weatherSnapshot,
      currentPressure,
      pressureDropHpa: drop,
    },
  });
}

function evaluateThunderstorm(
  points24h: HourlyWeatherPoint[],
  farmName: string,
  generatorAvailable: boolean | null,
  config: WeatherRiskConfig,
  window: { start: string; end: string },
  weatherSnapshot: Record<string, unknown>,
): EvaluatedAlert | null {
  const storm = points24h.some((p) =>
    isThunderstormCode(p.weather_code, config.thunderstormCodes),
  );
  if (!storm) return null;

  const vars = { farmName, pondName: farmName };

  // Red only when generator is explicitly false (missing → orange only)
  if (generatorAvailable === false) {
    return buildAlert({
      alertType: "thunderstorm",
      riskLevel: "red",
      templateKey: "storm_red",
      vars,
      forecastStart: window.start,
      forecastEnd: window.end,
      pond: null,
      isFarmLevel: true,
      weatherSnapshot,
    });
  }

  return buildAlert({
    alertType: "thunderstorm",
    riskLevel: "orange",
    templateKey: "storm_orange",
    vars,
    forecastStart: window.start,
    forecastEnd: window.end,
    pond: null,
    isFarmLevel: true,
    weatherSnapshot,
  });
}

/**
 * Evaluate forecast against farm + pond context.
 * Pond-specific operational alerts require an active crop cycle.
 * Farm-level severe weather (rain yellow, wind, thunderstorm) always allowed.
 */
export function evaluateWeatherRisks(params: {
  forecast: OpenMeteoForecast;
  farmName: string;
  ponds: PondContext[];
  nowIso?: string;
  config?: WeatherRiskConfig;
}): EvaluatedAlert[] {
  const config = params.config ?? WEATHER_RISK_CONFIG;
  const nowIso =
    params.nowIso ??
    params.forecast.current?.time ??
    new Date().toISOString();
  const hourly = flattenHourly(params.forecast);
  const daily = flattenDaily(params.forecast);
  const points24h = next24hPoints(hourly, nowIso);
  const points6h = next6hPoints(hourly, nowIso);
  const window = {
    start: points24h[0]?.time ?? nowIso,
    end:
      points24h[points24h.length - 1]?.time ??
      new Date(Date.parse(nowIso) + 24 * 60 * 60 * 1000).toISOString(),
  };

  const current = params.forecast.current;
  const weatherSnapshot: Record<string, unknown> = {
    condition: weatherCodeToCondition(current?.weather_code ?? null),
    temperatureC: current?.temperature_2m ?? null,
    humidityPercent: current?.relative_humidity_2m ?? null,
    pressureHpa: current?.surface_pressure ?? null,
    windSpeedKmh: current?.wind_speed_10m ?? null,
    windGustKmh: current?.wind_gusts_10m ?? null,
    weatherCode: current?.weather_code ?? null,
  };

  const alerts: EvaluatedAlert[] = [];
  const farmName = params.farmName;

  // Farm-level generator: false if ANY pond explicitly false; null if unknown
  let generatorAvailable: boolean | null = null;
  for (const p of params.ponds) {
    if (p.generatorAvailable === false) {
      generatorAvailable = false;
      break;
    }
    if (p.generatorAvailable === true) {
      generatorAvailable = true;
    }
  }

  // Farm-level alerts (no active cycle required)
  const activePonds = params.ponds.filter((p) => p.hasActiveCycle);

  if (activePonds.length > 0) {
    for (const pond of activePonds) {
      const rain = evaluateRain(
        points24h,
        pond,
        farmName,
        config,
        window,
        weatherSnapshot,
      );
      if (rain) alerts.push(rain);
    }
  } else {
    const rainFarm = evaluateRain(
      points24h,
      null,
      farmName,
      config,
      window,
      weatherSnapshot,
    );
    if (rainFarm) alerts.push(rainFarm);
  }

  const wind = evaluateWind(
    points24h,
    farmName,
    config,
    window,
    weatherSnapshot,
  );
  if (wind) alerts.push(wind);

  const storm = evaluateThunderstorm(
    points24h,
    farmName,
    generatorAvailable,
    config,
    window,
    weatherSnapshot,
  );
  if (storm) alerts.push(storm);

  // Pond-specific: temperature (active cycles only) + pressure
  const pressureTargets =
    activePonds.length > 0 ? activePonds : params.ponds.slice(0, 1);

  for (const pond of activePonds) {
    const temp = evaluateTemperature(
      points24h,
      daily,
      pond,
      config,
      window,
      weatherSnapshot,
    );
    if (temp) alerts.push(temp);
  }

  for (const pond of pressureTargets) {
    const pressure = evaluatePressure(
      points6h,
      num(current?.surface_pressure),
      pond,
      farmName,
      config,
      {
        start: points6h[0]?.time ?? nowIso,
        end:
          points6h[points6h.length - 1]?.time ??
          new Date(Date.parse(nowIso) + 6 * 60 * 60 * 1000).toISOString(),
      },
      weatherSnapshot,
    );
    if (pressure) {
      alerts.push(pressure);
      break;
    }
  }

  return dedupeEvaluatedAlerts(alerts);
}

/** Keep highest risk per alertType + pondId. */
export function dedupeEvaluatedAlerts(
  alerts: EvaluatedAlert[],
): EvaluatedAlert[] {
  const map = new Map<string, EvaluatedAlert>();
  for (const alert of alerts) {
    const key = `${alert.alertType}:${alert.pondId ?? "farm"}`;
    const existing = map.get(key);
    if (!existing || riskRank(alert.riskLevel) > riskRank(existing.riskLevel)) {
      map.set(key, alert);
    }
  }
  return [...map.values()];
}

/** Stable six-hour forecast-event window; provider timestamp revisions do not alter it. */
export function weatherEventKey(
  candidate: Pick<EvaluatedAlert, "alertType" | "forecastStart" | "forecastEnd">,
): string {
  const window = (value: string) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Date(Math.round(date.getTime() / (6 * 60 * 60 * 1000)) * 6 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 13)
      : value.slice(0, 10);
  };
  return `${candidate.alertType}:${window(candidate.forecastStart)}:${window(candidate.forecastEnd)}`;
}

export type ExistingAlert = {
  id: string;
  farmer_id: string;
  farm_id: string;
  pond_id: string | null;
  alert_type: string;
  risk_level: RiskLevel;
  forecast_start: string | null;
  forecast_end: string | null;
  status: string;
  last_notified_at: string | null;
  created_at: string;
  expires_at: string | null;
};

export type DedupeDecision =
  | { action: "create"; shouldPush: boolean }
  | { action: "escalate"; existingId: string; shouldPush: boolean }
  | { action: "skip"; reason: string }
  | {
      action: "downgrade";
      existingId: string;
      shouldPush: false;
      newLevel: RiskLevel;
    };

function sameForecastWindow(
  aStart: string | null,
  aEnd: string | null,
  bStart: string,
  bEnd: string,
  toleranceMs = 2 * 60 * 60 * 1000,
): boolean {
  if (!aStart || !aEnd) return false;
  const as = Date.parse(aStart);
  const ae = Date.parse(aEnd);
  const bs = Date.parse(bStart);
  const be = Date.parse(bEnd);
  if (![as, ae, bs, be].every(Number.isFinite)) return false;
  return Math.abs(as - bs) <= toleranceMs && Math.abs(ae - be) <= toleranceMs;
}

/**
 * Decide whether to create / escalate / skip push for a candidate alert.
 */
export function decideAlertDedupe(params: {
  candidate: EvaluatedAlert;
  existing: ExistingAlert[];
  nowIso?: string;
  config?: WeatherRiskConfig;
}): DedupeDecision {
  const now = Date.parse(params.nowIso ?? new Date().toISOString());

  const matches = params.existing.filter((e) => {
    if (e.alert_type !== params.candidate.alertType) return false;
    if ((e.pond_id ?? null) !== (params.candidate.pondId ?? null)) return false;
    if (!["active", "read", "acknowledged"].includes(e.status)) return false;
    if (e.expires_at && Date.parse(e.expires_at) < now) return false;
    return sameForecastWindow(
      e.forecast_start,
      e.forecast_end,
      params.candidate.forecastStart,
      params.candidate.forecastEnd,
    );
  });

  if (matches.length === 0) {
    return { action: "create", shouldPush: params.candidate.riskLevel !== "green" };
  }

  const best = matches.reduce((a, b) =>
    riskRank(a.risk_level) >= riskRank(b.risk_level) ? a : b,
  );

  if (riskRank(params.candidate.riskLevel) > riskRank(best.risk_level)) {
    return {
      action: "escalate",
      existingId: best.id,
      shouldPush: true,
    };
  }

  if (riskRank(params.candidate.riskLevel) < riskRank(best.risk_level)) {
    return {
      action: "downgrade",
      existingId: best.id,
      shouldPush: false,
      newLevel: params.candidate.riskLevel,
    };
  }

  // Same risk — check resend window
  // A permanent database dispatch claim, rather than a time window, controls
  // delivery. Reading/acknowledging or a later scheduler run cannot resend.
  return { action: "skip", reason: "identical_active_alert" };
}

export function isWithinQuietHours(
  now: Date,
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
): boolean {
  if (!quietStart || !quietEnd) return false;
  const [sh, sm] = quietStart.split(":").map(Number);
  const [eh, em] = quietEnd.split(":").map(Number);
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return false;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (start === end) return false;
  if (start < end) {
    return minutes >= start && minutes < end;
  }
  // Wraps midnight
  return minutes >= start || minutes < end;
}

export function shouldSendPush(params: {
  riskLevel: RiskLevel;
  preferences: {
    weather_alerts_enabled: boolean;
    yellow_push_enabled: boolean;
    orange_push_enabled: boolean;
    red_push_enabled: boolean;
    quiet_hours_start?: string | null;
    quiet_hours_end?: string | null;
  };
  now?: Date;
  riskIncreased?: boolean;
}): boolean {
  const prefs = params.preferences;
  if (!prefs.weather_alerts_enabled) return false;

  if (params.riskLevel === "green") return false;
  if (params.riskLevel === "yellow" && !prefs.yellow_push_enabled) return false;
  if (params.riskLevel === "orange" && !prefs.orange_push_enabled) return false;
  if (params.riskLevel === "red" && !prefs.red_push_enabled) return false;

  const now = params.now ?? new Date();
  const inQuiet = isWithinQuietHours(
    now,
    prefs.quiet_hours_start,
    prefs.quiet_hours_end,
  );

  if (!inQuiet) return true;

  // Red always bypasses quiet hours
  if (params.riskLevel === "red") return true;
  // Orange sends immediately (bypass quiet hours per channel rules)
  if (params.riskLevel === "orange") return true;
  // Yellow respects quiet hours unless risk increased
  if (params.riskLevel === "yellow") {
    return Boolean(params.riskIncreased);
  }

  return false;
}

export function androidChannelForRisk(level: RiskLevel): string {
  if (level === "red") return "weather-critical";
  if (level === "orange") return "weather-warning";
  return "weather-general";
}

export function pushPriorityForRisk(
  level: RiskLevel,
): "default" | "high" {
  return level === "orange" || level === "red" ? "high" : "default";
}
