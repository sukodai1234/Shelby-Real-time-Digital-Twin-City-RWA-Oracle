"use client";

import { CSSProperties, useCallback, useEffect, useState } from "react";

type Language = "en" | "vi" | "zh";
type RiskLevel = "low" | "caution" | "high" | "danger";

type ExposureEvent = {
  id: string;
  date: string;
  timestamp: number;
  lat: number;
  lon: number;
  bsi: number;
  confidence: number;
  context: "home" | "work" | "commute" | "other";
};

type PeriodAggregate = {
  score: number;
  totalMinutes: number;
  dataDays: number;
  eventCount: number;
  riskMinutes: Record<RiskLevel, number>;
};

type TimePattern = { hour: number; samples: number; days: number; averageBsi: number };
type LocationPattern = { lat: number; lon: number; samples: number; days: number; averageBsi: number };
type PeriodReport = {
  days: 7 | 30;
  current: PeriodAggregate;
  previousScore: number | null;
  trendPercent: number | null;
  timePattern: TimePattern | null;
  locationPattern: LocationPattern | null;
};

const DB_NAME = "shelby-exposure-journey";
const STORE_NAME = "events";
const MIN_SAMPLES = 3;
const LEVEL_COLORS: Record<RiskLevel, string> = { low: "#56f2bb", caution: "#ffd166", high: "#ff9566", danger: "#ff6b7a" };

