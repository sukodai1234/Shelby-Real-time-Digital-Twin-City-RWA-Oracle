"use client";

import { useEffect, useMemo, useState } from "react";
import GlobalEnvironment, { LocationUpdate } from "./global-environment";

type Scenario = "stable" | "coastal" | "flood";
type Language = "en" | "vi" | "zh";

const scenarioData: Record<Scenario, { base: number[]; risk: number; color: string }> = {
  stable: { base: [28.4, 61, 22, 0.18], risk: 12, color: "#56f2bb" },
  coastal: { base: [31.8, 78, 46, 0.52], risk: 47, color: "#ffd166" },
  flood: { base: [34.2, 91, 84, 0.88], risk: 83, color: "#ff6b7a" },
};

const copy = {
  en: {
    home: "Shelby Digital Twin home", infrastructure: "URBAN INFRASTRUCTURE", asset: "ASSET #HCM-042",
    headlineA: "A city", headlineB: "worth living in.",
    intro: "A real-time digital twin for livable urban RWA — environmental data is authenticated, translated into a bio-sensory score and anchored with on-chain proof.",
    location: "LOCATION", placeLocating: "Locating your device…", placeDenied: "Location permission required", placeUnavailable: "Unable to determine location", lastUpdate: "LAST UPDATE", streaming: "Streaming", paused: "Paused",
    controls: "Digital Twin simulation controls", scenario: "DIGITAL TWIN SIMULATION", pause: "PAUSE STREAM", resume: "RESUME STREAM",
    scenarioHelp: "Demo only — changes the simulated dashboard below, not your live GPS or environmental data.",
    riskIndex: "BIO-SENSORY INDEX", riskScore: "BIO-SENSORY SCORE", cyclesAgo: "18 CYCLES AGO", current: "CURRENT",
    scenarios: { stable: ["Stable operation", "Stable"], coastal: ["Coastal pressure", "Coastal"], flood: ["Flood alert", "Flood"] },
    scenarioDescriptions: {
      stable: "Baseline: normal infrastructure and environmental operating conditions.",
      coastal: "What-if: stronger sea wind, humidity and salt exposure increase corrosion pressure.",
      flood: "What-if: heavy rain and rising water increase health and infrastructure risk.",
    },
    sensors: [["Temperature", "Celsius"], ["Humidity", "Air"], ["Water level", "Centimetres"], ["Corrosion", "mm / year"]],
    pipeline: [["Sensor", "HMAC signed"], ["Oracle", "Bio-sensory scored"], ["Shelby", "Snapshot stored"], ["Aptos", "Proof anchored"]],
    verified: "VERIFIED", anchored: "ANCHORED", chart: "Bio-sensory chart over 18 cycles",
    disclaimer: "SIMULATION DEMO · NO REAL DATA IS WRITTEN TO SHELBY/APTOS", snapshot: "SNAPSHOT",
    language: "Language",
  },
  vi: {
    home: "Trang chủ Shelby Digital Twin", infrastructure: "HẠ TẦNG ĐÔ THỊ", asset: "TÀI SẢN #HCM-042",
    headlineA: "Thành phố", headlineB: "đáng sống.",
    intro: "Digital twin thời gian thực cho RWA đô thị đáng sống — dữ liệu môi trường được xác thực, quy đổi thành điểm cảm quan sinh học và neo bằng bằng chứng on-chain.",
    location: "VỊ TRÍ", placeLocating: "Đang xác định vị trí thiết bị…", placeDenied: "Cần cấp quyền vị trí", placeUnavailable: "Không thể xác định vị trí", lastUpdate: "CẬP NHẬT CUỐI", streaming: "Đang truyền", paused: "Đã tạm dừng",
    controls: "Điều khiển mô phỏng Digital Twin", scenario: "MÔ PHỎNG DIGITAL TWIN", pause: "TẠM DỪNG DÒNG", resume: "TIẾP TỤC DÒNG",
    scenarioHelp: "Chỉ là mô phỏng — thay đổi dashboard bên dưới, không thay đổi vị trí GPS hay dữ liệu môi trường thật.",
    riskIndex: "CHỈ SỐ CẢM QUAN SINH HỌC", riskScore: "ĐIỂM CẢM QUAN", cyclesAgo: "18 CHU KỲ TRƯỚC", current: "HIỆN TẠI",
    scenarios: { stable: ["Vận hành ổn định", "Ổn định"], coastal: ["Áp lực ven biển", "Ven biển"], flood: ["Cảnh báo ngập", "Ngập lụt"] },
    scenarioDescriptions: {
      stable: "Mốc tham chiếu: hạ tầng và môi trường đang vận hành bình thường.",
      coastal: "Giả định: gió biển, độ ẩm và muối tăng làm áp lực ăn mòn cao hơn.",
      flood: "Giả định: mưa lớn và nước dâng làm tăng rủi ro sức khỏe lẫn hạ tầng.",
    },
    sensors: [["Nhiệt độ", "Celsius"], ["Độ ẩm", "Không khí"], ["Mực nước", "Centimet"], ["Ăn mòn", "mm / năm"]],
    pipeline: [["Cảm biến", "HMAC đã ký"], ["Oracle", "Điểm cảm quan"], ["Shelby", "Snapshot lưu trữ"], ["Aptos", "Proof neo chuỗi"]],
    verified: "ĐÃ XÁC THỰC", anchored: "ĐÃ NEO", chart: "Biểu đồ cảm quan sinh học trong 18 chu kỳ",
    disclaimer: "DEMO MÔ PHỎNG · KHÔNG GHI DỮ LIỆU THẬT LÊN SHELBY/APTOS", snapshot: "SNAPSHOT",
    language: "Ngôn ngữ",
  },
  zh: {
    home: "Shelby 数字孪生主页", infrastructure: "城市基础设施", asset: "资产 #HCM-042",
    headlineA: "一座", headlineB: "宜居之城。",
    intro: "面向宜居城市 RWA 的实时数字孪生——环境数据经过认证、转换为生物感知评分，并通过链上证明锚定。",
    location: "位置", placeLocating: "正在定位设备…", placeDenied: "需要位置权限", placeUnavailable: "无法确定位置", lastUpdate: "最后更新", streaming: "实时传输中", paused: "已暂停",
    controls: "数字孪生模拟控制", scenario: "数字孪生模拟", pause: "暂停数据流", resume: "继续数据流",
    scenarioHelp: "仅为模拟——只改变下方演示面板，不会改变您的实时 GPS 或环境数据。",
    riskIndex: "生物感知指数", riskScore: "生物感知评分", cyclesAgo: "18 个周期前", current: "当前",
    scenarios: { stable: ["稳定运行", "稳定"], coastal: ["沿海压力", "沿海"], flood: ["洪水警报", "洪水"] },
    scenarioDescriptions: {
      stable: "基准状态：基础设施与环境处于正常运行条件。",
      coastal: "假设情景：海风、湿度和盐分升高，加大腐蚀压力。",
      flood: "假设情景：强降雨和水位上升，加大健康与基础设施风险。",
    },
    sensors: [["温度", "摄氏度"], ["湿度", "空气"], ["水位", "厘米"], ["腐蚀率", "毫米 / 年"]],
    pipeline: [["传感器", "HMAC 已签名"], ["预言机", "生物感知已评分"], ["Shelby", "快照已存储"], ["Aptos", "证明已上链"]],
    verified: "已验证", anchored: "已锚定", chart: "18 个周期生物感知图表",
    disclaimer: "模拟演示 · 不会向 SHELBY/APTOS 写入真实数据", snapshot: "快照",
    language: "语言",
  },
} as const;

