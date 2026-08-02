"use client";

import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import { BsiReading, calculateBsi } from "./bsi-engine";

type Language = "en" | "vi" | "zh";
export type HistoryLocation = { name: string; country: string; lat: number; lon: number };
type HistoryPoint = { date: string; bsi: number | null; confidence: number };
type HistorySeries = { location: HistoryLocation; points: HistoryPoint[] };
type HourlyPayload = { time?: string[]; [key: string]: unknown };
type ApiPayload = { hourly?: HourlyPayload; error?: boolean; reason?: string };

const CACHE_PREFIX = "shelby_bsi_history_v22_";
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const COMPARISON_STORAGE_KEY = "shelby_bsi_comparison_locations";
const SERIES_COLORS = ["#56f2bb", "#54a7ff", "#ff9566"];

const copy = {
  en: {
    kicker: "LOCATION DECISION TOOL", title: "BSI history and comparison", intro: "Compare the previous 7 or 30 complete days for up to three locations. Every day is calculated by the same BSI v2.2 engine as the live score.",
    seven: "7 DAYS", thirty: "30 DAYS", search: "Add a city to compare", add: "ADD", placeholder: "Singapore, London…", current: "CURRENT", remove: "REMOVE",
    loading: "BUILDING BSI HISTORY", error: "Historical data is unavailable for one or more locations. Try again shortly.", noData: "No comparable historical readings were returned.",
    maximum: "Maximum three locations", duplicate: "This location is already on the chart", average: "AVG", latest: "LATEST", confidence: "DATA", chartLabel: "BSI comparison line chart",
    note: "Daily BSI uses mean humidity and wind, peak hourly rain, apparent temperature and UV, plus CAMS air-quality values. Cache is stored on this device for three hours.",
  },
  vi: {
    kicker: "CÔNG CỤ RA QUYẾT ĐỊNH ĐỊA ĐIỂM", title: "Lịch sử và so sánh BSI", intro: "So sánh 7 hoặc 30 ngày hoàn chỉnh gần nhất của tối đa ba địa điểm. Mỗi ngày dùng đúng công thức BSI v2.2 của chỉ số trực tiếp.",
    seven: "7 NGÀY", thirty: "30 NGÀY", search: "Thêm thành phố để so sánh", add: "THÊM", placeholder: "Singapore, London…", current: "HIỆN TẠI", remove: "XÓA",
    loading: "ĐANG TẠO LỊCH SỬ BSI", error: "Không thể lấy đủ dữ liệu lịch sử cho một hoặc nhiều địa điểm. Hãy thử lại sau.", noData: "Không có dữ liệu lịch sử đủ để so sánh.",
    maximum: "Tối đa ba địa điểm", duplicate: "Địa điểm này đã có trên biểu đồ", average: "TB", latest: "MỚI NHẤT", confidence: "DỮ LIỆU", chartLabel: "Biểu đồ đường so sánh BSI",
    note: "BSI ngày dùng độ ẩm và gió trung bình, mưa cực đại theo giờ, nhiệt độ cảm nhận và UV cao nhất, cùng dữ liệu không khí CAMS. Cache chỉ lưu trên thiết bị trong ba giờ.",
  },
  zh: {
    kicker: "地点决策工具", title: "BSI 历史与地点比较", intro: "比较最多三个地点最近 7 天或 30 天的完整数据。每日分数使用与实时 BSI 相同的 v2.2 计算引擎。",
    seven: "7 天", thirty: "30 天", search: "添加城市进行比较", add: "添加", placeholder: "新加坡、伦敦…", current: "当前位置", remove: "移除",
    loading: "正在生成 BSI 历史", error: "一个或多个地点的历史数据暂不可用，请稍后重试。", noData: "没有足够的历史数据可供比较。",
    maximum: "最多三个地点", duplicate: "该地点已在图表中", average: "平均", latest: "最新", confidence: "数据", chartLabel: "BSI 地点比较折线图",
    note: "每日 BSI 使用平均湿度和风速、每小时最大降雨、最高体感温度和 UV，以及 CAMS 空气质量数据。缓存仅在本设备保存三小时。",
  },
} as const;

function cacheKey(location: HistoryLocation, days: 7 | 30) {
  return `${CACHE_PREFIX}${location.lat.toFixed(3)}_${location.lon.toFixed(3)}_${days}d`;
}

function readCache(key: string): HistoryPoint[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: HistoryPoint[] };
    if (!parsed.savedAt || !Array.isArray(parsed.data) || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch { return null; }
}

function writeCache(key: string, data: HistoryPoint[]) {
  try { window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* Cache is optional. */ }
}

