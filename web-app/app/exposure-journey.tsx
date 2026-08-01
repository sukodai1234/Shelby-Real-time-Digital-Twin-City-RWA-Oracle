"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calculateBsi } from "./bsi-engine";
import { fetchLiveEnvironmentalReading } from "./environment-api";
import { JOURNEY_LOCATION_OPTIONS } from "./location-power";

type Language = "en" | "vi" | "zh";
type RiskLevel = "low" | "caution" | "high" | "danger";
type JourneyContext = "home" | "work" | "commute" | "other";
type ContextChoice = "auto" | JourneyContext;
type TrackerStatus = "idle" | "requesting" | "active" | "paused" | "sampling" | "denied" | "unavailable" | "error";

type ExposureEvent = {
  id: string;
  date: string;
  timestamp: number;
  lat: number;
  lon: number;
  bsi: number;
  confidence: number;
  context: JourneyContext;
};

type DailySummary = {
  weightedExposure: number;
  peak: ExposureEvent;
  totalMinutes: number;
  riskMinutes: Record<RiskLevel, number>;
  durations: number[];
};

const DB_NAME = "shelby-exposure-journey";
const STORE_NAME = "events";
const SAMPLE_INTERVAL_MS = 15 * 60 * 1000;
const SIGNIFICANT_DISTANCE_METERS = 500;
const LEVEL_COLORS: Record<RiskLevel, string> = { low: "#56f2bb", caution: "#ffd166", high: "#ff9566", danger: "#ff6b7a" };

const copy = {
  en: {
    kicker: "PERSONAL EXPOSURE JOURNEY", title: "Your environmental day, not just your city", intro: "Battery-efficient tracking takes one low-power location sample about every 15 minutes while this page is visible.",
    start: "START JOURNEY", stop: "STOP", sample: "SAMPLE NOW", remove: "DELETE TODAY", context: "SAMPLE CONTEXT",
    choices: { auto: "Auto", home: "Home", work: "Work", commute: "Commute", other: "Other" },
    statuses: { idle: "Tracking is off", requesting: "Requesting device location", active: "Low-power tracking active", paused: "Paused while tab is hidden", sampling: "Calculating BSI sample", denied: "Location permission was denied", unavailable: "Location is unavailable on this device", error: "Could not save this sample" },
    weighted: "CUMULATIVE EXPOSURE", peak: "PEAK BSI", risky: "HIGH + DANGER", samples: "LOCAL SAMPLES", minutes: "MIN", timeline: "TODAY'S EXPOSURE TIMELINE", recent: "RECENT SAMPLES",
    empty: "No journey samples yet. Start the journey or add one sample to build today's environmental profile.",
    safeSummary: (score: number) => `No HIGH exposure has been observed today. Time-weighted exposure is ${score}/100.`,
    riskSummary: (minutes: number, time: string, context: string, bsi: number) => `You spent about ${minutes} minutes at HIGH or above. The peak was ${time} during ${context} (BSI ${bsi}).`,
    privacy: "Battery saver: one location check about every 15 min · Pauses while the tab is hidden · Coordinates stay on this device",
    deleteConfirm: "Delete all journey samples stored for today on this device?", levels: { low: "LOW", caution: "CAUTION", high: "HIGH", danger: "DANGER" },
  },
  vi: {
    kicker: "HÀNH TRÌNH PHƠI NHIỄM CÁ NHÂN", title: "Ngày môi trường của bạn, không chỉ của thành phố", intro: "Chế độ tiết kiệm pin chỉ lấy một vị trí công suất thấp khoảng mỗi 15 phút khi trang đang hiển thị.",
    start: "BẮT ĐẦU HÀNH TRÌNH", stop: "DỪNG", sample: "LẤY MẪU NGAY", remove: "XÓA HÔM NAY", context: "BỐI CẢNH MẪU",
    choices: { auto: "Tự động", home: "Nhà", work: "Công ty", commute: "Di chuyển", other: "Khác" },
    statuses: { idle: "Đang tắt theo dõi", requesting: "Đang xin vị trí thiết bị", active: "Theo dõi tiết kiệm pin đang bật", paused: "Tạm dừng khi tab bị ẩn", sampling: "Đang tính mẫu BSI", denied: "Bạn đã từ chối quyền vị trí", unavailable: "Thiết bị không cung cấp vị trí", error: "Không thể lưu mẫu này" },
    weighted: "PHƠI NHIỄM TÍCH LŨY", peak: "BSI CAO NHẤT", risky: "CAO + NGUY HIỂM", samples: "MẪU TRÊN MÁY", minutes: "PHÚT", timeline: "TIMELINE PHƠI NHIỄM HÔM NAY", recent: "MẪU GẦN ĐÂY",
    empty: "Chưa có mẫu hành trình. Hãy bắt đầu theo dõi hoặc lấy một mẫu để tạo hồ sơ môi trường hôm nay.",
    safeSummary: (score: number) => `Hôm nay chưa ghi nhận phơi nhiễm mức CAO. Điểm phơi nhiễm theo thời gian là ${score}/100.`,
    riskSummary: (minutes: number, time: string, context: string, bsi: number) => `Hôm nay bạn ở mức CAO trở lên khoảng ${minutes} phút. Cao điểm lúc ${time}, khi ${context} (BSI ${bsi}).`,
    privacy: "Tiết kiệm pin: kiểm tra vị trí khoảng 15 phút/lần · Tự dừng khi tab bị ẩn · Tọa độ chỉ lưu trên thiết bị",
    deleteConfirm: "Xóa toàn bộ mẫu hành trình hôm nay đang lưu trên thiết bị?", levels: { low: "THẤP", caution: "THẬN TRỌNG", high: "CAO", danger: "NGUY HIỂM" },
  },
  zh: {
    kicker: "个人环境暴露旅程", title: "记录您的环境一天，而不只是整座城市", intro: "省电模式仅在页面可见时，大约每 15 分钟获取一次低功耗位置。",
    start: "开始旅程", stop: "停止", sample: "立即采样", remove: "删除今天", context: "采样场景",
    choices: { auto: "自动", home: "家", work: "工作", commute: "通勤", other: "其他" },
    statuses: { idle: "追踪已关闭", requesting: "正在请求设备位置", active: "低功耗追踪已开启", paused: "标签页隐藏时已暂停", sampling: "正在计算 BSI 样本", denied: "位置权限被拒绝", unavailable: "此设备无法提供位置", error: "无法保存该样本" },
    weighted: "累计暴露", peak: "最高 BSI", risky: "高 + 危险", samples: "本地样本", minutes: "分钟", timeline: "今日暴露时间线", recent: "最近样本",
    empty: "今天还没有旅程样本。开始旅程或立即采样以建立今日环境档案。",
    safeSummary: (score: number) => `今天尚未观察到高等级暴露。时间加权暴露为 ${score}/100。`,
    riskSummary: (minutes: number, time: string, context: string, bsi: number) => `今天约有 ${minutes} 分钟处于高等级或以上。峰值出现在 ${time} 的${context}场景（BSI ${bsi}）。`,
    privacy: "省电模式：约每 15 分钟定位一次 · 标签页隐藏时自动暂停 · 坐标仅保存在本设备",
    deleteConfirm: "删除本设备上保存的今日全部旅程样本？", levels: { low: "低", caution: "注意", high: "高", danger: "危险" },
  },
} as const;

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function saveExposureEvent(event: ExposureEvent) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(event);
  await transactionDone(transaction);
  window.dispatchEvent(new Event("shelby-exposure-updated"));
}

