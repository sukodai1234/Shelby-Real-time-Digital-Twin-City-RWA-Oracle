export type ComponentName = "pm25" | "exposure" | "rainHumidity" | "salt" | "wind" | "other";

export type BsiReading = {
  humidity: number | null;
  temperature: number | null;
  apparentTemperature: number | null;
  precipitation: number | null;
  windKmh: number | null;
  windMaxKmh?: number | null;
  aqi: number | null;
  pm25: number | null;
  uv: number | null;
  no2: number | null;
  seaSalt: number | null;
  otherPollutantAqi: number | null;
  observedAt: string;
};

export type BsiResult = {
  score: number | null;
  confidence: number;
  components: Record<ComponentName, number | null>;
};

export const BSI_WEIGHTS: Record<ComponentName, number> = {
  pm25: 0.22,
  exposure: 0.17,
  rainHumidity: 0.22,
  salt: 0.05,
  wind: 0.17,
  other: 0.17,
};

export const EMPTY_BSI_READING: BsiReading = {
  humidity: null,
  temperature: null,
  apparentTemperature: null,
  precipitation: null,
  windKmh: null,
  windMaxKmh: null,
  aqi: null,
  pm25: null,
  uv: null,
  no2: null,
  seaSalt: null,
  otherPollutantAqi: null,
  observedAt: "—",
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const uvRisk = (uv: number) => uv >= 11 ? 100 : uv >= 9 ? 80 : uv >= 6 ? 50 : 10;
const heatRisk = (temperature: number) => temperature >= 42 ? 100 : temperature >= 38 ? 75 : temperature >= 32 ? 40 : 10;
const no2Risk = (no2: number) => no2 < 40 ? 10 : no2 >= 100 ? 100 : Math.round(10 + (no2 - 40) * 1.5);

/** Shared BSI v2.2 engine for both live readings and daily history aggregates. */
export function calculateBsi(reading: BsiReading): BsiResult {
  const exposure = reading.uv === null || reading.apparentTemperature === null || reading.no2 === null
    ? null
    : Math.round(uvRisk(reading.uv) * 0.4 + heatRisk(reading.apparentTemperature) * 0.4 + no2Risk(reading.no2) * 0.2);

  let rainHumidity = reading.precipitation === null || reading.humidity === null ? null : 10;
  if (rainHumidity !== null) {
    if (reading.precipitation >= 30) rainHumidity = 100;
    else if (reading.humidity < 25) rainHumidity = 85;
    else if (reading.precipitation >= 10) rainHumidity = 70;
    else if (reading.precipitation >= 2) rainHumidity = 35;
  }

  const windMaxKmh = reading.windMaxKmh ?? reading.windKmh;
  const windRisk = reading.windKmh === null || windMaxKmh === null
    ? null
    : reading.windKmh / 3.6 < 0.8 || windMaxKmh / 3.6 > 15 ? 80 : 10;

  const components: Record<ComponentName, number | null> = {
    pm25: reading.pm25 === null ? null : Math.round(clamp(reading.pm25 * 2.8)),
    exposure,
    rainHumidity,
    salt: reading.seaSalt === null ? null : Math.round(clamp(reading.seaSalt * 4)),
    wind: windRisk,
    other: reading.otherPollutantAqi === null ? null : Math.round(clamp(reading.otherPollutantAqi)),
  };

  const componentKeys = Object.keys(BSI_WEIGHTS) as ComponentName[];
  const availableWeight = componentKeys.reduce(
    (sum, key) => sum + (components[key] === null ? 0 : BSI_WEIGHTS[key]),
    0,
  );
  if (!availableWeight) return { score: null, confidence: 0, components };

  const score = Math.round(componentKeys.reduce(
    (sum, key) => sum + (components[key] === null ? 0 : components[key] * BSI_WEIGHTS[key]),
    0,
  ) / availableWeight);

  return {
    score: Math.max(1, score),
    confidence: Math.round(availableWeight * 100),
    components,
  };
}