const locale: Record<Language, string> = { en: "en-US", vi: "vi-VN", zh: "zh-CN" };
const languageLabels: Record<Language, string> = { en: "EN", vi: "VI", zh: "中文" };

function Sparkline({ risk, color, label }: { risk: number; color: string; label: string }) {
  const points = useMemo(() => {
    const values = Array.from({ length: 18 }, (_, i) =>
      Math.max(5, Math.min(95, risk + Math.sin(i * 0.82) * 7 + ((i * 13) % 9) - 4)),
    );
    return values.map((v, i) => `${(i / (values.length - 1)) * 100},${56 - v * 0.48}`).join(" ");
  }, [risk]);

  return (
    <svg className="sparkline" viewBox="0 0 100 56" preserveAspectRatio="none" aria-label={label} role="img">
      <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,56 ${points} 100,56`} fill="url(#area)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("en");
  const [scenario, setScenario] = useState<Scenario>("stable");
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState("--:--:--");
  const [userLocation, setUserLocation] = useState<LocationUpdate>({ status: "locating" });
  const t = copy[language];
  const active = scenarioData[scenario];

  useEffect(() => {
    const saved = window.localStorage.getItem("shelby-language") as Language | null;
    const detected: Language = navigator.language.startsWith("vi") ? "vi" : navigator.language.startsWith("zh") ? "zh" : "en";
    const initialLanguage = saved && saved in copy ? saved : detected;
    const timer = window.setTimeout(() => setLanguage(initialLanguage), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
    window.localStorage.setItem("shelby-language", language);
    const updateClock = () => {
      setTick((value) => value + 1);
      setNow(new Date().toLocaleTimeString(locale[language]));
    };
    let intervalTimer: number | null = null;
    const stopClock = () => {
      if (intervalTimer !== null) window.clearInterval(intervalTimer);
      intervalTimer = null;
    };
    const startClock = () => {
      stopClock();
      if (running && !document.hidden) {
        updateClock();
        intervalTimer = window.setInterval(updateClock, 30_000);
      }
    };
    const handleVisibility = () => document.hidden ? stopClock() : startClock();
    if (!running) return;
    startClock();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopClock();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [running, language]);

  const jitter = (seed: number, scale: number) => Math.sin((tick + seed) * 1.73) * scale;
  const values = [
    `${(active.base[0] + jitter(1, .45)).toFixed(1)}°`, `${Math.round(active.base[1] + jitter(2, 2))}%`,
    `${Math.round(active.base[2] + jitter(3, 3))}`, `${(active.base[3] + jitter(4, .025)).toFixed(2)}`,
  ];
  const levels = [72, active.base[1], active.base[2], active.base[3] * 100];
  const hash = `0x${(scenario + tick.toString(16)).padEnd(12, "a7f2").slice(0, 12)}…9c4e`;

  return (
    <main>
      <div className="noise" />
      <header className="topbar">
        <a className="brand" href="#overview" aria-label={t.home}>
          <span className="brandMark"><i /><i /><i /></span><span><strong>SHELBY</strong><small>DIGITAL TWIN</small></span>
        </a>
        <div className="network"><span className="pulse" /> LIVE ENVIRONMENT <b>•</b> OPEN-METEO / CAMS</div>
        <div className="topActions">
          <div className="languagePicker" role="group" aria-label={t.language}>
            {(Object.keys(languageLabels) as Language[]).map((key) => (
              <button key={key} className={language === key ? "active" : ""} aria-pressed={language === key} onClick={() => setLanguage(key)}>{languageLabels[key]}</button>
            ))}
          </div>
          <a className="repoLink" href="https://github.com/sukodai1234/Shelby-Real-time-Digital-Twin-City-RWA-Oracle" target="_blank" rel="noreferrer">GITHUB ↗</a>
        </div>
      </header>

      <GlobalEnvironment language={language} onLocationChange={setUserLocation} />

      <section className="hero" id="overview">
        <div>
          <div className="eyebrow"><span>LIVE</span> {t.infrastructure} · {t.asset}</div>
          <h1>{t.headlineA}<br /><em>{t.headlineB}</em></h1>
          <p>{t.intro}</p>
        </div>
        <div className="heroMeta">
          <div><span>{t.location}</span><strong>{userLocation.status === "resolved" ? `${userLocation.location.name}${userLocation.location.country ? `, ${userLocation.location.country}` : ""}` : userLocation.status === "locating" ? t.placeLocating : userLocation.status === "denied" ? t.placeDenied : t.placeUnavailable}</strong>{userLocation.status === "resolved" && <small>{userLocation.source === "gps" ? "GPS · " : ""}{userLocation.location.lat.toFixed(4)}, {userLocation.location.lon.toFixed(4)}</small>}</div>
          <div><span>{t.lastUpdate}</span><strong>{now} · {running ? t.streaming : t.paused}</strong></div>
        </div>
      </section>

      <section className="controlRow" aria-label={t.controls}>
        <div className="scenarioCluster">
          <div className="scenarioPicker"><span>{t.scenario}</span>
            {(Object.keys(scenarioData) as Scenario[]).map((key) => (
              <button key={key} className={scenario === key ? "active" : ""} aria-pressed={scenario === key} onClick={() => setScenario(key)}>{t.scenarios[key][1]}</button>
            ))}
          </div>
          <p className="scenarioExplanation"><b>ⓘ {t.scenarios[scenario][0]}:</b> {t.scenarioDescriptions[scenario]} <small>{t.scenarioHelp}</small></p>
        </div>
        <button className={`streamButton ${running ? "running" : ""}`} onClick={() => setRunning(!running)}><span>{running ? "Ⅱ" : "▶"}</span>{running ? t.pause : t.resume}</button>
      </section>

      <section className="dashboard">
        <article className="riskCard">
          <div className="cardHead"><span>{t.riskIndex}</span><b style={{ color: active.color }}>{t.scenarios[scenario][0]}</b></div>
          <div className="riskValue"><strong style={{ color: active.color }}>{Math.round(active.risk + jitter(5, 2))}</strong><span>/ 100<br />{t.riskScore}</span></div>
          <Sparkline risk={active.risk} color={active.color} label={t.chart} />
          <div className="chartAxis"><span>{t.cyclesAgo}</span><span>{t.current}</span></div>
        </article>
        <div className="sensorGrid">
          {t.sensors.map(([label, unit], index) => (
            <article className="sensor" key={label}><div className="sensorIndex">0{index + 1}</div><span>{label}</span><strong>{values[index]}</strong><small>{unit}</small><div className="meter"><i style={{ width: `${Math.min(100, levels[index])}%`, background: active.color }} /></div></article>
          ))}
        </div>
      </section>

      <section className="proofStrip">
        {t.pipeline.map(([title, detail], index) => (
          <div className="proofStep" key={title}><span>0{index + 1}</span><div><strong>{title}</strong><small>{detail}</small></div><b className={running ? "verified" : "paused"}>{index === 3 ? t.anchored : t.verified}</b></div>
        ))}
      </section>
      <footer><span>{t.disclaimer}</span><code>{t.snapshot} {hash}</code></footer>
    </main>
  );
}
