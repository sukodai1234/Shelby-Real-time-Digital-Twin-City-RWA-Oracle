"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BSI_WEIGHTS, BsiReading, calculateBsi, EMPTY_BSI_READING } from "./bsi-engine";
import BsiHistory from "./bsi-history";
import { fetchLiveEnvironmentalReading } from "./environment-api";
import ExposureJourney from "./exposure-journey";
import ExposureReport from "./exposure-report";
import { LOW_POWER_LOCATION_OPTIONS, readCachedDeviceLocation, saveCachedDeviceLocation } from "./location-power";
import PersonalizedBsiAlert from "./personalized-bsi";

type Language = "en" | "vi" | "zh";
type Location = { name: string; country: string; lat: number; lon: number; region: string };
export type LocationUpdate =
  | { status: "locating" | "denied" | "unavailable" }
  | { status: "resolved"; location: Location; source: "gps" | "search" | "preset" };
type Severity = "safe" | "watch" | "high" | "danger" | "missing";

const places: Location[] = [
  { name: "Ho Chi Minh City", country: "Vietnam", lat: 10.8231, lon: 106.6297, region: "ASIA" },
  { name: "Singapore", country: "Singapore", lat: 1.3521, lon: 103.8198, region: "ASIA" },
  { name: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503, region: "ASIA" },
  { name: "Dubai", country: "UAE", lat: 25.2048, lon: 55.2708, region: "MIDDLE EAST" },
  { name: "London", country: "United Kingdom", lat: 51.5072, lon: -0.1276, region: "EUROPE" },
  { name: "New York", country: "United States", lat: 40.7128, lon: -74.006, region: "N. AMERICA" },
  { name: "São Paulo", country: "Brazil", lat: -23.5558, lon: -46.6396, region: "S. AMERICA" },
  { name: "Cape Town", country: "South Africa", lat: -33.9249, lon: 18.4241, region: "AFRICA" },
  { name: "Sydney", country: "Australia", lat: -33.8688, lon: 151.2093, region: "OCEANIA" },
];

