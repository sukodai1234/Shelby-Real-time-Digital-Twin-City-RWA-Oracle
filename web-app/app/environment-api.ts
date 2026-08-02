import { BsiReading } from "./bsi-engine";

const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const READING_CACHE_TTL_MS = 10 * 60 * 1000;
const readingCache = new Map<string, { savedAt: number; reading: BsiReading }>();

/** Fetches one live environmental reading used by both the location card and journey samples. */
export async function fetchLiveEnvironmentalReading(lat: number, lon: number, signal?: AbortSignal): Promise<BsiReading> {
  const latitude = lat.toFixed(4);
  const longitude = lon.toFixed(4);
  const cacheKey = `${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const cached = readingCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < READING_CACHE_TTL_MS) return cached.reading;
  const requestOptions = signal ? { signal } : undefined;
  const [weatherResponse, airResponse] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=relative_humidity_2m,temperature_2m,apparent_temperature,precipitation,wind_speed_10m&timezone=auto`, requestOptions),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi,pm2_5,uv_index,nitrogen_dioxide,sea_salt_aerosol,us_aqi_ozone,us_aqi_sulphur_dioxide,us_aqi_carbon_monoxide&timezone=auto`, requestOptions),
  ]);
  if (!weatherResponse.ok || !airResponse.ok) throw new Error("Environmental source unavailable");

  const weather = await weatherResponse.json();
  const air = await airResponse.json();
  const pollutantValues = [air.current?.us_aqi_ozone, air.current?.us_aqi_sulphur_dioxide, air.current?.us_aqi_carbon_monoxide]
    .map(numeric)
    .filter((value): value is number => value !== null);

  const reading: BsiReading = {
    humidity: numeric(weather.current?.relative_humidity_2m),
    temperature: numeric(weather.current?.temperature_2m),
    apparentTemperature: numeric(weather.current?.apparent_temperature),
    precipitation: numeric(weather.current?.precipitation),
    windKmh: numeric(weather.current?.wind_speed_10m),
    windMaxKmh: numeric(weather.current?.wind_speed_10m),
    aqi: numeric(air.current?.us_aqi),
    pm25: numeric(air.current?.pm2_5),
    uv: numeric(air.current?.uv_index),
    no2: numeric(air.current?.nitrogen_dioxide),
    seaSalt: numeric(air.current?.sea_salt_aerosol),
    otherPollutantAqi: pollutantValues.length ? Math.max(...pollutantValues) : null,
    observedAt: weather.current?.time ?? new Date().toISOString(),
  };
  readingCache.set(cacheKey, { savedAt: Date.now(), reading });
  return reading;
}
