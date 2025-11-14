import React, { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import "./App.css";
import {
  ResponsiveContainer,
  ComposedChart,
  Line as ReLine,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

/**
 * Ultimate Target — v4 (single-file React) — STABLE
 * - Fully self-contained; all JSX/comments closed; no dangling brackets.
 * - Preserves: presets, compare toggles, charts, PDF export, summary write-ups.
 * - Adds clear Key Insights including DIY vs Adviser (fees & time value) and Start vs Delay.
 * - Includes drawdown outlook + max sustainable spend.
 * - Minor refactors to reduce re-renders and ensure safety checks.
 */

// ================= Theme =================
const THEME = {
  dark: {
    pageBg: "#0b1220",
    pdfBg: "#000000",
    inputBg: "#000000",
    text: "#e6eefc",
    muted: "#9fb0d1",
    cardBg: "#111827",
    border: "#233054",
    chipBg: "#18223a",
    axis: "#9fb0d1",
    grid: "#233054",
    primary: "#2dd4bf",
    accent: "#60a5fa",
    gold: "#eab308",
    delay: "#f97316",
    danger: "#ef4444",
    success: "#10b981",
  },
  light: {
    pageBg: "#f7fafc",
    pdfBg: "#ffffff",
    inputBg: "#ffffff",
    text: "#0f172a",
    muted: "#475569",
    cardBg: "#ffffff",
    border: "#dbe2ef",
    chipBg: "#f1f5f9",
    axis: "#475569",
    grid: "#e5e7eb",
    primary: "#059669",
    accent: "#2563eb",
    gold: "#eab308",
    delay: "#f97316",
    danger: "#dc2626",
    success: "#059669",
  },
};

// ================= Utils =================
const clamp = (v, min, max) => Math.min(Math.max(Number(v) || 0, min), max);
const nz = (n, fb = 0) => (Number.isFinite(n) ? n : fb);
const fmtAUD = (n) =>
  "A$" + nz(n, 0).toLocaleString("en-AU", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
const fmtAxis = (v) => {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s =
    a >= 1e9
      ? (a / 1e9).toFixed(1) + "Bn"
      : a >= 1e6
      ? (a / 1e6).toFixed(1) + "M"
      : a >= 1e3
      ? Math.round(a / 1e3) + "k"
      : String(Math.round(a));
  return (n < 0 ? "-$" : "$") + s;
};

// ============== Simulation (monthly) =================
function simulate({
  currentAge,
  retirementAge,
  horizonYears,
  startAssets,
  monthlySave,
  preAnnualGross,
  postRealAnnualGross,
  inflationAnnual,
  annualSpendToday,
  delayYears,
  feeAnnualPre = 0,
  feeAnnualPost = 0,
  fixedFeeAnnual = 0,
}) {
  const months = Math.max(1, Math.round(horizonYears * 12));
  const preNet = Math.max(-0.99, preAnnualGross - feeAnnualPre);
  const postNominal = (1 + postRealAnnualGross) * (1 + inflationAnnual) - 1;
  const postNet = Math.max(-0.99, postNominal - feeAnnualPost);
  const mPre = Math.pow(1 + preNet, 1 / 12) - 1;
  const mPost = Math.pow(1 + postNet, 1 / 12) - 1;
  const mInfl = Math.pow(1 + inflationAnnual, 1 / 12) - 1;
  const mFix = Math.max(0, fixedFeeAnnual) / 12;
  const toRet = Math.max(0, Math.round((retirementAge - currentAge) * 12));
  const dly = Math.max(0, Math.round(delayYears * 12));

  const rows = [];
  let bal = Math.max(0, startAssets);
  let dep = null;
  rows.push({ age: Math.floor(currentAge), nominal: bal, real: bal });

  for (let m = 1; m <= months; m++) {
    const age = currentAge + m / 12;
    const pre = m <= toRet;
    const r = pre ? mPre : mPost;
    const c = pre && m > dly ? monthlySave : 0;
    const msr = Math.max(0, m - toRet);
    const sp = msr > 0 ? (annualSpendToday / 12) * Math.pow(1 + mInfl, msr) : 0;

    bal = bal * (1 + r) + c - sp - mFix;
    if (bal <= 0 && !dep) dep = age;
    if (bal < 0) bal = 0;

    if (m % 12 === 0) {
      const d = Math.pow(1 + mInfl, m);
      rows.push({ age: Math.floor(age), nominal: bal, real: bal / d });
    }
  }

  return {
    rows,
    endNom: bal,
    endReal: rows[rows.length - 1]?.real ?? bal,
    depletedAge: dep ? Math.floor(dep) : null,
    depletedAgeExact: dep,
  };
}

// ============== App ======================
export default function App() {
  const LS_KEY = "ut_v4";
  const THEME_KEY = "ut_theme_v4";

  // Theme
  const [dark, setDark] = useState(true);
  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t) setDark(t !== "light");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  const theme = dark ? THEME.dark : THEME.light;

  const TABS = { COMPOUND: "Compounding", FEES: "Fees", TARGET: "Ultimate Target" };
  const [tab, setTab] = useState(TABS.COMPOUND);

  // ---- State (defaults)
  const [client, setClient] = useState("");
  const [currentAge, setCurrentAge] = useState(40);
  const [retirementAge, setRetirementAge] = useState(60);
  const [lifeExpectancy, setLifeExpectancy] = useState(90);
  const [initialAmount, setInitialAmount] = useState(200000);
  const [monthlySave, setMonthlySave] = useState(1500);
  const [annualSpendToday, setAnnualSpendToday] = useState(60000);
  const [delayYears, setDelayYears] = useState(3);
  const [returnPa, setReturnPa] = useState(8.0);
  const [postRetRealPa, setPostRetRealPa] = useState(2.5);
  const [inflationPa, setInflationPa] = useState(0.0); // default 0 so nominal matrix = real

  const [diyFeePct, setDiyFeePct] = useState(0.2);
  const [diyFixed, setDiyFixed] = useState(0);
  const [advisorFeePct, setAdvisorFeePct] = useState(1.2);
  const [advisorFixed, setAdvisorFixed] = useState(2000);

  // View toggles
  const [compareAdv, setCompareAdv] = useState(false); // in TARGET tab: DIY vs Adviser
  const [activePreset, setActivePreset] = useState("");

  // ---- Persist & URL import
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const s = url.searchParams.get("state");
      if (s) {
        const parsed = JSON.parse(atob(s));
        applyState(parsed);
        return; // don't also load LS this time
      }
      const r = localStorage.getItem(LS_KEY);
      if (r) applyState(JSON.parse(r));
    } catch {}
    // eslint-disable-next-line
  }, []);

  const snapshot = () => ({
    client,
    currentAge,
    retirementAge,
    lifeExpectancy,
    initialAmount,
    monthlySave,
    annualSpendToday,
    delayYears,
    returnPa,
    postRetRealPa,
    inflationPa,
    diyFeePct,
    diyFixed,
    advisorFeePct,
    advisorFixed,
    tab,
    compareAdv,
    dark,
    activePreset,
  });

  const applyState = (s) => {
    if (!s) return;
    setClient(s.client ?? "");
    setCurrentAge(s.currentAge ?? 40);
    setRetirementAge(s.retirementAge ?? 60);
    setLifeExpectancy(s.lifeExpectancy ?? 90);
    setInitialAmount(s.initialAmount ?? 200000);
    setMonthlySave(s.monthlySave ?? 1500);
    setAnnualSpendToday(s.annualSpendToday ?? 60000);
    setDelayYears(s.delayYears ?? 3);
    setReturnPa(s.returnPa ?? 8);
    setPostRetRealPa(s.postRetRealPa ?? 2.5);
    setInflationPa(s.inflationPa ?? 0);
    setDiyFeePct(s.diyFeePct ?? 0.2);
    setDiyFixed(s.diyFixed ?? 0);
    setAdvisorFeePct(s.advisorFeePct ?? 1.2);
    setAdvisorFixed(s.advisorFixed ?? 2000);
    setTab(s.tab ?? TABS.COMPOUND);
    setCompareAdv(!!s.compareAdv);
    setDark(s.dark ?? true);
    setActivePreset(s.activePreset ?? "");
  };

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(snapshot()));
    } catch {}
    // eslint-disable-next-line
  }, [client, currentAge, retirementAge, lifeExpectancy, initialAmount, monthlySave, annualSpendToday, delayYears, returnPa, postRetRealPa, inflationPa, diyFeePct, diyFixed, advisorFeePct, advisorFixed, tab, compareAdv, dark, activePreset]);

  const themeCard = {
    background: theme.cardBg,
    border: `1px solid ${theme.border}`,
    borderRadius: 16,
    padding: 16,
  };
  const horizonYears = Math.max(1, lifeExpectancy - currentAge);

  // ---- Presets (nominal matrix; inflation forced to 0 so nominal==real in sim)
  const applyPreset = (key) => {
    if (key === "Conservative") {
      setReturnPa(6.0);
      setPostRetRealPa(4.0);
      setInflationPa(0.0);
    } else if (key === "Balanced") {
      setReturnPa(7.5);
      setPostRetRealPa(5.0);
      setInflationPa(0.0);
    } else if (key === "Growth") {
      setReturnPa(10.0);
      setPostRetRealPa(6.0);
      setInflationPa(0.0);
    }
    setActivePreset(key);
  };

  // ---- Scenarios ----
  const mk = (d, feeP, feeF) =>
    simulate({
      currentAge,
      retirementAge,
      horizonYears,
      startAssets: Math.max(0, initialAmount),
      monthlySave,
      preAnnualGross: Math.max(0, returnPa) / 100,
      postRealAnnualGross: postRetRealPa / 100,
      inflationAnnual: Math.max(0, inflationPa) / 100,
      annualSpendToday: Math.max(0, annualSpendToday),
      delayYears: d,
      feeAnnualPre: Math.max(0, feeP) / 100,
      feeAnnualPost: Math.max(0, feeP) / 100,
      fixedFeeAnnual: Math.max(0, feeF),
    });

  const comp_now = useMemo(
    () => mk(0, diyFeePct, 0),
    [currentAge, retirementAge, horizonYears, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, annualSpendToday, diyFeePct]
  );
  const comp_delay = useMemo(
    () => mk(Math.max(0, delayYears), diyFeePct, 0),
    [currentAge, retirementAge, horizonYears, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, annualSpendToday, delayYears, diyFeePct]
  );
  const fees_diy = useMemo(
    () => mk(0, diyFeePct, diyFixed),
    [currentAge, retirementAge, horizonYears, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, annualSpendToday, diyFeePct, diyFixed]
  );
  const fees_advisor = useMemo(
    () => mk(0, advisorFeePct, advisorFixed),
    [currentAge, retirementAge, horizonYears, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, annualSpendToday, advisorFeePct, advisorFixed]
  );
  const ut_diy_now = useMemo(
    () => mk(0, Math.max(0, diyFeePct), Math.max(0, diyFixed)),
    [currentAge, retirementAge, horizonYears, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, annualSpendToday, diyFeePct, diyFixed]
  );
  const ut_diy_delay = useMemo(
    () => mk(Math.max(0, delayYears), Math.max(0, diyFeePct), Math.max(0, diyFixed)),
    [currentAge, retirementAge, horizonYears, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, annualSpendToday, delayYears, diyFeePct, diyFixed]
  );
  const ut_adv_now = useMemo(
    () => mk(0, Math.max(0, advisorFeePct), Math.max(0, advisorFixed)),
    [currentAge, retirementAge, horizonYears, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, annualSpendToday, advisorFeePct, advisorFixed]
  );

  const ut_now = ut_diy_now;
  const ut_delay = ut_diy_delay;

  // ---- Sustainable Spend (binary search)
  const sustainableSpendToday = useMemo(() => {
    const p = {
      currentAge,
      retirementAge,
      horizonYears,
      startAssets: Math.max(0, initialAmount),
      monthlySave,
      preAnnualGross: Math.max(0, returnPa) / 100,
      postRealAnnualGross: postRetRealPa / 100,
      inflationAnnual: Math.max(0, inflationPa) / 100,
      delayYears: Math.max(0, delayYears),
      feeAnnualPre: Math.max(0, diyFeePct) / 100,
      feeAnnualPost: Math.max(0, diyFeePct) / 100,
      fixedFeeAnnual: 0,
    };
    const sim = (s) => simulate({ ...p, annualSpendToday: s });
    const zero = sim(0);
    if (zero.depletedAge && zero.depletedAge <= lifeExpectancy) return 0;
    let lo = 0,
      hi = 100000,
      max = 5e7,
      tol = 0.1;
    const lasts = (s) => {
      const t = sim(s);
      const d = t.depletedAgeExact == null ? Infinity : t.depletedAgeExact;
      return d >= lifeExpectancy - tol;
    };
    while (lasts(hi) && hi < max) hi *= 2;
    if (hi >= max) return hi;
    for (let i = 0; i < 34; i++) {
      const m = (lo + hi) / 2;
      if (lasts(m)) lo = m;
      else hi = m;
    }
    return Math.round(lo);
  }, [currentAge, retirementAge, lifeExpectancy, horizonYears, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, delayYears, diyFeePct]);

  // ---- Chart rows & ticks ----
  const startAge = useMemo(() => Math.round(currentAge), [currentAge]);
  const endAge = useMemo(() => Math.round(lifeExpectancy), [lifeExpectancy]);
  const ageTicks = useMemo(() => {
    const span = Math.max(1, endAge - startAge);
    const maxTicks = 12;
    const step = Math.max(1, Math.ceil(span / maxTicks));
    const arr = [];
    for (let a = startAge; a <= endAge; a += step) arr.push(a);
    if (arr[arr.length - 1] !== endAge) arr.push(endAge);
    return arr;
  }, [startAge, endAge]);

  const selectRows = () => {
    if (tab === TABS.FEES) {
      return { A: fees_diy.rows, B: fees_advisor.rows };
    }
    if (tab === TABS.TARGET) {
      return compareAdv ? { A: ut_diy_now.rows, B: ut_adv_now.rows } : { A: ut_diy_now.rows, B: ut_diy_delay.rows };
    }
    return { A: comp_now.rows, B: comp_delay.rows };
  };

  const { A, B } = selectRows();
  const chartRows = useMemo(() => {
    const map = new Map();
    A.forEach((r) => map.set(r.age, { age: r.age, baseNominal: r.nominal, baseReal: r.real }));
    if (B && B.length) {
      B.forEach((r) => {
        const p = map.get(r.age) || { age: r.age };
        map.set(r.age, { ...p, compareNominal: r.nominal });
      });
    }
    return Array.from(map.values()).sort((x, y) => x.age - y.age);
  }, [A, B]);

  // ---- Labels & key metrics ----
  const baseLabel =
    tab === TABS.COMPOUND
      ? "Start Now (Nominal)"
      : tab === TABS.FEES
      ? "DIY — Net (Nominal)"
      : compareAdv
      ? "DIY — Start Now (Nominal)"
      : "Start Now — with Spend (Nominal)";
  const compareLabel =
    tab === TABS.COMPOUND
      ? `Delay ${delayYears}y (Nominal)`
      : tab === TABS.FEES
      ? "Adviser — Net (Nominal)"
      : compareAdv
      ? "Adviser — Start Now (Nominal)"
      : `Delay ${delayYears}y — with Spend (Nominal)`;

  const isTargetStartVsDelay = tab === TABS.TARGET && !compareAdv;
  const isFeesTab = tab === TABS.FEES;
  const compareStroke = isTargetStartVsDelay || isFeesTab ? theme.danger : theme.delay;
  const compareDash = isTargetStartVsDelay ? "8 4" : isFeesTab ? "4 4" : undefined;

  const atRet = (rows) => rows.find((r) => r.age === retirementAge) || rows.find((r) => r.age > retirementAge) || rows[rows.length - 1];
  const atRet_now = atRet(comp_now.rows);
  const atRet_delay = atRet(comp_delay.rows);
  const atRet_diy = atRet(fees_diy.rows);
  const atRet_adv = atRet(fees_advisor.rows);
  const atRet_ut_diy = atRet(ut_diy_now.rows);
  const atRet_ut_adv = atRet(ut_adv_now.rows);

  const costOfDelayAtRet = Math.max(0, (atRet_now?.nominal || 0) - (atRet_delay?.nominal || 0));
  const feeDragAtRet = Math.max(0, (atRet_diy?.nominal || 0) - (atRet_adv?.nominal || 0));
  const feeDragAtHorizon = Math.max(0, fees_diy.endNom - fees_advisor.endNom);
  const feeDragRetPct = (atRet_diy?.nominal || 0) > 0 ? Math.round((feeDragAtRet / atRet_diy.nominal) * 100) : 0;
  const feeDragHznPct = (fees_diy.endNom || 0) > 0 ? Math.round((feeDragAtHorizon / fees_diy.endNom) * 100) : 0;

  const annualSavings = Math.max(0, monthlySave * 12);
  const nominalRetirementBalance = nz(atRet_now?.nominal, 0);
  const realRetirementBalance = nz(atRet_now?.real, 0);
  const nominalEndBalance = nz(comp_now.endNom, 0);
  const realEndBalance = nz(comp_now.endReal, 0);

  // ---- Exports ----
  const pdfRef = useRef(null);

  const exportPDF = async () => {
    const n = pdfRef.current;
    if (!n) return;
    const canvas = await html2canvas(n, { scale: 2, backgroundColor: theme.pdfBg || theme.pageBg });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth - 40; // margins
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= pageHeight - 40) {
      pdf.addImage(imgData, "PNG", 20, 20, imgWidth, imgHeight);
    } else {
      // paginate
      let remainingHeight = imgHeight;
      const ratio = imgWidth / canvas.width;
      const sliceHeight = (pageHeight - 40) / ratio;
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      const pageCtx = pageCanvas.getContext("2d");
      let sy = 0;
      while (remainingHeight > 0) {
        pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
        pageCtx.drawImage(canvas, 0, sy, canvas.width, sliceHeight, 0, 0, pageCanvas.width, pageCanvas.height);
        const pageImg = pageCanvas.toDataURL("image/png");
        pdf.addImage(pageImg, "PNG", 20, 20, imgWidth, pageHeight - 40);
        remainingHeight -= pageHeight - 40;
        sy += sliceHeight;
        if (remainingHeight > 0) pdf.addPage();
      }
    }

    const fn = `${client ? client.replace(/[^a-z0-9]+/gi, "_") + "_" : ""}UltimateTarget_${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;
    pdf.save(fn);
  };

  // ---- UI ----
  const QuickButton = ({ onClick, children, title }) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        border: `1px solid ${theme.border}`,
        background: theme.cardBg,
        color: theme.text,
        padding: "8px 12px",
        borderRadius: 12,
        cursor: "pointer",
        fontWeight: 700,
      }}
    >
      {children}
    </button>
  );

  const Chip = ({ children, tone }) => (
    <div
      style={{
        background: theme.chipBg,
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: "10px 12px",
        fontWeight: 700,
        color: tone === "danger" ? theme.danger : tone === "success" ? theme.success : theme.text,
      }}
    >
      {children}
    </div>
  );

  const content = (
    <div className={`ut-shell ${dark ? "ut-shell--dark" : "ut-shell--light"}`}>
      <div className="ut-card" style={{ background: theme.pageBg, color: theme.text }}>
        {/* Sticky header */}
        <div style={{ position: "sticky", top: 0, zIndex: 5, paddingBottom: 8, background: theme.pageBg }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Ultimate Target — Compounding • Fees • Target</h1>
              <p style={{ margin: 0, color: theme.muted, fontSize: 12 }}>
                Type exact values or drag sliders. Auto‑save on. Shift+↑/↓ steps x10.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <QuickButton onClick={() => setDark((d) => !d)} title="Toggle Night/Day">
                {dark ? "🌙 Night" : "☀️ Day"}
              </QuickButton>
              <QuickButton onClick={exportPDF} title="Export PDF for clients">📄 PDF</QuickButton>
            </div>
          </header>

          {/* Presets & Tabs */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {["Conservative", "Balanced", "Growth"].map((p) => (
                <button
                  key={p}
                  onClick={() => applyPreset(p)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: `1px solid ${theme.border}`,
                    background: activePreset === p ? theme.primary : theme.cardBg,
                    color: activePreset === p ? "#fff" : theme.text,
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[TABS.COMPOUND, TABS.FEES, TABS.TARGET].map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: `1px solid ${theme.border}`,
                    cursor: "pointer",
                    background: tab === t ? theme.primary : theme.cardBg,
                    color: tab === t ? "#fff" : theme.text,
                    fontWeight: 700,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Report wrapper for PDF */}
        <div ref={pdfRef}>
          {/* At-a-glance cards */}
          <section style={{ ...themeCard, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
              <Chip>
                👤 To Retirement: <strong>{Math.max(0, retirementAge - currentAge)}</strong> yrs
              </Chip>
              <Chip>
                💰 Invested to Retire: <strong>{fmtAUD(monthlySave * 12 * Math.max(0, retirementAge - currentAge))}</strong>
              </Chip>
              <Chip>
                📈 Balance @ {retirementAge}: <strong>{fmtAUD(nominalRetirementBalance)}</strong>
              </Chip>
              <Chip>
                🏁 Sustainable Spend: <strong>{fmtAUD(sustainableSpendToday)}</strong> (today $)
              </Chip>
            </div>
          </section>

          {/* Controls */}
          <section style={{ ...themeCard, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  placeholder="Client name (optional)"
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  style={{ flex: 1, borderRadius: 12, border: `1px solid ${theme.border}`, padding: "10px 12px", background: theme.pageBg, color: theme.text }}
                />
              </div>

              {/* (Compare buttons moved to chart area below) */}

              <RangePair
                id="curAge"
                label="Current Age"
                value={currentAge}
                onChange={(v) => setCurrentAge(clamp(v, 0, retirementAge - 1))}
                theme={theme}
                min={0}
                max={Math.max(1, retirementAge - 1)}
                step={1}
              />
              <RangePair
                id="retAge"
                label="Retirement Age"
                value={retirementAge}
                onChange={(v) => setRetirementAge(clamp(v, currentAge + 1, 100))}
                theme={theme}
                min={currentAge + 1}
                max={100}
                step={1}
              />
              <RangePair
                id="lifeExp"
                label="Life Expectancy (age)"
                value={lifeExpectancy}
                onChange={(v) => setLifeExpectancy(clamp(v, retirementAge + 1, 110))}
                theme={theme}
                min={retirementAge + 1}
                max={110}
                step={1}
              />
              <RangePair
                id="initial"
                label="Initial Amount"
                value={initialAmount}
                onChange={(v) => setInitialAmount(clamp(v, 0, 5_000_000))}
                theme={theme}
                min={0}
                max={5_000_000}
                step={5000}
                money
              />
              <RangePair
                id="msave"
                label="Monthly Savings / Investments"
                value={monthlySave}
                onChange={(v) => setMonthlySave(clamp(v, 0, 25_000))}
                theme={theme}
                min={0}
                max={25_000}
                step={100}
                money
              />
              <RangePair
                id="ret"
                label="Expected Return (% p.a., pre‑ret, gross)"
                value={returnPa}
                onChange={(v) => setReturnPa(clamp(Number(v), 0, 20))}
                theme={theme}
                min={0}
                max={20}
                step={0.1}
              />
              <RangePair
                id="postReal"
                label="Retirement Return (% p.a., treated as nominal)"
                value={postRetRealPa}
                onChange={(v) => setPostRetRealPa(clamp(Number(v), -5, 15))}
                theme={theme}
                min={-5}
                max={15}
                step={0.1}
              />
              <RangePair
                id="infl"
                label="Inflation (% p.a.)"
                value={inflationPa}
                onChange={(v) => setInflationPa(clamp(Number(v), 0, 10))}
                theme={theme}
                min={0}
                max={10}
                step={0.1}
              />

              {tab !== TABS.FEES && (
                <RangePair
                  id="delay"
                  label="Start Delay (years)"
                  value={delayYears}
                  onChange={(v) => setDelayYears(clamp(v, 0, 15))}
                  theme={theme}
                  min={0}
                  max={15}
                  step={1}
                />
              )}

              {tab === TABS.TARGET && (
                <RangePair
                  id="spend"
                  label="Annual Spend (today $)"
                  value={annualSpendToday}
                  onChange={(v) => setAnnualSpendToday(clamp(v, 0, 1_300_000))}
                  theme={theme}
                  min={0}
                  max={1_300_000}
                  step={1000}
                  money
                />
              )}

              {tab === TABS.FEES && (
                <div style={{ gridColumn: "1 / -1", display: "grid", gap: 12, gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
                  <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>DIY (Do It Yourself)</div>
                    <RangePair
                      id="diyfee"
                      label={<span style={{ fontWeight: 700, fontSize: 15 }}>DIY Total Fee (% p.a.)</span>}
                      value={diyFeePct}
                      onChange={(v) => setDiyFeePct(clamp(v, 0, 2))}
                      theme={theme}
                      min={0}
                      max={2}
                      step={0.05}
                    />
                    <RangePair
                      id="diyfix"
                      label={<span style={{ fontWeight: 700, fontSize: 15 }}>DIY Fixed Fee ($/yr)</span>}
                      value={diyFixed}
                      onChange={(v) => setDiyFixed(clamp(v, 0, 10000))}
                      theme={theme}
                      min={0}
                      max={10000}
                      step={100}
                      money
                    />
                  </div>
                  <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Adviser Managed</div>
                    <RangePair
                      id="advfee"
                      label={<span style={{ fontWeight: 700, fontSize: 15 }}>Adviser Total Fee (% p.a.)</span>}
                      value={advisorFeePct}
                      onChange={(v) => setAdvisorFeePct(clamp(v, 0, 3))}
                      theme={theme}
                      min={0}
                      max={3}
                      step={0.05}
                    />
                    <RangePair
                      id="advfix"
                      label={<span style={{ fontWeight: 700, fontSize: 15 }}>Adviser Fixed Fee ($/yr)</span>}
                      value={advisorFixed}
                      onChange={(v) => setAdvisorFixed(clamp(v, 0, 10000))}
                      theme={theme}
                      min={0}
                      max={10000}
                      step={100}
                      money
                    />
                  </div>
                </div>
              )}
            </div>
            <p style={{ color: theme.muted, fontSize: 12, marginTop: 8 }}>
              Presets use <strong>nominal</strong> return matrix and set inflation to 0. You can re‑enable inflation if needed.
            </p>
          </section>

          {/* Chart */}
          <section style={{ ...themeCard, marginTop: 10 }} aria-labelledby="chartTitle">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 id="chartTitle" style={{ margin: 0 }}>
                {tab === TABS.COMPOUND
                  ? "Compounding: Start Now vs Delay"
                  : tab === TABS.FEES
                  ? "Fees: DIY vs Adviser"
                  : compareAdv
                  ? "Ultimate Target: DIY vs Adviser (Start Now)"
                  : "DIY Ultimate Target: Start Now vs Delay (with Spend)"}
              </h2>

              {/* Compare toggles in chart header */}
              {tab === TABS.TARGET && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: theme.muted, fontSize: 13 }}>Compare:</span>
                  <button
                    onClick={() => setCompareAdv(false)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 10,
                      border: `1px solid ${theme.border}`,
                      background: !compareAdv ? theme.primary : theme.cardBg,
                      color: !compareAdv ? "#fff" : theme.text,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Start vs Delay
                  </button>
                  <button
                    onClick={() => setCompareAdv(true)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 10,
                      border: `1px solid ${theme.border}`,
                      background: compareAdv ? theme.primary : theme.cardBg,
                      color: compareAdv ? "#fff" : theme.text,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    DIY vs Adviser
                  </button>
                </div>
              )}
            </div>

            <div style={{ width: "100%", height: 460 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartRows} margin={{ top: 40, right: 24, left: 12, bottom: 24 }}>
                  <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="age"
                    domain={[startAge, endAge]}
                    ticks={ageTicks}
                    interval={0}
                    allowDecimals={false}
                    tickFormatter={(t) => `${t}`}
                    tick={{ fill: theme.axis }}
                    minTickGap={12}
                    tickMargin={8}
                  />
                  <YAxis tickFormatter={fmtAxis} tick={{ fill: theme.axis }} />
                  <Tooltip
                    formatter={(v, n) => [fmtAUD(v), n]}
                    labelFormatter={(l) => `Age ${l}`}
                    contentStyle={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
                  />
                  <Legend verticalAlign="top" align="right" wrapperStyle={{ color: theme.text }} />
                  <ReLine type="monotone" dataKey="baseNominal" name={baseLabel} stroke={theme.accent} strokeWidth={3} dot={false} />
                  <ReLine type="monotone" dataKey="baseReal" name={"Start Now — Real $"} stroke={theme.primary} strokeWidth={3} strokeDasharray="6 6" dot={false} />
                  <ReLine
                    type="monotone"
                    dataKey="compareNominal"
                    name={compareLabel}
                    stroke={compareStroke}
                    strokeWidth={3}
                    strokeDasharray={compareDash}
                    dot={false}
                  />
                  <ReferenceLine
                    x={retirementAge}
                    stroke={theme.gold}
                    strokeWidth={3}
                    strokeDasharray="6 3"
                    ifOverflow="extendDomain"
                    isFront
                    label={{ value: `Retirement ${retirementAge}`, position: "insideTop", dy: 14, fill: theme.gold, fontWeight: 800 }}
                  />
                  <ReferenceLine
                    x={lifeExpectancy}
                    stroke={theme.axis}
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    ifOverflow="extendDomain"
                    isFront
                    label={{ value: `Life Exp. ${lifeExpectancy}`, position: "insideTopRight", dy: 14, fill: theme.axis, fontWeight: 600 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Callouts */}
            {tab === TABS.COMPOUND && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginTop: 12 }}>
                <Chip>Start Now @ Retirement: {fmtAUD(atRet_now?.nominal || 0)}</Chip>
                <Chip>Delay {delayYears}y @ Retirement: {fmtAUD(atRet_delay?.nominal || 0)}</Chip>
                <Chip tone="danger">Cost of Delay: {fmtAUD(costOfDelayAtRet)}</Chip>
              </div>
            )}
            {tab === TABS.FEES && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginTop: 12 }}>
                <Chip>DIY @ Retirement: {fmtAUD(atRet_diy?.nominal || 0)}</Chip>
                <Chip>Adviser @ Retirement: {fmtAUD(atRet_adv?.nominal || 0)}</Chip>
                <Chip tone="danger">Fee Drag (to retirement): {fmtAUD(Math.max(0, (atRet_diy?.nominal || 0) - (atRet_adv?.nominal || 0)))} ({feeDragRetPct}%)</Chip>
                <Chip tone="danger">Fee Drag (to horizon): {fmtAUD(Math.max(0, fees_diy.endNom - fees_advisor.endNom))} ({feeDragHznPct}%)</Chip>
                <Chip>DIY @ Horizon: {fmtAUD(fees_diy.endNom)}</Chip>
                <Chip>Adviser @ Horizon: {fmtAUD(fees_advisor.endNom)}</Chip>
              </div>
            )}
            {tab === TABS.TARGET && (
              compareAdv ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginTop: 12 }}>
                  <Chip>DIY @ Retirement: {fmtAUD(atRet_ut_diy?.nominal || 0)}</Chip>
                  <Chip>Adviser @ Retirement: {fmtAUD(atRet_ut_adv?.nominal || 0)}</Chip>
                  <Chip tone="danger">Fee Drag (Start Now): {fmtAUD(Math.max(0, (atRet_ut_diy?.nominal || 0) - (atRet_ut_adv?.nominal || 0)))}</Chip>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginTop: 12 }}>
                  <Chip>
                    <strong>Sustainable Spend (today $):</strong> {fmtAUD(sustainableSpendToday)}
                  </Chip>
                  {ut_now.depletedAge ? (
                    <Chip tone="danger">Start Now: Depletes ~ Age {ut_now.depletedAge}</Chip>
                  ) : (
                    <Chip tone="success">Start Now: Funds last beyond {lifeExpectancy}</Chip>
                  )}
                  {ut_delay.depletedAge ? (
                    <Chip tone="danger">Delay {delayYears}y: Depletes ~ Age {ut_delay.depletedAge}</Chip>
                  ) : (
                    <Chip tone="success">Delay {delayYears}y: Funds last beyond {lifeExpectancy}</Chip>
                  )}
                </div>
              )
            )}
          </section>

          {/* Summary — Key Insights (clean, concise) */}
          <section style={{ ...themeCard, marginTop: 10 }} aria-labelledby="keyInsightsTitle">
            <h2 id="keyInsightsTitle" style={{ marginTop: 0 }}>Summary — Key Insights</h2>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                🟦 <strong>Retirement Line:</strong> Age <strong>{retirementAge}</strong> — you have <strong>{Math.max(0, retirementAge - currentAge)}</strong> years to retirement.
              </li>
              <li>🟦 <strong>Life Expectancy:</strong> Age <strong>{lifeExpectancy}</strong>.</li>
              <li>
                💰 <strong>Annual Savings / Investments:</strong> <span style={{ fontWeight: 800 }}>{fmtAUD(annualSavings)}</span>.
              </li>
              <li>
                💼 <strong>Total Principal Invested (to retirement):</strong> <span style={{ fontWeight: 800 }}>{fmtAUD(monthlySave * 12 * Math.max(0, retirementAge - currentAge))}</span>.
              </li>
              <li>
                📈 <strong>Balance at Retirement (nominal):</strong> <span style={{ fontWeight: 800 }}>{fmtAUD(nominalRetirementBalance)}</span> — <span style={{ color: theme.muted }}>real:</span> {fmtAUD(realRetirementBalance)}.
              </li>
              <li>
                🧭 <strong>Projected End Balance (nominal):</strong> {fmtAUD(nominalEndBalance)} — <span style={{ color: theme.muted }}>real:</span> {fmtAUD(realEndBalance)}.
              </li>
              <li>
                📊 <strong>Drawdown outlook:</strong> Funds are projected to last <strong>{ut_now.depletedAge ? `until about age ${ut_now.depletedAge}` : `beyond age ${lifeExpectancy}`}</strong> under current settings.
              </li>
              <li>
                💵 <strong>Max sustainable annual spend (today $):</strong> <span style={{ fontWeight: 800 }}>{fmtAUD(sustainableSpendToday)}</span> — to last until around <strong>age {lifeExpectancy}</strong>.
              </li>
            </ul>

            {/* Clear write-ups */}
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
              {/* Start Now vs Delay */}
              <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, background: theme.cardBg }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>⏳ Start Now vs Delay</div>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                  <li>
                    <strong>Cost of waiting:</strong> Delaying <strong>{delayYears}</strong> years reduces your balance at retirement by about {" "}
                    <strong style={{ color: theme.danger }}>{fmtAUD(costOfDelayAtRet)}</strong>.
                  </li>
                  <li>
                    <strong>Plain English:</strong> Starting earlier means more months enjoying returns; waiting misses that compounding window, which you cannot get back later.
                  </li>
                </ul>
              </div>

              {/* DIY vs Adviser — Fees & Time Value */}
              <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, background: theme.cardBg }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>👥 DIY vs Adviser — Fees & Time Value</div>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                  <li>
                    <strong>At retirement:</strong> Adviser leaves about {" "}
                    <strong style={{ color: theme.danger }}>{fmtAUD(feeDragAtRet)}</strong> less than DIY (<strong>{feeDragRetPct}%</strong> drag).
                  </li>
                  <li>
                    <strong>Over the full horizon:</strong> Adviser leaves about {" "}
                    <strong style={{ color: theme.danger }}>{fmtAUD(feeDragAtHorizon)}</strong> less than DIY (~<strong>{feeDragHznPct}%</strong> of the DIY outcome).
                  </li>
                  <li style={{ color: theme.muted }}>
                    DIY fees: {diyFeePct}% + {fmtAUD(diyFixed)} /yr • Adviser fees: {advisorFeePct}% + {fmtAUD(advisorFixed)} /yr
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </div>

        <footer style={{ color: theme.muted, fontSize: 12, padding: "10px 2px", textAlign: "center", lineHeight: 1.6 }}>
          © 2025 Ultimate Target · Educational only — not financial advice · Built by Michael Leggo.
        </footer>
      </div>
    </div>
  );

  return <PasswordGate>{content}</PasswordGate>;
}

// ============== Input (range + number) ===================
function RangePair({ label, value, onChange, id, theme, min, max, step = 1, money = false, disabled = false, hint }) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(String(value));
  }, [value, focus]);

  const commit = () => {
    const raw = money ? Number(String(text).replace(/[^0-9]/g, "")) : Number(text);
    const v = Number.isFinite(raw) ? raw : value;
    const c = clamp(v, min, max);
    onChange(c);
    setText(String(c));
  };
  const bump = (d, mult = 1) => {
    const n = clamp((Number(value) || 0) + d * step * mult, min, max);
    onChange(n);
    setText(String(n));
  };
  const display = money ? (focus ? text : fmtAUD(Number(text) || 0).replace(/^A\$/, "$")) : text;
  const sliderFill = ((Number(value) - min) / Math.max(1, max - min)) * 100;
  const sliderFillClamped = Math.min(100, Math.max(0, sliderFill));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 13, color: theme.muted, display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        {hint ? <span style={{ opacity: 0.7 }}>{hint}</span> : null}
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
        <input
          id={id}
          type="range"
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
          className="ut-range"
          style={{
            "--range-fill": `${sliderFillClamped}%`,
            "--range-color": theme.accent,
            "--range-track": theme.border,
            "--range-thumb": theme.inputBg || theme.pageBg,
            "--range-thumb-border": theme.accent,
          }}
        />
        <input
          type={money ? "text" : "number"}
          disabled={disabled}
          inputMode={money ? "numeric" : undefined}
          value={display}
          onFocus={() => {
            setFocus(true);
            if (money) setText(String(value));
          }}
          onChange={(e) => {
            const r = e.target.value;
            setText(r);
            if (!money) {
              const n = Number(r);
              if (!Number.isNaN(n)) onChange(clamp(n, min, max));
            }
          }}
          onBlur={() => {
            setFocus(false);
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              bump(e.key === "ArrowUp" ? +1 : -1, e.shiftKey ? 10 : 1);
            }
          }}
          style={{
            width: 160,
            borderRadius: 12,
            border: `1px solid ${theme.border}`,
            padding: "8px 10px",
            background: theme.inputBg || theme.pageBg,
            color: theme.text,
          }}
        />
      </div>
    </div>
  );
}

// ============== Tiny test harness ===================
(function runTests() {
  try {
    const base = simulate({
      currentAge: 40,
      retirementAge: 60,
      horizonYears: 50,
      startAssets: 200000,
      monthlySave: 1500,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0.0,
      annualSpendToday: 0,
      delayYears: 0,
      feeAnnualPre: 0.002,
      feeAnnualPost: 0.002,
      fixedFeeAnnual: 0,
    });
    console.assert(base.rows.length > 0, "simulate should return rows");
    console.assert(typeof base.endNom === "number", "endNom should be number");

    const delayed = simulate({
      currentAge: 40,
      retirementAge: 60,
      horizonYears: 50,
      startAssets: 200000,
      monthlySave: 1500,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0.0,
      annualSpendToday: 0,
      delayYears: 3,
      feeAnnualPre: 0.002,
      feeAnnualPost: 0.002,
      fixedFeeAnnual: 0,
    });
    console.assert(base.endNom >= delayed.endNom, "Delaying contributions should not increase end balance in this setup");

    const higherFees = simulate({
      currentAge: 40,
      retirementAge: 60,
      horizonYears: 50,
      startAssets: 200000,
      monthlySave: 1500,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0.0,
      annualSpendToday: 0,
      delayYears: 0,
      feeAnnualPre: 0.02,
      feeAnnualPost: 0.02,
      fixedFeeAnnual: 0,
    });
    console.assert(base.endNom > higherFees.endNom, "Higher fees should reduce end balance");

    const withSpend = simulate({
      currentAge: 40,
      retirementAge: 60,
      horizonYears: 50,
      startAssets: 200000,
      monthlySave: 1500,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0.02,
      annualSpendToday: 60000,
      delayYears: 0,
      feeAnnualPre: 0.002,
      feeAnnualPost: 0.002,
      fixedFeeAnnual: 0,
    });
    console.assert(withSpend.endNom <= base.endNom, "Adding drawdown spend should not increase ending balance");
    console.assert(withSpend.endReal <= withSpend.endNom, "With inflation > 0, real end balance should be <= nominal end balance");

    const zeroInfl = simulate({
      currentAge: 40,
      retirementAge: 60,
      horizonYears: 50,
      startAssets: 200000,
      monthlySave: 1500,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0.0,
      annualSpendToday: 0,
      delayYears: 0,
      feeAnnualPre: 0.0,
      feeAnnualPost: 0.0,
      fixedFeeAnnual: 0,
    });
    console.assert(Math.abs(zeroInfl.endReal - zeroInfl.endNom) < 1e-6, "With 0% inflation, real ~= nominal at end");

    console.log("✅ simulate() basic tests passed");
  } catch (e) {
    console.warn("❌ simulate() tests encountered an error", e);
  }
})();

function PasswordGate({ children }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [authed, setAuthed] = useState(false);

  const expectedPassword = useMemo(() => {
    const month = new Date().getMonth() + 1;
    return `MJL${month}`;
  }, []);

  const attemptLogin = () => {
    const normalized = (input || "").trim().toUpperCase();
    if (normalized === expectedPassword) {
      setAuthed(true);
      setError("");
    } else {
      setError("Incorrect password. Please try again.");
    }
  };

  if (authed) return children;

  return (
    <div className="ut-shell ut-shell--gate">
      <div className="ut-gate-card">
        <h1>Welcome to UltimateTarget</h1>
        <p>Please enter this month&apos;s access password to continue.</p>
        <input
          type="password"
          className="ut-gate-input"
          placeholder="Password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              attemptLogin();
            }
          }}
        />
        <button className="ut-gate-button" onClick={attemptLogin}>
          Log in
        </button>
        {error ? <div className="ut-gate-error">{error}</div> : null}
      </div>
    </div>
  );
}