const words = {
  en: {
    kicker: "LIVE BIO-SENSORY REFERENCE", title: "Is this area right for you today?",
    intro: "We use your current location and trusted environmental sources to turn local conditions into one clear health warning and a practical next step.",
    search: "Search any city", searchButton: "SEARCH", loading: "SYNCING LIVE SOURCES", error: "Live source unavailable — select another location or try again.",
    useLocation: "USE MY LOCATION", locating: "LOCATING DEVICE", gps: "DEVICE GPS", gpsHelp: "LOW-POWER LOCATION · RECENT FIX REUSED FOR 30 MIN",
    labels: { pm25: "FINE PARTICLES", exposure: "EXOGENOUS EXPOSURE", rainHumidity: "RAIN + HUMIDITY", salt: "SEA-SALT AEROSOL", wind: "WIND EXPOSURE", other: "OTHER POLLUTANTS" },
    details: { pm25: "PM2.5 × 2.8", exposure: "UV · HEAT · NO₂", rainHumidity: "FLOOD / DROUGHT", salt: "CAMS MODEL", wind: "10 M ABOVE GROUND", other: "O₃ · SO₂ · CO" },
    oracle: "SHELBY ORACLE ENVELOPE", bsi: "BIO-SENSORY INDEX", source: "LIVE MODEL SOURCES", ready: "READY FOR HASH + SHELBY SNAPSHOT",
    confidence: "DATA CONFIDENCE", healthFit: "HEALTH SUITABILITY", updated: "SOURCE TIME", hash: "CONTEXT HASH", result: "result",
    range: "RISK RANGE", verifyKicker: "LIVE BSI + SOURCE PROOF", verifyDetails: "View environmental details + data verification", levels: { safe: "LOW", watch: "CAUTION", high: "HIGH", danger: "DANGER", missing: "NO DATA" },
    note: "Live model data, not an on-site sensor or medical diagnosis. Higher BSI means greater potential health danger. Missing variables are shown and their weights are redistributed; no value is silently invented.",
    attribution: "Weather · Open-Meteo  |  Air, PM2.5 and sea salt · CAMS via Open-Meteo",
  },
  vi: {
    kicker: "CẢM QUAN SINH HỌC TRỰC TIẾP", title: "Hôm nay, khu vực này có phù hợp với bạn?",
    intro: "Hệ thống dùng vị trí hiện tại và nguồn dữ liệu môi trường uy tín để đưa ra một cảnh báo sức khỏe dễ hiểu cùng hành động thiết thực.",
    search: "Tìm thành phố bất kỳ", searchButton: "TÌM KIẾM", loading: "ĐANG ĐỒNG BỘ NGUỒN TRỰC TIẾP", error: "Nguồn trực tiếp tạm thời không khả dụng — hãy thử địa điểm khác.",
    useLocation: "DÙNG VỊ TRÍ CỦA TÔI", locating: "ĐANG ĐỊNH VỊ THIẾT BỊ", gps: "GPS THIẾT BỊ", gpsHelp: "ĐỊNH VỊ TIẾT KIỆM PIN · DÙNG LẠI VỊ TRÍ TRONG 30 PHÚT",
    labels: { pm25: "BỤI MỊN", exposure: "PHƠI NHIỄM NGOẠI SINH", rainHumidity: "MƯA + ĐỘ ẨM", salt: "AEROSOL MUỐI BIỂN", wind: "PHƠI NHIỄM GIÓ", other: "KHÍ Ô NHIỄM KHÁC" },
    details: { pm25: "PM2.5 × 2,8", exposure: "UV · NHIỆT · NO₂", rainHumidity: "NGẬP / HẠN", salt: "MÔ HÌNH CAMS", wind: "CAO 10 M", other: "O₃ · SO₂ · CO" },
    oracle: "GÓI DỮ LIỆU ORACLE SHELBY", bsi: "CHỈ SỐ CẢM QUAN SINH HỌC", source: "NGUỒN MÔ HÌNH TRỰC TIẾP", ready: "SẴN SÀNG HASH + LƯU SNAPSHOT SHELBY",
    confidence: "ĐỘ TIN CẬY DỮ LIỆU", healthFit: "ĐỘ PHÙ HỢP SỨC KHỎE", updated: "THỜI GIAN NGUỒN", hash: "MÃ BỐI CẢNH", result: "kết quả",
    range: "PHẠM VI NGUY CƠ", verifyKicker: "BSI TRỰC TIẾP + BẰNG CHỨNG NGUỒN", verifyDetails: "Xem chỉ số môi trường + cách dữ liệu được xác thực", levels: { safe: "THẤP", watch: "THẬN TRỌNG", high: "CAO", danger: "NGUY HIỂM", missing: "THIẾU DỮ LIỆU" },
    note: "Dữ liệu mô hình trực tiếp, không phải cảm biến tại chỗ hoặc chẩn đoán y khoa. BSI càng cao thì nguy cơ sức khỏe tiềm năng càng lớn. Biến bị thiếu được công khai và phân bổ lại trọng số; hệ thống không âm thầm bịa giá trị.",
    attribution: "Thời tiết · Open-Meteo  |  Không khí, PM2.5 và muối biển · CAMS qua Open-Meteo",
  },
  zh: {
    kicker: "实时生物感知参考", title: "今天，这个区域适合您吗？",
    intro: "系统使用您的当前位置与可信环境数据源，提供清晰的健康警报和可执行建议。",
    search: "搜索任意城市", searchButton: "搜索", loading: "正在同步实时数据", error: "实时数据源暂不可用，请选择其他地点或重试。",
    useLocation: "使用我的位置", locating: "正在定位设备", gps: "设备 GPS", gpsHelp: "低功耗定位 · 30 分钟内复用最近位置",
    labels: { pm25: "细颗粒物", exposure: "外源暴露", rainHumidity: "降雨 + 湿度", salt: "海盐气溶胶", wind: "风暴露", other: "其他污染物" },
    details: { pm25: "PM2.5 × 2.8", exposure: "UV · 热 · NO₂", rainHumidity: "洪水 / 干旱", salt: "CAMS 模型", wind: "地面以上 10 米", other: "O₃ · SO₂ · CO" },
    oracle: "SHELBY 预言机数据包", bsi: "生物感知指数", source: "实时模型来源", ready: "可生成哈希并保存 SHELBY 快照",
    confidence: "数据置信度", healthFit: "健康适宜度", updated: "数据时间", hash: "环境哈希", result: "结果",
    range: "风险范围", verifyKicker: "实时 BSI + 数据源证明", verifyDetails: "查看环境指标与数据验证方式", levels: { safe: "低", watch: "注意", high: "高", danger: "危险", missing: "无数据" },
    note: "这是实时模型数据，不是现场传感器或医疗诊断。BSI 越高，潜在健康危险越大。缺失变量会被公开，其权重会重新分配；系统不会静默填造数值。",
    attribution: "天气 · Open-Meteo  |  空气、PM2.5 与海盐 · CAMS / Open-Meteo",
  },
} as const;