function valuesForDate(hourly: HourlyPayload | undefined, key: string, date: string): number[] {
  const times = hourly?.time;
  const values = hourly?.[key];
  if (!Array.isArray(times) || !Array.isArray(values)) return [];
  return times.reduce<number[]>((result, timestamp, index) => {
    const value = values[index];
    if (typeof timestamp === "string" && timestamp.startsWith(date) && typeof value === "number" && Number.isFinite(value)) result.push(value);
    return result;
  }, []);
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const maximum = (values: number[]) => values.length ? Math.max(...values) : null;

async function fetchHistory(location: HistoryLocation, days: 7 | 30, signal: AbortSignal): Promise<HistoryPoint[]> {
  const key = cacheKey(location, days);
  const cached = readCache(key);
  if (cached) return cached;

  const coordinates = `latitude=${location.lat.toFixed(4)}&longitude=${location.lon.toFixed(4)}`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?${coordinates}&past_days=${days}&forecast_days=0&hourly=relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m&timezone=auto`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?${coordinates}&past_days=${days}&forecast_days=0&hourly=pm2_5,uv_index,nitrogen_dioxide,sea_salt_aerosol,us_aqi_ozone,us_aqi_sulphur_dioxide,us_aqi_carbon_monoxide&timezone=auto`;

  const [weatherResponse, airResponse] = await Promise.all([
    fetch(weatherUrl, { signal }),
    fetch(airUrl, { signal }),
  ]);
  if (!weatherResponse.ok || !airResponse.ok) throw new Error("Historical source unavailable");
  const weather = await weatherResponse.json() as ApiPayload;
  const air = await airResponse.json() as ApiPayload;
  if (weather.error || air.error) throw new Error(weather.reason || air.reason || "Historical source unavailable");

  const weatherTimes = weather.hourly?.time ?? [];
  const dates = [...new Set(weatherTimes.map((time) => time.slice(0, 10)))].slice(-days);
  const points = dates.map((date): HistoryPoint => {
    const humidity = mean(valuesForDate(weather.hourly, "relative_humidity_2m", date));
    const apparentTemperature = maximum(valuesForDate(weather.hourly, "apparent_temperature", date));
    const precipitation = maximum(valuesForDate(weather.hourly, "precipitation", date));
    const winds = valuesForDate(weather.hourly, "wind_speed_10m", date);
    const pollutantAqi = [
      ...valuesForDate(air.hourly, "us_aqi_ozone", date),
      ...valuesForDate(air.hourly, "us_aqi_sulphur_dioxide", date),
      ...valuesForDate(air.hourly, "us_aqi_carbon_monoxide", date),
    ];
    const reading: BsiReading = {
      humidity,
      temperature: null,
      apparentTemperature,
      precipitation,
      windKmh: mean(winds),
      windMaxKmh: maximum(winds),
      aqi: null,
      pm25: mean(valuesForDate(air.hourly, "pm2_5", date)),
      uv: maximum(valuesForDate(air.hourly, "uv_index", date)),
      no2: mean(valuesForDate(air.hourly, "nitrogen_dioxide", date)),
      seaSalt: mean(valuesForDate(air.hourly, "sea_salt_aerosol", date)),
      otherPollutantAqi: maximum(pollutantAqi),
      observedAt: date,
    };
    const result = calculateBsi(reading);
    return { date, bsi: result.score, confidence: result.confidence };
  });

  writeCache(key, points);
  return points;
}

function locationId(location: HistoryLocation) {
  return `${location.lat.toFixed(3)}:${location.lon.toFixed(3)}`;
}

function BsiLineChart({ series, label }: { series: HistorySeries[]; label: string }) {
  const width = 900;
  const height = 310;
  const padding = { top: 20, right: 22, bottom: 38, left: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const dates = series[0]?.points.map((point) => point.date) ?? [];
  const x = (index: number) => padding.left + (index / Math.max(1, dates.length - 1)) * chartWidth;
  const y = (score: number) => padding.top + chartHeight - (score / 100) * chartHeight;
  const dateIndexes = dates.length ? [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])] : [];

  return (
    <div className="historyChartScroll">
      <svg className="historyChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <rect x={padding.left} y={y(30)} width={chartWidth} height={y(0) - y(30)} fill="rgba(86,242,187,.035)" />
        <rect x={padding.left} y={y(50)} width={chartWidth} height={y(30) - y(50)} fill="rgba(255,209,102,.035)" />
        <rect x={padding.left} y={y(75)} width={chartWidth} height={y(50) - y(75)} fill="rgba(255,149,102,.04)" />
        <rect x={padding.left} y={y(100)} width={chartWidth} height={y(75) - y(100)} fill="rgba(255,107,122,.045)" />
        {[0, 25, 50, 75, 100].map((value) => <g key={value}><line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} stroke="rgba(149,201,185,.14)" /><text x="7" y={y(value) + 4} fill="#58736b" fontSize="10" fontFamily="monospace">{value}</text></g>)}
        {series.map((item, seriesIndex) => {
          const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
          const validPoints = item.points.map((point, index) => ({ ...point, index })).filter((point) => point.bsi !== null);
          const points = validPoints.map((point) => `${x(point.index)},${y(point.bsi as number)}`).join(" ");
          return <g key={locationId(item.location)}><polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{validPoints.map((point) => <circle key={point.date} cx={x(point.index)} cy={y(point.bsi as number)} r="3.5" fill="#071515" stroke={color} strokeWidth="2"><title>{item.location.name} · {point.date} · BSI {point.bsi} · {point.confidence}%</title></circle>)}</g>;
        })}
        {dateIndexes.map((index) => <text key={index} x={x(index)} y={height - 10} textAnchor={index === 0 ? "start" : index === dates.length - 1 ? "end" : "middle"} fill="#58736b" fontSize="10" fontFamily="monospace">{dates[index]?.slice(5)}</text>)}
      </svg>
    </div>
  );
}