async function getEventsForDate(date: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).index("date").getAll(IDBKeyRange.only(date));
  const events = await requestResult(request) as ExposureEvent[];
  return events.sort((first, second) => first.timestamp - second.timestamp);
}

async function deleteEventsForDate(date: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const keys = await requestResult(store.index("date").getAllKeys(IDBKeyRange.only(date)));
  keys.forEach((key) => store.delete(key));
  await transactionDone(transaction);
  window.dispatchEvent(new Event("shelby-exposure-updated"));
}

const pad = (value: number) => value.toString().padStart(2, "0");
const localDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const levelFor = (score: number): RiskLevel => score >= 75 ? "danger" : score >= 50 ? "high" : score >= 30 ? "caution" : "low";

function distanceMeters(first: ExposureEvent, lat: number, lon: number) {
  const radius = 6371000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(lat - first.lat);
  const longitudeDelta = toRadians(lon - first.lon);
  const startLatitude = toRadians(first.lat);
  const endLatitude = toRadians(lat);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function eventDurations(events: ExposureEvent[]) {
  return events.map((event, index) => {
    const next = events[index + 1];
    if (!next) return 15;
    return Math.max(1, Math.min(30, Math.round((next.timestamp - event.timestamp) / 60000)));
  });
}

function summarize(events: ExposureEvent[]): DailySummary | null {
  if (!events.length) return null;
  const durations = eventDurations(events);
  const totalMinutes = durations.reduce((sum, duration) => sum + duration, 0);
  const weightedExposure = Math.round(events.reduce((sum, event, index) => sum + event.bsi * durations[index], 0) / totalMinutes);
  const peak = events.reduce((highest, event) => event.bsi > highest.bsi ? event : highest);
  const riskMinutes: Record<RiskLevel, number> = { low: 0, caution: 0, high: 0, danger: 0 };
  events.forEach((event, index) => { riskMinutes[levelFor(event.bsi)] += durations[index]; });
  return { weightedExposure, peak, totalMinutes, riskMinutes, durations };
}

function inferContext(position: GeolocationPosition): JourneyContext {
  const speedKmh = position.coords.speed === null ? 0 : position.coords.speed * 3.6;
  return speedKmh >= 8 ? "commute" : "other";
}

function ExposureTimeline({ events, summary, language }: { events: ExposureEvent[]; summary: DailySummary; language: Language }) {
  const t = copy[language];
  const width = 1000;
  const height = 84;
  const barY = 10;
  const barHeight = 34;
  const xForMinutes = (minutes: number) => (minutes / 1440) * width;

  return (
    <div className="journeyTimelineScroll">
      <svg className="journeyTimeline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.timeline}>
        <rect x="0" y={barY} width={width} height={barHeight} rx="6" fill="rgba(149,201,185,.055)" />
        {events.map((event, index) => {
          const date = new Date(event.timestamp);
          const minute = date.getHours() * 60 + date.getMinutes();
          const segmentWidth = Math.max(5, xForMinutes(summary.durations[index]));
          const color = LEVEL_COLORS[levelFor(event.bsi)];
          return <rect key={event.id} x={xForMinutes(minute)} y={barY} width={segmentWidth} height={barHeight} rx="5" fill={color} opacity=".9"><title>{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · BSI {event.bsi} · {t.choices[event.context]}</title></rect>;
        })}
        {[0, 6, 12, 18, 24].map((hour) => <g key={hour}><line x1={(hour / 24) * width} x2={(hour / 24) * width} y1="48" y2="55" stroke="rgba(149,201,185,.35)" /><text x={(hour / 24) * width} y="72" textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"} fill="#58736b" fontSize="10" fontFamily="monospace">{hour}h</text></g>)}
      </svg>
    </div>
  );
}

export default function ExposureJourney({ language }: { language: Language }) {
  const [events, setEvents] = useState<ExposureEvent[]>([]);
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState<TrackerStatus>("idle");
  const [contextChoice, setContextChoice] = useState<ContextChoice>("auto");
  const lastEventRef = useRef<ExposureEvent | null>(null);
  const samplingRef = useRef(false);
  const today = localDateKey(new Date());
  const t = copy[language];

  const reloadEvents = useCallback(async () => {
    const stored = await getEventsForDate(today);
    setEvents(stored);
    lastEventRef.current = stored.at(-1) ?? null;
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    getEventsForDate(today).then((stored) => {
      if (!cancelled) { setEvents(stored); lastEventRef.current = stored.at(-1) ?? null; }
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [today]);

  const recordPosition = useCallback(async (position: GeolocationPosition, force = false) => {
    const previous = lastEventRef.current;
    const timestamp = Date.now();
    if (!force && previous) {
      const soon = timestamp - previous.timestamp < SAMPLE_INTERVAL_MS;
      const nearby = distanceMeters(previous, position.coords.latitude, position.coords.longitude) < SIGNIFICANT_DISTANCE_METERS;
      if (soon && nearby) { setStatus("active"); return; }
    }
    if (samplingRef.current) return;
    samplingRef.current = true;
    setStatus("sampling");
    try {
      const reading = await fetchLiveEnvironmentalReading(position.coords.latitude, position.coords.longitude);
      const result = calculateBsi(reading);
      if (result.score === null) throw new Error("BSI unavailable");
      const event: ExposureEvent = {
        id: `${timestamp}-${position.coords.latitude.toFixed(5)}-${position.coords.longitude.toFixed(5)}`,
        date: localDateKey(new Date(timestamp)),
        timestamp,
        lat: Number(position.coords.latitude.toFixed(5)),
        lon: Number(position.coords.longitude.toFixed(5)),
        bsi: result.score,
        confidence: result.confidence,
        context: contextChoice === "auto" ? inferContext(position) : contextChoice,
      };
      await saveExposureEvent(event);
      lastEventRef.current = event;
      await reloadEvents();
      setStatus(tracking ? "active" : "idle");
    } catch { setStatus("error"); }
    finally { samplingRef.current = false; }
  }, [contextChoice, reloadEvents, tracking]);

  useEffect(() => {
    if (!tracking || !navigator.geolocation) return;
    let cancelled = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const requestSample = () => {
      if (cancelled || document.hidden) { setStatus("paused"); return; }
      setStatus("requesting");
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          void recordPosition(position).finally(() => {
            clearTimer();
            if (!cancelled && !document.hidden) timer = window.setTimeout(requestSample, SAMPLE_INTERVAL_MS);
          });
        },
        (failure) => {
          if (cancelled) return;
          setTracking(false);
          setStatus(failure.code === 1 ? "denied" : "unavailable");
        },
        JOURNEY_LOCATION_OPTIONS,
      );
    };
    const scheduleNow = () => {
      clearTimer();
      if (!cancelled && !document.hidden) timer = window.setTimeout(requestSample, 0);
    };
    const handleVisibility = () => {
      if (document.hidden) { clearTimer(); setStatus("paused"); }
      else { setStatus("active"); scheduleNow(); }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    scheduleNow();
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [recordPosition, tracking]);

  const summary = useMemo(() => summarize(events), [events]);
  const riskyMinutes = summary ? summary.riskMinutes.high + summary.riskMinutes.danger : 0;
  const locale = language === "vi" ? "vi-VN" : language === "zh" ? "zh-CN" : "en-US";

  function startTracking() {
    if (!navigator.geolocation || !window.indexedDB) { setStatus("unavailable"); return; }
    setStatus("requesting");
    setTracking(true);
  }

  function stopTracking() {
    setTracking(false);
    setStatus("idle");
  }

  function sampleNow() {
    if (!navigator.geolocation || !window.indexedDB) { setStatus("unavailable"); return; }
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => { void recordPosition(position, true); },
      (failure) => setStatus(failure.code === 1 ? "denied" : "unavailable"),
      JOURNEY_LOCATION_OPTIONS,
    );
  }

  async function deleteToday() {
    if (!window.confirm(t.deleteConfirm)) return;
    await deleteEventsForDate(today);
    lastEventRef.current = null;
    setEvents([]);
  }

  const summaryText = summary && (riskyMinutes === 0
    ? t.safeSummary(summary.weightedExposure)
    : t.riskSummary(riskyMinutes, new Date(summary.peak.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }), t.choices[summary.peak.context].toLocaleLowerCase(), summary.peak.bsi));

  return (
    <details className="journeyDetails">
      <summary>
        <div><span>{t.kicker}</span><strong>{t.title}</strong></div>
        <div className="journeySummaryControls">
          <div className="journeyStatus" aria-live="polite"><span className={tracking && status !== "paused" ? "active" : ""} /><b>{t.statuses[status]}</b></div>
          <span className="journeyExpandIcon" aria-hidden="true">＋</span>
        </div>
      </summary>
      <section className="journeyPanel">
        <header className="journeyHeader"><p>{t.intro}</p></header>
        <div className="journeyControls">
          <label>{t.context}<select value={contextChoice} onChange={(event) => setContextChoice(event.target.value as ContextChoice)}>{(Object.keys(t.choices) as ContextChoice[]).map((choice) => <option key={choice} value={choice}>{t.choices[choice]}</option>)}</select></label>
          {tracking ? <button className="journeyStop" type="button" onClick={stopTracking}>{t.stop}</button> : <button className="journeyStart" type="button" onClick={startTracking}>{t.start}</button>}
          <button type="button" onClick={sampleNow} disabled={status === "sampling" || status === "requesting"}>{t.sample}</button>
          <button className="journeyDelete" type="button" onClick={() => { void deleteToday(); }} disabled={!events.length}>{t.remove}</button>
        </div>

        {!summary ? <div className="journeyEmpty">{t.empty}</div> : <>
          <div className="journeyStats">
            <article><span>{t.weighted}</span><strong>{summary.weightedExposure}</strong><small>/ 100</small></article>
            <article><span>{t.peak}</span><strong>{summary.peak.bsi}</strong><small>{new Date(summary.peak.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</small></article>
            <article><span>{t.risky}</span><strong>{riskyMinutes}</strong><small>{t.minutes}</small></article>
            <article><span>{t.samples}</span><strong>{events.length}</strong><small>{summary.totalMinutes} {t.minutes}</small></article>
          </div>
          <p className="journeySummary">{summaryText}</p>
          <div className="journeyTimelineTitle"><span>{t.timeline}</span><div>{(Object.keys(LEVEL_COLORS) as RiskLevel[]).map((level) => <b key={level} style={{ "--level-color": LEVEL_COLORS[level] } as CSSProperties}>{t.levels[level]}</b>)}</div></div>
          <ExposureTimeline events={events} summary={summary} language={language} />
          <div className="journeyRecent"><span>{t.recent}</span>{events.slice(-5).reverse().map((event) => <div key={event.id}><b style={{ color: LEVEL_COLORS[levelFor(event.bsi)] }}>BSI {event.bsi}</b><strong>{new Date(event.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</strong><small>{t.choices[event.context]} · {event.lat.toFixed(4)}, {event.lon.toFixed(4)} · {event.confidence}%</small></div>)}</div>
        </>}
        <footer>{t.privacy}</footer>
      </section>
    </details>
  );
}