const copy = {
  en: {
    kicker: "PERSONAL EXPOSURE REPORT", title: "Weekly and monthly environmental health patterns",
    intro: "Built only from journey samples already stored on this device. No additional tracking or network request is required.",
    seven: "7 DAYS", thirty: "30 DAYS", loading: "ANALYZING LOCAL JOURNEY DATA", empty: "Not enough journey data yet. Record samples in Personal Exposure Journey to build this report.",
    score: "WEIGHTED EXPOSURE", trend: "VS PREVIOUS PERIOD", coverage: "DATA COVERAGE", observed: "OBSERVED TIME",
    daysWithData: (count: number, days: number) => `${count}/${days} days with data`,
    noPrevious: "No previous period", better: "lower exposure", worse: "higher exposure", stable: "no material change",
    distribution: "TIME BY RISK LEVEL", patterns: "REPEATED PATTERNS", timePattern: "RECURRING RISK HOUR", locationPattern: "RECURRING RISK AREA",
    noTimePattern: "No HIGH-risk hour repeated on at least 3 different days.", noLocationPattern: "No HIGH-risk area repeated enough to form a reliable pattern.",
    timeFinding: (window: string, days: number, average: number) => `${window} repeated on ${days} days · average BSI ${average}`,
    locationFinding: (lat: string, lon: string, samples: number, average: number) => `Approx. ${lat}, ${lon} · ${samples} samples · average BSI ${average}`,
    advice: "PERSONAL ACTION SUGGESTIONS", safeAdvice: "Your recorded exposure is mostly LOW. Keep collecting samples to confirm the pattern.",
    timeAdvice: (window: string) => `Your most consistent risk window is ${window}. Consider changing travel time, route, or outdoor activity during that hour.`,
    locationAdvice: "A nearby area repeatedly reached HIGH BSI. Compare an alternate route before your next regular journey.",
    sparseAdvice: (count: number, days: number) => `Coverage is ${count}/${days} days. Collect more days before making a major health or housing decision.`,
    riskAdvice: "A meaningful share of observed time was HIGH or DANGER. Reduce strenuous outdoor exposure and follow local health guidance.",
    privacy: "Phase 2 analytics run locally in this browser · Approximate patterns are not uploaded · This is decision support, not a medical diagnosis",
    levels: { low: "LOW", caution: "CAUTION", high: "HIGH", danger: "DANGER" }, hours: "H", minutes: "MIN", samples: "samples",
  },
  vi: {
    kicker: "BÁO CÁO PHƠI NHIỄM CÁ NHÂN", title: "Xu hướng sức khỏe môi trường theo tuần và tháng",
    intro: "Chỉ phân tích các mẫu hành trình đã lưu trên thiết bị. Không cần theo dõi mới và không gọi thêm nguồn dữ liệu bên ngoài.",
    seven: "7 NGÀY", thirty: "30 NGÀY", loading: "ĐANG PHÂN TÍCH DỮ LIỆU TRÊN THIẾT BỊ", empty: "Chưa đủ dữ liệu hành trình. Hãy ghi mẫu trong Hành trình phơi nhiễm cá nhân để tạo báo cáo.",
    score: "PHƠI NHIỄM CÓ TRỌNG SỐ", trend: "SO VỚI KỲ TRƯỚC", coverage: "ĐỘ PHỦ DỮ LIỆU", observed: "THỜI GIAN GHI NHẬN",
    daysWithData: (count: number, days: number) => `${count}/${days} ngày có dữ liệu`,
    noPrevious: "Chưa có kỳ trước", better: "phơi nhiễm thấp hơn", worse: "phơi nhiễm cao hơn", stable: "không thay đổi đáng kể",
    distribution: "TỶ LỆ THỜI GIAN THEO MỨC", patterns: "PATTERN RỦI RO LẶP LẠI", timePattern: "KHUNG GIỜ RỦI RO", locationPattern: "KHU VỰC RỦI RO",
    noTimePattern: "Chưa có khung giờ mức CAO lặp lại trong ít nhất 3 ngày khác nhau.", noLocationPattern: "Chưa có khu vực mức CAO lặp lại đủ nhiều để tạo pattern đáng tin cậy.",
    timeFinding: (window: string, days: number, average: number) => `${window} lặp lại trong ${days} ngày · BSI trung bình ${average}`,
    locationFinding: (lat: string, lon: string, samples: number, average: number) => `Xấp xỉ ${lat}, ${lon} · ${samples} mẫu · BSI trung bình ${average}`,
    advice: "GỢI Ý HÀNH VI CÁ NHÂN", safeAdvice: "Dữ liệu ghi nhận chủ yếu ở mức THẤP. Hãy tiếp tục lấy mẫu để xác nhận xu hướng.",
    timeAdvice: (window: string) => `Khung giờ rủi ro ổn định nhất là ${window}. Hãy cân nhắc đổi giờ, đổi tuyến đường hoặc hạn chế hoạt động ngoài trời trong giờ này.`,
    locationAdvice: "Một khu vực gần bạn nhiều lần đạt BSI mức CAO. Nên so sánh một tuyến đường thay thế trước hành trình thường ngày tiếp theo.",
    sparseAdvice: (count: number, days: number) => `Độ phủ hiện là ${count}/${days} ngày. Nên thu thập thêm trước khi đưa ra quyết định lớn về sức khỏe hoặc nơi ở.`,
    riskAdvice: "Một phần đáng kể thời gian ghi nhận ở mức CAO hoặc NGUY HIỂM. Hãy giảm vận động mạnh ngoài trời và tuân theo hướng dẫn y tế địa phương.",
    privacy: "Phân tích Giai đoạn 2 chạy cục bộ trong trình duyệt · Pattern xấp xỉ không được tải lên · Đây là công cụ hỗ trợ quyết định, không phải chẩn đoán y khoa",
    levels: { low: "THẤP", caution: "THẬN TRỌNG", high: "CAO", danger: "NGUY HIỂM" }, hours: "GIỜ", minutes: "PHÚT", samples: "mẫu",
  },
  zh: {
    kicker: "个人暴露报告", title: "每周和每月环境健康趋势",
    intro: "仅分析已保存在本设备上的旅程样本，不启用新的追踪，也不请求额外网络数据。",
    seven: "7 天", thirty: "30 天", loading: "正在分析本地旅程数据", empty: "旅程数据不足。请先在个人暴露旅程中记录样本。",
    score: "时间加权暴露", trend: "与上一周期相比", coverage: "数据覆盖", observed: "记录时长",
    daysWithData: (count: number, days: number) => `${count}/${days} 天有数据`,
    noPrevious: "无上一周期数据", better: "暴露更低", worse: "暴露更高", stable: "无明显变化",
    distribution: "各风险等级时间比例", patterns: "重复风险模式", timePattern: "重复风险时段", locationPattern: "重复风险区域",
    noTimePattern: "尚未发现至少在 3 个不同日期重复的高风险时段。", noLocationPattern: "尚未发现足够重复、可信的高风险区域。",
    timeFinding: (window: string, days: number, average: number) => `${window} 在 ${days} 天重复出现 · 平均 BSI ${average}`,
    locationFinding: (lat: string, lon: string, samples: number, average: number) => `约 ${lat}, ${lon} · ${samples} 个样本 · 平均 BSI ${average}`,
    advice: "个性化行动建议", safeAdvice: "已记录的暴露大多处于低风险。请继续采样以确认趋势。",
    timeAdvice: (window: string) => `最稳定的风险时段是 ${window}。可考虑调整出行时间、路线或该时段的户外活动。`,
    locationAdvice: "附近某区域多次达到高 BSI。下次日常出行前可比较替代路线。",
    sparseAdvice: (count: number, days: number) => `当前覆盖 ${count}/${days} 天。在做出重大健康或居住决定前，请收集更多数据。`,
    riskAdvice: "记录时间中有较大比例处于高或危险等级。请减少剧烈户外活动并遵循当地健康指引。",
    privacy: "第二阶段分析仅在本浏览器本地运行 · 近似模式不会上传 · 本工具用于辅助决策，不构成医疗诊断",
    levels: { low: "低", caution: "注意", high: "高", danger: "危险" }, hours: "小时", minutes: "分钟", samples: "个样本",
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

async function getEventsBetween(startDate: string, endDate: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).index("date").getAll(IDBKeyRange.bound(startDate, endDate));
  const events = await requestResult(request) as ExposureEvent[];
  return events.sort((first, second) => first.timestamp - second.timestamp);
}

const pad = (value: number) => value.toString().padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (date: Date, amount: number) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
const levelFor = (score: number): RiskLevel => score >= 75 ? "danger" : score >= 50 ? "high" : score >= 30 ? "caution" : "low";

function durationsByEvent(events: ExposureEvent[]) {
  const durations = new Map<string, number>();
  const byDate = new Map<string, ExposureEvent[]>();
  events.forEach((event) => byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]));
  byDate.forEach((dailyEvents) => {
    dailyEvents.sort((first, second) => first.timestamp - second.timestamp).forEach((event, index) => {
      const next = dailyEvents[index + 1];
      const duration = next ? Math.max(1, Math.min(30, Math.round((next.timestamp - event.timestamp) / 60000))) : 15;
      durations.set(event.id, duration);
    });
  });
  return durations;
}