const severityFor = (score: number | null): Severity => score === null ? "missing" : score < 30 ? "safe" : score < 50 ? "watch" : score < 75 ? "high" : "danger";
const rangeFor = (severity: Severity) => ({ safe: "1–29", watch: "30–49", high: "50–74", danger: "75–100", missing: "—" })[severity];

function hashContext(location: Location, reading: BsiReading, score: number | null) {
  const input = `${location.name}:${reading.observedAt}:${reading.pm25}:${reading.uv}:${reading.no2}:${score}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `0x${(hash >>> 0).toString(16).padStart(8, "0")}…demo`;
}

export default function GlobalEnvironment({ language, onLocationChange }: { language: Language; onLocationChange?: (update: LocationUpdate) => void }) {
  const [location, setLocation] = useState<Location>(places[0]);
  const [reading, setReading] = useState<BsiReading>(EMPTY_BSI_READING);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(true);
  const [locationReady, setLocationReady] = useState(false);
  const [error, setError] = useState(false);
  const [technicalExpanded, setTechnicalExpanded] = useState(true);
  const t = words[language];

  const applyGpsLocation = useCallback((nextLocation: Location) => {
    setLocation(nextLocation);
    setLocationReady(true);
    onLocationChange?.({ status: "resolved", location: nextLocation, source: "gps" });
    setLocating(false);
  }, [onLocationChange]);

  const requestCurrentLocation = useCallback((force = false) => {
    onLocationChange?.({ status: "locating" });
    if (!navigator.geolocation) { setLocating(false); setLocationReady(true); onLocationChange?.({ status: "unavailable" }); return; }
    if (!force) {
      const cached = readCachedDeviceLocation();
      if (cached) {
        applyGpsLocation({ name: cached.name, country: cached.country, lat: cached.lat, lon: cached.lon, region: cached.region });
        return;
      }
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const browserLanguage = navigator.language.split("-")[0] || "en";
      let name = "Current location";
      let country = "";
      try {
        const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${browserLanguage}`);
        if (response.ok) {
          const place = await response.json();
          name = place.locality || place.city || place.principalSubdivision || name;
          country = place.countryName || place.countryCode || "";
        }
      } catch { /* Precise coordinates still work when the place label is unavailable. */ }
      const nextLocation = { name, country, lat, lon, region: `GPS ±${Math.round(position.coords.accuracy)}M` };
      saveCachedDeviceLocation(nextLocation);
      applyGpsLocation(nextLocation);
    }, (failure) => {
      setLocating(false);
      setLocationReady(true);
      onLocationChange?.({ status: failure.code === 1 ? "denied" : "unavailable" });
    }, force ? { ...LOW_POWER_LOCATION_OPTIONS, maximumAge: 0 } : LOW_POWER_LOCATION_OPTIONS);
  }, [applyGpsLocation, onLocationChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => requestCurrentLocation(false), 0);
    return () => window.clearTimeout(timer);
  }, [requestCurrentLocation]);

  useEffect(() => {
    if (!locationReady) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(false);
      try {
        setReading(await fetchLiveEnvironmentalReading(location.lat, location.lon, controller.signal));
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") { setReading(EMPTY_BSI_READING); setError(true); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    load(); return () => controller.abort();
  }, [location, locationReady]);

  async function search(event: FormEvent) {
    event.preventDefault(); if (query.trim().length < 2) return;
    setLoading(true); setError(false);
    try {
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=1&language=${language}&format=json`);
      if (!response.ok) throw new Error("Search unavailable");
      const payload = await response.json(); const result = payload.results?.[0];
      if (!result) throw new Error("No result");
      const nextLocation = { name: result.name, country: result.country ?? result.country_code ?? "", lat: result.latitude, lon: result.longitude, region: result.admin1 ?? t.result };
      setLocation(nextLocation);
      setLocationReady(true);
      onLocationChange?.({ status: "resolved", location: nextLocation, source: "search" });
    } catch { setLoading(false); setError(true); }
  }

  const bsi = useMemo(() => calculateBsi(reading), [reading]);
  const bsiSeverity = severityFor(bsi.score);
  const tone = ({ safe: "#56f2bb", watch: "#ffd166", high: "#ff9566", danger: "#ff6b7a", missing: "#7b9991" })[bsiSeverity];
  const componentOrder = Object.keys(BSI_WEIGHTS) as (keyof typeof BSI_WEIGHTS)[];

  return (
    <section className="globalSection" id="global-data">
      <div className="globalHeading"><div><span>{t.kicker}</span><h2>{t.title}</h2><p>{t.intro}</p></div>
        <div className="locationTools"><form className="citySearch" onSubmit={search}><label htmlFor="city-query">{t.search}</label><div><input id="city-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="London, Tokyo, Lagos…" /><button type="submit">{t.searchButton}</button></div></form><button className="gpsButton" type="button" onClick={() => requestCurrentLocation(true)} disabled={locating} title={t.gpsHelp}><span className="liveDot" />{locating ? t.locating : t.useLocation}</button><small className="locationPowerNote">{t.gpsHelp}</small></div>
      </div>
      <div className="placeRail" aria-label="Global reference locations">{places.map((place) => <button key={place.name} className={location.name === place.name ? "active" : ""} onClick={() => { setLocation(place); setLocationReady(true); onLocationChange?.({ status: "resolved", location: place, source: "preset" }); }}><span>{place.region}</span>{place.name}</button>)}</div>
      <div className="selectedPlace"><div><span className="liveDot" />{location.region}</div><strong>{location.name}</strong><small>{location.country} · {location.lat.toFixed(4)}, {location.lon.toFixed(4)}</small><b>{locating ? t.locating : loading ? t.loading : error ? t.error : `${t.updated} · ${reading.observedAt.replace("T", " ")}`}</b></div>
      <PersonalizedBsiAlert score={bsi.score} language={language} />
      <details className="technicalDetails" open={technicalExpanded} onToggle={(event) => setTechnicalExpanded(event.currentTarget.open)}>
        <summary><div><span>{t.verifyKicker}</span><strong>{t.verifyDetails}</strong></div><span aria-hidden="true">＋</span></summary>
        {technicalExpanded && <div className="technicalContent">
          <div className="riskLegend" aria-label={t.range}>
            {(["safe", "watch", "high", "danger"] as Severity[]).map((level) => <div key={level} className={`severity-${level}`}><span>{rangeFor(level)}</span><strong>{t.levels[level]}</strong></div>)}
          </div>
          <div className={`globalData ${loading ? "isLoading" : ""}`} aria-live="polite">
            {componentOrder.map((key, index) => {
              const severity = severityFor(bsi.components[key]);
              return <article key={key} className={`metricCard severity-${severity}`}><span>0{index + 1} · {t.labels[key]}</span><strong>{bsi.components[key] ?? "—"}</strong><small>{t.details[key]} · {Math.round(BSI_WEIGHTS[key] * 100)}%</small><div className="metricRange"><span>{t.range}</span><b>{rangeFor(severity)} · {t.levels[severity]}</b></div></article>;
            })}
            <article className={`oracleEnvelope severity-${bsiSeverity}`}><div><span>{t.oracle}</span><b style={{ color: tone }}>{t.ready}</b></div><div className="contextScore"><strong style={{ color: tone }}>{bsi.score ?? "—"}</strong><small>/ 100<br />{t.bsi}<br /><b>{rangeFor(bsiSeverity)} · {t.levels[bsiSeverity]}</b></small></div><dl><div><dt>{t.confidence}</dt><dd>{bsi.confidence}%</dd></div><div><dt>{t.healthFit}</dt><dd>{bsi.score === null ? "—" : 101 - bsi.score} / 100</dd></div><div><dt>{t.source}</dt><dd>OPEN-METEO / CAMS</dd></div><div><dt>{t.hash}</dt><dd>{hashContext(location, reading, bsi.score)}</dd></div></dl></article>
          </div>
          <div className="dataNote"><p>{t.note}</p><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">{t.attribution} ↗</a></div>
        </div>}
      </details>
      <ExposureJourney language={language} />
      <ExposureReport language={language} />
      <BsiHistory primaryLocation={location} language={language} />
    </section>
  );
}