export default function BsiHistory({ primaryLocation, language }: { primaryLocation: HistoryLocation; language: Language }) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState<7 | 30>(7);
  const [comparisons, setComparisons] = useState<HistoryLocation[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [series, setSeries] = useState<HistorySeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const t = copy[language];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(COMPARISON_STORAGE_KEY) ?? "[]") as HistoryLocation[];
        if (Array.isArray(saved)) setComparisons(saved.filter((item) => typeof item?.lat === "number" && typeof item?.lon === "number").slice(0, 2));
      } catch { /* Comparison choices are optional. */ }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try { window.localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(comparisons)); } catch { /* Device storage is optional. */ }
  }, [comparisons, storageReady]);

  const locations = useMemo(() => {
    const primaryId = locationId(primaryLocation);
    return [primaryLocation, ...comparisons.filter((item) => locationId(item) !== primaryId)].slice(0, 3);
  }, [primaryLocation, comparisons]);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(false);
      try {
        const nextSeries = await Promise.all(locations.map(async (location) => ({ location, points: await fetchHistory(location, days, controller.signal) })));
        setSeries(nextSeries);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") { setSeries([]); setError(true); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    load();
    return () => controller.abort();
  }, [days, expanded, locations]);

  async function addComparison(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2 || searching) return;
    if (locations.length >= 3) { setSearchMessage(t.maximum); return; }
    setSearching(true); setSearchMessage("");
    try {
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=1&language=${language}&format=json`);
      if (!response.ok) throw new Error("Search unavailable");
      const payload = await response.json();
      const result = payload.results?.[0];
      if (!result) throw new Error("No result");
      const next: HistoryLocation = { name: result.name, country: result.country ?? result.country_code ?? "", lat: result.latitude, lon: result.longitude };
      if (locations.some((item) => locationId(item) === locationId(next))) setSearchMessage(t.duplicate);
      else { setComparisons((current) => [...current, next].slice(0, 2)); setQuery(""); }
    } catch { setSearchMessage(t.error); }
    finally { setSearching(false); }
  }

  return (
    <details className="historyDetails" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary><div><span>{t.kicker}</span><strong>{t.title}</strong></div><span aria-hidden="true">＋</span></summary>
      <section className="historyPanel" aria-busy={loading}>
        <header className="historyHeader"><p>{t.intro}</p><div className="historyPeriod" role="group" aria-label={t.title}><button className={days === 7 ? "active" : ""} aria-pressed={days === 7} onClick={() => setDays(7)}>{t.seven}</button><button className={days === 30 ? "active" : ""} aria-pressed={days === 30} onClick={() => setDays(30)}>{t.thirty}</button></div></header>
        <div className="historyLocations">
          {locations.map((location, index) => <div key={locationId(location)} style={{ "--series-color": SERIES_COLORS[index] } as CSSProperties}><span /><div><strong>{location.name}</strong><small>{location.country} · {index === 0 ? t.current : `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`}</small></div>{index > 0 && <button type="button" aria-label={`${t.remove} ${location.name}`} onClick={() => setComparisons((current) => current.filter((item) => locationId(item) !== locationId(location)))}>×</button>}</div>)}
        </div>
        <form className="historySearch" onSubmit={addComparison}><label htmlFor="history-city-query">{t.search}</label><div><input id="history-city-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.placeholder} disabled={locations.length >= 3} /><button type="submit" disabled={searching || locations.length >= 3}>{searching ? "…" : t.add}</button></div>{searchMessage && <small>{searchMessage}</small>}</form>
        {loading ? <div className="historyState"><span className="pulse" />{t.loading}</div> : error ? <div className="historyState error">{t.error}</div> : !series.some((item) => item.points.some((point) => point.bsi !== null)) ? <div className="historyState">{t.noData}</div> : (
          <><div className="historyLegend">{series.map((item, index) => {
            const valid = item.points.filter((point) => point.bsi !== null);
            const average = valid.length ? Math.round(valid.reduce((sum, point) => sum + (point.bsi ?? 0), 0) / valid.length) : "—";
            const latest = valid.at(-1)?.bsi ?? "—";
            const confidence = valid.length ? Math.round(valid.reduce((sum, point) => sum + point.confidence, 0) / valid.length) : 0;
            return <div key={locationId(item.location)}><span style={{ background: SERIES_COLORS[index] }} /><strong>{item.location.name}</strong><small>{t.latest} {latest} · {t.average} {average} · {t.confidence} {confidence}%</small></div>;
          })}</div><BsiLineChart series={series} label={t.chartLabel} /></>
        )}
        <footer>{t.note} <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">OPEN-METEO / CAMS ↗</a></footer>
      </section>
    </details>
  );
}