function aggregate(events: ExposureEvent[]): PeriodAggregate | null {
  if (!events.length) return null;
  const durations = durationsByEvent(events);
  const totalMinutes = events.reduce((sum, event) => sum + (durations.get(event.id) ?? 15), 0);
  const riskMinutes: Record<RiskLevel, number> = { low: 0, caution: 0, high: 0, danger: 0 };
  let weighted = 0;
  events.forEach((event) => {
    const duration = durations.get(event.id) ?? 15;
    weighted += event.bsi * duration;
    riskMinutes[levelFor(event.bsi)] += duration;
  });
  return {
    score: Math.round(weighted / totalMinutes), totalMinutes,
    dataDays: new Set(events.map((event) => event.date)).size,
    eventCount: events.length, riskMinutes,
  };
}

function detectTimePattern(events: ExposureEvent[]): TimePattern | null {
  const buckets = new Map<number, { samples: number; bsiTotal: number; dates: Set<string> }>();
  events.filter((event) => event.bsi >= 50).forEach((event) => {
    const hour = new Date(event.timestamp).getHours();
    const bucket = buckets.get(hour) ?? { samples: 0, bsiTotal: 0, dates: new Set<string>() };
    bucket.samples += 1; bucket.bsiTotal += event.bsi; bucket.dates.add(event.date); buckets.set(hour, bucket);
  });
  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.samples >= MIN_SAMPLES && bucket.dates.size >= MIN_SAMPLES)
    .map(([hour, bucket]) => ({ hour, samples: bucket.samples, days: bucket.dates.size, averageBsi: Math.round(bucket.bsiTotal / bucket.samples) }))
    .sort((first, second) => second.averageBsi - first.averageBsi || second.samples - first.samples)[0] ?? null;
}

