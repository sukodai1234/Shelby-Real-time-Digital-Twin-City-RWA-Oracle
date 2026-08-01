"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";

type Language = "en" | "vi" | "zh";
type AlertLevel = "low" | "caution" | "high" | "danger";
type Thresholds = { low: number; caution: number; high: number; danger: number };

export type HealthGroupKey = "general" | "respiratory" | "elderly_child" | "pregnant";

const STORAGE_KEY = "shelby_health_group";
const DEFAULT_THRESHOLDS: Thresholds = { low: 0, caution: 30, high: 50, danger: 75 };
const HEALTH_GROUPS: Record<HealthGroupKey, { sensitivity: number }> = {
  general: { sensitivity: 1 },
  respiratory: { sensitivity: 0.65 },
  elderly_child: { sensitivity: 0.75 },
  pregnant: { sensitivity: 0.7 },
};

const copy = {
  en: {
    kicker: "PERSONALIZED BIO-SENSORY ALERT", title: "Health-aware warning thresholds",
    chooseTitle: "Personalize your health warning", chooseIntro: "Choose the group that best fits the person using this device. This changes warning thresholds, not the environmental BSI.",
    change: "CHANGE HEALTH GROUP", applied: "Thresholds for", localOnly: "Saved only in this browser · Not uploaded or anchored on-chain · Not a medical diagnosis",
    unavailable: "Waiting for a complete BSI reading from the selected location.", warningFrom: "Caution starts at BSI",
    levels: { low: "LOW", caution: "CAUTION", high: "HIGH", danger: "DANGER" },
    groups: {
      general: ["General", "Default environmental thresholds"],
      respiratory: ["Respiratory / cardiovascular", "Earlier alerts for air and heat exposure"],
      elderly_child: ["Elderly / children", "Earlier alerts for sensitive age groups"],
      pregnant: ["Pregnant", "Earlier precautionary alerts"],
    },
    advice: {
      low: "Safe for normal outdoor activity.", caution: "Limit prolonged outdoor activity; consider wearing a mask.",
      high: "Wear a mask and avoid strenuous outdoor activity.", danger: "Stay indoors, keep windows closed and use an air purifier if available.",
    },
  },
  vi: {
    kicker: "CẢNH BÁO CẢM QUAN CÁ NHÂN", title: "Ngưỡng cảnh báo theo sức khỏe",
    chooseTitle: "Cá nhân hóa cảnh báo sức khỏe", chooseIntro: "Chọn nhóm phù hợp với người đang sử dụng thiết bị. Lựa chọn này chỉ điều chỉnh ngưỡng cảnh báo, không thay đổi điểm BSI môi trường.",
    change: "ĐỔI NHÓM SỨC KHỎE", applied: "Ngưỡng áp dụng cho", localOnly: "Chỉ lưu trên trình duyệt này · Không tải lên hoặc neo on-chain · Không phải chẩn đoán y khoa",
    unavailable: "Đang chờ điểm BSI đầy đủ từ vị trí đã chọn.", warningFrom: "Bắt đầu thận trọng từ BSI",
    levels: { low: "THẤP", caution: "THẬN TRỌNG", high: "CAO", danger: "NGUY HIỂM" },
    groups: {
      general: ["Bình thường", "Dùng ngưỡng môi trường mặc định"],
      respiratory: ["Bệnh hô hấp / tim mạch", "Cảnh báo sớm hơn với không khí và nhiệt"],
      elderly_child: ["Người già / trẻ em", "Cảnh báo sớm cho nhóm tuổi nhạy cảm"],
      pregnant: ["Mang thai", "Cảnh báo phòng ngừa sớm hơn"],
    },
    advice: {
      low: "An toàn để hoạt động ngoài trời bình thường.", caution: "Nên hạn chế hoạt động ngoài trời kéo dài, cân nhắc đeo khẩu trang.",
      high: "Nên đeo khẩu trang và tránh vận động mạnh ngoài trời.", danger: "Nên ở trong nhà, đóng cửa sổ và dùng máy lọc không khí nếu có.",
    },
  },
  zh: {
    kicker: "个性化生物感知警报", title: "按健康状况调整警报阈值",
    chooseTitle: "个性化健康警报", chooseIntro: "请选择最符合本设备使用者的群体。该选择只调整警报阈值，不会改变环境 BSI 分数。",
    change: "更改健康群体", applied: "适用阈值群体", localOnly: "仅保存在此浏览器 · 不上传或写入链上 · 不构成医疗诊断",
    unavailable: "正在等待所选位置的完整 BSI 数据。", warningFrom: "注意阈值从 BSI 开始",
    levels: { low: "低", caution: "注意", high: "高", danger: "危险" },
    groups: {
      general: ["普通人群", "使用默认环境阈值"],
      respiratory: ["呼吸系统 / 心血管疾病", "对空气与热暴露更早预警"],
      elderly_child: ["老年人 / 儿童", "为敏感年龄群体更早预警"],
      pregnant: ["孕妇", "采用更早的预防性警报"],
    },
    advice: {
      low: "可正常进行户外活动。", caution: "减少长时间户外活动，并考虑佩戴口罩。",
      high: "佩戴口罩，避免剧烈户外运动。", danger: "尽量留在室内，关闭窗户，并在条件允许时使用空气净化器。",
    },
  },
} as const;