function detectLocationPattern(events: ExposureEvent[]): LocationPattern | null {
  const buckets = new Map<string, { latTotal: number; lonTotal: number; bsiTotal: number; samples: number; dates: Set<string> }>();
  events.filter((event) => event.bsi >= 50).forEach((event) => {
    const key = `${Math.round(event.lat * 100) / 100}:${Math.round(event.lon * 100) / 100}`;
    const bucket = buckets.get(key) ?? { latTotal: 0, lonTotal: 0, bsiTotal: 0, samples: 0, dates: new Set<string>() };
    bucket.latTotal += event.lat; bucket.lonTotal += event.lon; bucket.bsiTotal += event.bsi; bucket.samples += 1; bucket.dates.add(event.date); buckets.set(key, bucket);
  });
  return [...buckets.values()]
    .filter((bucket) => bucket.samples >= MIN_SAMPLES && bucket.dates.size >= 2)
    .map((bucket) => ({ lat: bucket.latTotal / bucket.samples, lon: bucket.lonTotal / bucket.samples, samples: bucket.samples, days: bucket.dates.size, averageBsi: Math.round(bucket.bsiTotal / bucket.samples) }))
    .sort((first, second) => second.averageBsi - first.averageBsi || second.samples - first.samples)[0] ?? null;
}