const groupKeys = Object.keys(HEALTH_GROUPS) as HealthGroupKey[];
const levelSymbols: Record<AlertLevel, string> = { low: "●", caution: "◆", high: "▲", danger: "!" };

export function getAdjustedThresholds(groupKey: HealthGroupKey): Thresholds {
  const factor = HEALTH_GROUPS[groupKey]?.sensitivity ?? 1;
  return {
    low: DEFAULT_THRESHOLDS.low,
    caution: Math.round(DEFAULT_THRESHOLDS.caution * factor),
    high: Math.round(DEFAULT_THRESHOLDS.high * factor),
    danger: Math.round(DEFAULT_THRESHOLDS.danger * factor),
  };
}

export function classifyPersonalizedBsi(score: number, groupKey: HealthGroupKey) {
  const thresholds = getAdjustedThresholds(groupKey);
  const level: AlertLevel = score >= thresholds.danger ? "danger" : score >= thresholds.high ? "high" : score >= thresholds.caution ? "caution" : "low";
  return { level, thresholds };
}

function isHealthGroup(value: string | null): value is HealthGroupKey {
  return value !== null && value in HEALTH_GROUPS;
}

function rangesFor(thresholds: Thresholds) {
  return {
    low: `1–${thresholds.caution - 1}`,
    caution: `${thresholds.caution}–${thresholds.high - 1}`,
    high: `${thresholds.high}–${thresholds.danger - 1}`,
    danger: `${thresholds.danger}–100`,
  };
}

export default function PersonalizedBsiAlert({ score, language }: { score: number | null; language: Language }) {
  const [healthGroup, setHealthGroup] = useState<HealthGroupKey | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const t = copy[language];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(STORAGE_KEY); } catch { /* Device-local preference is optional. */ }
      if (isHealthGroup(saved)) setHealthGroup(saved);
      else setShowPicker(true);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const personalized = useMemo(() => score === null || healthGroup === null ? null : classifyPersonalizedBsi(score, healthGroup), [score, healthGroup]);
  const ranges = personalized ? rangesFor(personalized.thresholds) : null;
  const severityClass = personalized?.level === "caution" ? "watch" : personalized?.level ?? "missing";
  const spectrumStyle = personalized && score !== null ? {
    "--score-position": `${score}%`,
    "--caution-position": `${personalized.thresholds.caution}%`,
    "--high-position": `${personalized.thresholds.high}%`,
    "--danger-position": `${personalized.thresholds.danger}%`,
  } as CSSProperties : undefined;

  function chooseGroup(groupKey: HealthGroupKey) {
    try { window.localStorage.setItem(STORAGE_KEY, groupKey); } catch { /* Continue without persistence when storage is blocked. */ }
    setHealthGroup(groupKey);
    setShowPicker(false);
  }

  return (
    <>
      <section className={`personalizedPanel severity-${severityClass}`} aria-live="polite">
        <header><div><span>{t.kicker}</span><h3>{t.title}</h3></div><button type="button" onClick={() => setShowPicker(true)}>{t.change}</button></header>
        {personalized && healthGroup && ranges ? (
          <div className="personalizedBody">
            <div className="personalizedAdvice">
              <div className="personalizedScore"><span>BSI</span><strong>{score}</strong><b>{t.levels[personalized.level]}</b></div>
              <p>{t.advice[personalized.level]}</p>
              <small>{t.applied}: <b>{t.groups[healthGroup][0]}</b></small>
            </div>
            <div className="personalizedScale" style={spectrumStyle}>
              <div className="bsiSpectrum" aria-hidden="true"><i><span>{score}</span></i></div>
              <div className="personalizedRanges">
                {(Object.keys(ranges) as AlertLevel[]).map((level) => <div key={level} className={`riskBand-${level} ${level === personalized.level ? "active" : ""}`}><i aria-hidden="true">{levelSymbols[level]}</i><span>{ranges[level]}</span><b>{t.levels[level]}</b></div>)}
              </div>
            </div>
          </div>
        ) : <p className="personalizedUnavailable">{t.unavailable}</p>}
        <footer>{t.localOnly}</footer>
      </section>

      {hydrated && showPicker && (
        <div className="healthModal" role="presentation">
          <section className="healthDialog" role="dialog" aria-modal="true" aria-labelledby="health-dialog-title">
            <span>{t.kicker}</span><h3 id="health-dialog-title">{t.chooseTitle}</h3><p>{t.chooseIntro}</p>
            <div className="healthOptions">
              {groupKeys.map((key) => {
                const thresholds = getAdjustedThresholds(key);
                return <button type="button" key={key} onClick={() => chooseGroup(key)} aria-pressed={healthGroup === key}><strong>{t.groups[key][0]}</strong><small>{t.groups[key][1]}</small><b>{t.warningFrom} {thresholds.caution}</b></button>;
              })}
            </div>
            <small className="healthPrivacy">{t.localOnly}</small>
          </section>
        </div>
      )}
    </>
  );
}