async function getPeriodReport(days: 7 | 30): Promise<PeriodReport | null> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const currentStart = addDays(today, -(days - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  const [currentEvents, previousEvents] = await Promise.all([
    getEventsBetween(dateKey(currentStart), dateKey(today)),
    getEventsBetween(dateKey(previousStart), dateKey(previousEnd)),
  ]);
  const current = aggregate(currentEvents);
  if (!current) return null;
  const previous = aggregate(previousEvents);
  const trendPercent = previous?.score ? Math.round(((current.score - previous.score) / previous.score) * 100) : null;
  return { days, current, previousScore: previous?.score ?? null, trendPercent, timePattern: detectTimePattern(currentEvents), locationPattern: detectLocationPattern(currentEvents) };
}

function timeWindow(hour: number) { return `${pad(hour)}:00–${pad((hour + 1) % 24)}:00`; }

export default function ExposureReport({ language }: { language: Language }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [error, setError] = useState(false);
  const t = copy[language];

  const loadReport = useCallback(async (period: 7 | 30) => {
    if (!window.indexedDB) { setError(true); return; }
    setLoading(true); setError(false);
    try { setReport(await getPeriodReport(period)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const refresh = () => { if (expanded) void loadReport(days); };
    window.addEventListener("shelby-exposure-updated", refresh);
    return () => window.removeEventListener("shelby-exposure-updated", refresh);
  }, [days, expanded, loadReport]);

  const advice: string[] = [];
  if (report) {
    const items: string[] = [];
    const riskShare = (report.current.riskMinutes.high + report.current.riskMinutes.danger) / report.current.totalMinutes;
    if (riskShare >= .2) items.push(t.riskAdvice);
    if (report.timePattern) items.push(t.timeAdvice(timeWindow(report.timePattern.hour)));
    if (report.locationPattern) items.push(t.locationAdvice);
    if (report.current.dataDays < Math.ceil(report.days / 2)) items.push(t.sparseAdvice(report.current.dataDays, report.days));
    if (!items.length) items.push(t.safeAdvice);
    advice.push(...items);
  }

  const trend = report?.trendPercent ?? null;
  const trendDirection = trend === null ? "missing" : Math.abs(trend) < 3 ? "stable" : trend > 0 ? "worse" : "better";
  const trendSymbol = trend === null || trendDirection === "stable" ? "—" : trend > 0 ? "▲" : "▼";
  const tone = report ? LEVEL_COLORS[levelFor(report.current.score)] : "#54a7ff";
  const duration = report ? report.current.totalMinutes >= 60 ? `${(report.current.totalMinutes / 60).toFixed(1)} ${t.hours}` : `${report.current.totalMinutes} ${t.minutes}` : "—";

  return (
    <details className="reportDetails" onToggle={(event) => { const open = event.currentTarget.open; setExpanded(open); if (open) void loadReport(days); }}>
      <summary><div><span>{t.kicker}</span><strong>{t.title}</strong></div><div className="reportSummaryMeta">{report && <b>{t.daysWithData(report.current.dataDays, report.days)}</b>}<span aria-hidden="true">＋</span></div></summary>
      <section className="reportPanel" aria-busy={loading}>
        <header><p>{t.intro}</p><div className="reportPeriod" role="group" aria-label={t.title}><button type="button" className={days === 7 ? "active" : ""} aria-pressed={days === 7} onClick={() => { setDays(7); void loadReport(7); }}>{t.seven}</button><button type="button" className={days === 30 ? "active" : ""} aria-pressed={days === 30} onClick={() => { setDays(30); void loadReport(30); }}>{t.thirty}</button></div></header>
        {loading ? <div className="reportState"><span className="pulse" />{t.loading}</div> : error ? <div className="reportState error">{t.empty}</div> : !report ? <div className="reportState">{t.empty}</div> : <>
          <div className="reportStats">
            <article style={{ "--report-tone": tone } as CSSProperties}><span>{t.score}</span><strong>{report.current.score}</strong><small>/ 100</small></article>
            <article className={`trend-${trendDirection}`}><span>{t.trend}</span><strong>{trend === null ? "—" : `${trendSymbol} ${Math.abs(trend)}%`}</strong><small>{trend === null ? t.noPrevious : t[trendDirection as "better" | "worse" | "stable"]}</small></article>
            <article><span>{t.coverage}</span><strong>{report.current.dataDays}/{report.days}</strong><small>{report.current.eventCount} {t.samples}</small></article>
            <article><span>{t.observed}</span><strong>{duration.split(" ")[0]}</strong><small>{duration.split(" ").slice(1).join(" ")}</small></article>
          </div>

          <div className="reportDistribution"><span>{t.distribution}</span><div className="reportRiskBar">{(Object.keys(LEVEL_COLORS) as RiskLevel[]).map((level) => <i key={level} style={{ width: `${(report.current.riskMinutes[level] / report.current.totalMinutes) * 100}%`, background: LEVEL_COLORS[level] }}><b>{report.current.riskMinutes[level] > 0 ? `${Math.round((report.current.riskMinutes[level] / report.current.totalMinutes) * 100)}%` : ""}</b></i>)}</div><div className="reportRiskLegend">{(Object.keys(LEVEL_COLORS) as RiskLevel[]).map((level) => <b key={level} style={{ "--level-color": LEVEL_COLORS[level] } as CSSProperties}>{t.levels[level]} · {report.current.riskMinutes[level]} {t.minutes}</b>)}</div></div>

          <div className="reportSectionTitle">{t.patterns}</div>
          <div className="reportPatterns">
            <article><span>01</span><div><b>{t.timePattern}</b><p>{report.timePattern ? t.timeFinding(timeWindow(report.timePattern.hour), report.timePattern.days, report.timePattern.averageBsi) : t.noTimePattern}</p></div></article>
            <article><span>02</span><div><b>{t.locationPattern}</b><p>{report.locationPattern ? t.locationFinding(report.locationPattern.lat.toFixed(2), report.locationPattern.lon.toFixed(2), report.locationPattern.samples, report.locationPattern.averageBsi) : t.noLocationPattern}</p></div></article>
          </div>

          <div className="reportSectionTitle">{t.advice}</div>
          <div className="reportAdvice">{advice.map((item, index) => <article key={item}><span>{pad(index + 1)}</span><p>{item}</p></article>)}</div>
        </>}
        <footer>{t.privacy}</footer>
      </section>
    </details>
  );
}
