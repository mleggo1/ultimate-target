import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Customized,
  Line as ReLine,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatContributionSummary,
  hasFieldErrors,
  requiredCapitalAtRetirement,
  rowAtAge,
  simulate,
  validateLump,
  parseNumericInput,
  validateSchedule,
} from "./simulate";

const fmtAUD = (n) =>
  "A$" +
  (Number.isFinite(n) ? n : 0).toLocaleString("en-AU", { maximumFractionDigits: 0, minimumFractionDigits: 0 });

const fmtAxis = (v) => {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s = a >= 1e9 ? (a / 1e9).toFixed(1) + "Bn" : a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? Math.round(a / 1e3) + "k" : String(Math.round(a));
  return (n < 0 ? "-$" : "$") + s;
};

function newId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function Field({ id, label, error, children }) {
  return (
    <div className="ut-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="ut-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function moneyNumber(raw) {
  const n = parseNumericInput(raw, { money: true });
  return Number.isFinite(n) ? n : 0;
}

function MoneyInput({ id, value, onChange, error, theme, label, hint }) {
  const [focus, setFocus] = useState(false);
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    if (!focus) setText(value == null ? "" : String(value));
  }, [value, focus]);
  const amount = moneyNumber(text);
  const shown = focus || text === "" ? text : `$${amount.toLocaleString("en-AU", { maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 })}`;
  return (
    <Field id={id} label={label} error={error}>
      <input
        id={id}
        className="ut-mobile-input ut-money-input"
        inputMode="decimal"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={shown}
        onFocus={() => {
          setFocus(true);
          const raw = value == null || value === "" ? "" : String(value);
          setText(moneyNumber(raw) === 0 ? "" : raw);
        }}
        onBlur={() => setFocus(false)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const root = e.currentTarget.closest(".ut-contrib");
          const fields = [...(root || document).querySelectorAll("input, select, textarea")].filter(
            (el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null
          );
          const next = fields[fields.indexOf(e.currentTarget) + 1];
          if (next) next.focus();
        }}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        style={{ background: theme.inputBg, color: theme.text, borderColor: error ? theme.danger : theme.border, fontWeight: 800, fontSize: 18 }}
      />
      {hint ? <p className="ut-money-hint">{hint}</p> : null}
    </Field>
  );
}

function PlanSlider({ id, label, value, onChange, min, max, step, money, theme }) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(String(value));
  }, [value, focus]);
  const shown = money && !focus ? `$${Number(value || 0).toLocaleString("en-AU", { maximumFractionDigits: 0 })}` : text;
  const fill = (Number(value) - min) / Math.max(1, max - min);
  return (
    <div className="ut-field">
      <label htmlFor={id}>{label}</label>
      <div className="ut-plan-slider">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="ut-range"
          style={{ "--range-pct": String(Math.min(1, Math.max(0, fill))), "--range-color": theme.accent, "--range-track": theme.border, "--range-thumb": theme.inputBg, "--range-thumb-border": theme.accent }}
        />
        <input
          className="ut-mobile-input"
          inputMode="decimal"
          aria-label={label}
          value={shown}
          onFocus={() => {
            setFocus(true);
            setText(String(value));
          }}
          onBlur={() => {
            setFocus(false);
            const n = moneyNumber(text);
            onChange(Math.min(max, Math.max(min, n)));
          }}
          onChange={(e) => {
            setText(e.target.value);
            if (!money) {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
            }
          }}
          style={{ background: theme.inputBg, color: theme.text, borderColor: theme.border, fontWeight: 800 }}
        />
      </div>
    </div>
  );
}

function NumberInput({ id, value, onChange, error, theme, label, min, max, step = 1 }) {
  return (
    <Field id={id} label={label} error={error}>
      <input
        id={id}
        className="ut-mobile-input"
        type="number"
        min={min}
        max={max}
        step={step}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        style={{ background: theme.inputBg, color: theme.text, borderColor: error ? theme.danger : theme.border }}
      />
    </Field>
  );
}

function IconButton({ label, onClick, children, theme }) {
  return (
    <button type="button" className="ut-icon-btn" aria-label={label} title={label} onClick={onClick} style={{ color: theme.text, borderColor: theme.border }}>
      {children}
    </button>
  );
}

function EntryBar({ title, summary, enabled, onToggle, expanded, onEdit, onDelete, theme }) {
  return (
    <div className="ut-entry-bar">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? `Exclude ${title}` : `Include ${title}`}
        className="ut-switch"
        onClick={onToggle}
        style={{ background: enabled ? theme.primary : theme.border, color: "#fff" }}
      >
        {enabled ? "On" : "Off"}
      </button>
      <div className="ut-entry-summary">
        <strong>{title}</strong>
        <span>{summary}</span>
      </div>
      <IconButton label={expanded ? `Close ${title}` : `Edit ${title}`} onClick={onEdit} theme={theme}>
        {expanded ? "Done" : "Edit"}
      </IconButton>
      <IconButton label={`Delete ${title}`} onClick={onDelete} theme={theme}>
        Delete
      </IconButton>
    </div>
  );
}

function conciseMoney(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `$${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}m`;
  }
  if (v >= 10_000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v).toLocaleString("en-AU")}`;
}

function markerCaption(ev) {
  if (ev.kind === "schedule") {
    const who = ev.account === "super" ? "Super" : "Personal";
    return `${who} +${conciseMoney(ev.amount)}/mo`;
  }
  const name = String(ev.label || "Lump sum").trim();
  const short = name.length > 16 ? `${name.slice(0, 15)}…` : name;
  return `${short} ${conciseMoney(ev.amount)}`;
}

function balanceOnChart(rows, age, key) {
  if (!rows?.length) return 0;
  let prev = rows[0];
  for (const row of rows) {
    if (row.age === age) return row[key] || 0;
    if (row.age > age) {
      const span = row.age - prev.age || 1;
      const t = (age - prev.age) / span;
      return (prev[key] || 0) + ((row[key] || 0) - (prev[key] || 0)) * t;
    }
    prev = row;
  }
  return prev[key] || 0;
}

function axisHeadroom(peak) {
  const value = Math.max(0, Number(peak) || 0);
  if (value <= 0) return { max: 100_000, step: 20_000 };
  const rough = value / 5;
  const pow = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const n = rough / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  const step = nice * pow;
  const max = Math.max(step, Math.ceil((value * 1.06) / step) * step);
  return { max, step };
}

function ChartMarks({ xAxisMap, yAxisMap, offset, markers, chartRows, theme, retirementAge, lifeExpectancy }) {
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale || !offset) return null;
  const retireX = xAxis.scale(retirementAge);
  const horizonX = xAxis.scale(lifeExpectancy);
  return (
    <g>
      {Number.isFinite(retireX) ? (
        <text x={retireX} y={offset.top - 8} textAnchor="middle" fill={theme.gold} fontSize={13} fontWeight={800}>{`Retirement ${retirementAge}`}</text>
      ) : null}
      {Number.isFinite(horizonX) ? (
        <text x={Math.min(horizonX, offset.left + offset.width)} y={offset.top - 8} textAnchor="end" fill={theme.axis} fontSize={13} fontWeight={800}>{`Age ${lifeExpectancy}`}</text>
      ) : null}
      {(markers || []).map((ev, i) => {
        const x = xAxis.scale(ev.age);
        const y = yAxis.scale(balanceOnChart(chartRows, ev.age, "withContributions"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const shift = (markers || []).slice(0, i).filter((prev) => Math.abs(xAxis.scale(prev.age) - x) < 28).length;
        const cx = x + shift * 26;
        const fill = ev.kind === "schedule" ? "#22d3ee" : "#fbbf24";
        return (
          <g key={`${ev.kind}-${ev.age}-${i}`}>
            <circle cx={cx} cy={y} r={12} fill={fill} stroke="#fff" strokeWidth={2} />
            <text x={cx} y={y + 4} textAnchor="middle" fill="#0b1220" fontSize={12} fontWeight={800}>{i + 1}</text>
          </g>
        );
      })}
    </g>
  );
}

function ContribTooltip({ active, payload, label, theme }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "10px 12px", color: theme.text }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Age {label}</div>
      <div>Existing plan: {fmtAUD(row.baseline)}</div>
      <div>With additional contributions: {fmtAUD(row.withContributions)}</div>
      <div>Difference: {fmtAUD(row.difference)}</div>
    </div>
  );
}

export default function Contributions({
  theme,
  currentAge,
  retirementAge,
  lifeExpectancy,
  initialAmount,
  personalStart,
  superStart,
  onPersonalStart,
  onSuperStart,
  personalMonthly,
  superMonthly,
  onPersonalMonthly,
  onSuperMonthly,
  returnPa,
  postRetRealPa,
  inflationPa,
  diyFeePct,
  diyFixed,
  annualSpendToday,
  onAnnualSpend,
  onRetirementAge,
  onLifeExpectancy,
  schedules,
  setSchedules,
  lumpSums,
  setLumpSums,
  ageTicks,
  startAge,
  endAge,
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const horizonEnd = lifeExpectancy;
  const personalOpening = Math.max(0, Number(personalStart) || 0);
  const superOpening = Math.max(0, Number(superStart) || 0);
  const ctx = { currentAge, endAge: horizonEnd, startAssets: personalOpening };

  const planInput = useMemo(
    () => ({
      currentAge,
      retirementAge,
      horizonYears: Math.max(0, lifeExpectancy - currentAge),
      startAssets: personalOpening + superOpening,
      startPersonal: personalOpening,
      startSuper: superOpening,
      monthlySave: Math.max(0, personalMonthly),
      monthlySuper: Math.max(0, superMonthly),
      preAnnualGross: Math.max(0, returnPa) / 100,
      postRealAnnualGross: postRetRealPa / 100,
      inflationAnnual: Math.max(0, inflationPa) / 100,
      annualSpendToday: Math.max(0, annualSpendToday),
      delayYears: 0,
      feeAnnualPre: Math.max(0, diyFeePct) / 100,
      feeAnnualPost: Math.max(0, diyFeePct) / 100,
      fixedFeeAnnual: Math.max(0, diyFixed),
    }),
    [currentAge, retirementAge, lifeExpectancy, personalOpening, superOpening, personalMonthly, superMonthly, returnPa, postRetRealPa, inflationPa, annualSpendToday, diyFeePct, diyFixed]
  );

  const usableSchedules = schedules.map((s) => ({ ...s, stopAge: s.untilEnd ? horizonEnd : s.stopAge }));
  const baseline = useMemo(() => simulate(planInput), [planInput]);
  const withExtra = useMemo(
    () => simulate({ ...planInput, additionalSchedules: usableSchedules, lumpSums }),
    [planInput, usableSchedules, lumpSums]
  );

  const at = (rows) => rowAtAge(rows, retirementAge) || rows[rows.length - 1];
  const baseRow = at(baseline.rows);
  const extraRow = at(withExtra.rows);
  const compareAge = extraRow?.age ?? retirementAge;
  const existingWealth = baseRow?.nominal || 0;
  const withWealth = extraRow?.nominal || 0;
  const increase = withWealth - existingWealth;
  const spendable = extraRow?.nominal || 0;
  const targetCapital = useMemo(
    () =>
      requiredCapitalAtRetirement({
        retirementAge,
        lifeExpectancy,
        annualSpendToday: Math.max(0, annualSpendToday),
        postRealAnnualGross: postRetRealPa / 100,
        inflationAnnual: Math.max(0, inflationPa) / 100,
        feeAnnualPre: Math.max(0, diyFeePct) / 100,
        feeAnnualPost: Math.max(0, diyFeePct) / 100,
        fixedFeeAnnual: Math.max(0, diyFixed),
      }),
    [retirementAge, lifeExpectancy, annualSpendToday, postRetRealPa, inflationPa, diyFeePct, diyFixed]
  );
  const above = targetCapital != null && spendable >= targetCapital;
  const gapValue = targetCapital == null ? null : Math.abs(spendable - targetCapital);

  const chartRows = useMemo(() => {
    const map = new Map();
    baseline.rows.forEach((r) => map.set(r.age, { age: r.age, existingPersonal: r.personal, existingSuper: r.super, baseline: r.nominal }));
    withExtra.rows.forEach((r) => {
      const p = map.get(r.age) || { age: r.age, existingPersonal: 0, existingSuper: 0, baseline: 0 };
      map.set(r.age, { ...p, extraPersonal: r.personal, extraSuper: r.super, withContributions: r.nominal, difference: r.nominal - (p.baseline || 0) });
    });
    return Array.from(map.values()).sort((a, b) => a.age - b.age);
  }, [baseline, withExtra]);

  const lumpMarkers = withExtra.events || [];
  const contributionMarkers = schedules
    .filter((s) => s.enabled !== false && moneyNumber(s.amount) > 0)
    .map((s) => ({
      age: Number(s.startAge) || currentAge,
      label: `${s.account === "super" ? "Super" : "Personal"} +${conciseMoney(moneyNumber(s.amount))}/mo`,
      amount: moneyNumber(s.amount),
      account: s.account === "super" ? "super" : "personal",
      kind: "schedule",
    }));
  const chartMarkers = [
    ...lumpMarkers.map((ev) => ({ ...ev, kind: "lump", account: ev.account === "super" ? "super" : "personal" })),
    ...contributionMarkers,
  ];
  const yPeak = Math.max(
    targetCapital || 0,
    ...chartRows.map((row) => Math.max(row.baseline || 0, row.withContributions || 0))
  );
  const yAxisScale = axisHeadroom(yPeak);
  const yTicks = Array.from({ length: Math.round(yAxisScale.max / yAxisScale.step) + 1 }, (_, i) => i * yAxisScale.step);
  const showRemoved = withExtra.rows.some((r) => r.assetRemoved > 0);
  const showUnfunded = withExtra.rows.some((r) => r.unfunded > 0);

  const updateSchedule = (id, patch) => setSchedules(schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updateLump = (id, patch) => setLumpSums(lumpSums.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addSchedule = (account) =>
    setSchedules([
      ...schedules,
      {
        id: newId(),
        name: "",
        account,
        amount: "",
        startAge: currentAge,
        stopAge: retirementAge,
        untilEnd: false,
        enabled: true,
        expanded: true,
      },
    ]);

  const addLump = () =>
    setLumpSums([
      ...lumpSums,
      {
        id: newId(),
        description: "",
        amount: "",
        age: retirementAge,
        monthOffset: 0,
        account: "personal",
        transfer: false,
        includedAmount: "",
        enabled: true,
        expanded: true,
      },
    ]);

  const card = {
    background: theme.cardBg,
    border: `1px solid ${theme.border}`,
    borderRadius: 16,
    padding: 16,
  };

  const renderSchedules = (account, title) => {
    const items = schedules.filter((s) => s.account === account);
    return (
      <section style={card} aria-labelledby={`${account}-heading`}>
        <h3 id={`${account}-heading`} style={{ margin: "0 0 6px" }}>{title}</h3>
        <p style={{ margin: "0 0 12px", color: theme.muted, fontSize: 13 }}>
          Additional contributions only. Your existing monthly savings stay in the baseline.
        </p>
        {items.length === 0 ? (
          <p style={{ margin: "0 0 12px", color: theme.muted }}>No additional contributions.</p>
        ) : (
          items.map((s) => {
            const errors = validateSchedule({ ...s, stopAge: s.untilEnd ? horizonEnd : s.stopAge }, ctx);
            const titleText = s.name?.trim() || "Monthly contribution";
            const summary = hasFieldErrors(errors)
              ? "Check this schedule before it is included."
              : formatContributionSummary(Number(String(s.amount).replace(/[$,]/g, "")), s.startAge, s.untilEnd ? horizonEnd : s.stopAge, s.untilEnd);
            return (
              <article key={s.id} className="ut-entry" style={{ borderColor: theme.border, opacity: s.enabled ? 1 : 0.65 }}>
                <EntryBar
                  title={titleText}
                  summary={summary}
                  enabled={s.enabled}
                  expanded={s.expanded}
                  theme={theme}
                  onToggle={() => updateSchedule(s.id, { enabled: !s.enabled })}
                  onEdit={() => updateSchedule(s.id, { expanded: !s.expanded })}
                  onDelete={() => setSchedules(schedules.filter((x) => x.id !== s.id))}
                />
                {s.expanded ? (
                  <div className="ut-entry-fields">
                    <Field id={`${s.id}-name`} label="Name (optional)">
                      <input
                        id={`${s.id}-name`}
                        className="ut-mobile-input"
                        value={s.name}
                        placeholder="Monthly ETF investing"
                        onChange={(e) => updateSchedule(s.id, { name: e.target.value })}
                        style={{ background: theme.inputBg, color: theme.text, borderColor: theme.border }}
                      />
                    </Field>
                    <MoneyInput id={`${s.id}-amount`} label="Additional monthly amount" value={s.amount} error={errors.amount} theme={theme} hint={moneyNumber(s.amount) > 0 ? `Adding ${fmtAUD(moneyNumber(s.amount))} each month` : "Type the extra amount you will add each month"} onChange={(amount) => updateSchedule(s.id, { amount })} />
                    <NumberInput id={`${s.id}-start`} label="Start age" value={s.startAge} min={currentAge} max={horizonEnd} error={errors.startAge} theme={theme} onChange={(startAge) => updateSchedule(s.id, { startAge })} />
                    <NumberInput id={`${s.id}-stop`} label="Stop age" value={s.untilEnd ? horizonEnd : s.stopAge} min={currentAge} max={horizonEnd} error={errors.stopAge} theme={theme} onChange={(stopAge) => updateSchedule(s.id, { stopAge, untilEnd: false })} />
                    <label className="ut-check" htmlFor={`${s.id}-end`}>
                      <input
                        id={`${s.id}-end`}
                        type="checkbox"
                        checked={!!s.untilEnd}
                        onChange={(e) => updateSchedule(s.id, { untilEnd: e.target.checked })}
                      />
                      Continue to the end of the projection
                    </label>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
        <button type="button" className="ut-add-btn" onClick={() => addSchedule(account)} style={{ borderColor: theme.border, color: theme.text, background: theme.chipBg }}>
          Add monthly contribution
        </button>
      </section>
    );
  };

  return (
    <div className="ut-contrib">
      <section style={{ ...card, marginTop: 10 }} aria-label="Using your existing assumptions">
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Using your existing assumptions</h2>
        <dl className="ut-assumptions">
          <div><dt>Current age</dt><dd>{currentAge}</dd></div>
          <div><dt>Retirement age</dt><dd>{retirementAge}</dd></div>
          <div><dt>Projection</dt><dd>To age {lifeExpectancy}</dd></div>
          <div><dt>Personal starting balance</dt><dd>{fmtAUD(personalOpening)}</dd></div>
          <div><dt>Super starting balance</dt><dd>{fmtAUD(superOpening)}</dd></div>
          <div><dt>Combined starting balance</dt><dd>{fmtAUD(personalOpening + superOpening)}</dd></div>
          <div><dt>Personal each month</dt><dd>{fmtAUD(personalMonthly)}</dd></div>
          <div><dt>Super each month</dt><dd>{fmtAUD(superMonthly)}</dd></div>
          <div><dt>Return before retirement</dt><dd>{returnPa}% p.a.</dd></div>
          <div><dt>Retirement return</dt><dd>{postRetRealPa}% p.a.</dd></div>
          <div><dt>Inflation</dt><dd>{inflationPa}% p.a.</dd></div>
          <div><dt>DIY fees</dt><dd>{diyFeePct}% + {fmtAUD(diyFixed)}/yr</dd></div>
          <div><dt>Annual spend target</dt><dd>{fmtAUD(annualSpendToday)}</dd></div>
        </dl>
        <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: 12 }}>
          Personal and super use these same returns and fees. Amounts are money credited to investments; this plan does not apply a second tax deduction. After retirement, spending is drawn from personal investments and super together.
        </p>
      </section>

      <div className="ut-contrib-layout">
        <div className="ut-contrib-inputs">
          <section style={card} aria-labelledby="balances-heading">
            <h3 id="balances-heading" style={{ margin: "0 0 6px" }}>Starting balances</h3>
            <p style={{ margin: "0 0 12px", color: theme.muted, fontSize: 13 }}>
              Split your savings between personal investments and super. The combined total stays in sync with the rest of the plan. After retirement, both are drawn down together.
            </p>
            <div className="ut-entry-fields">
              <MoneyInput id="personal-start" label="Personal investments" value={personalOpening} error={null} theme={theme} hint={personalOpening > 0 ? `${fmtAUD(personalOpening)} already invested outside super` : "Nothing in personal investments yet"} onChange={(raw) => onPersonalStart(moneyNumber(raw))} />
              <MoneyInput id="super-start" label="Superannuation" value={superOpening} error={null} theme={theme} hint={superOpening > 0 ? `${fmtAUD(superOpening)} already in super` : "Nothing in super yet"} onChange={(raw) => onSuperStart(moneyNumber(raw))} />
            </div>
            <p style={{ margin: "10px 0 0", fontWeight: 700 }}>Combined {fmtAUD(personalOpening + superOpening)}</p>
          </section>
          {renderSchedules("personal", "Personal investments")}
          {renderSchedules("super", "Superannuation")}
          <section style={card} aria-labelledby="lump-heading">
            <h3 id="lump-heading" style={{ margin: "0 0 6px" }}>Future lump sums</h3>
            <p style={{ margin: "0 0 12px", color: theme.muted, fontSize: 13 }}>
              Enter the amount you expect to invest after debts, tax and selling costs.
            </p>
            {lumpSums.length === 0 ? <p style={{ margin: "0 0 12px", color: theme.muted }}>No future lump sums.</p> : null}
            {lumpSums.map((lump) => {
              const errors = validateLump(lump, ctx, lumpSums);
              const titleText = lump.description?.trim() || "Lump sum";
              const when = Number(lump.monthOffset) > 0 ? `age ${lump.age} plus ${lump.monthOffset} months` : `age ${lump.age}`;
              const dest = lump.account === "super" ? "superannuation" : "personal investments";
              const summary = hasFieldErrors(errors) ? "Check this lump sum before it is included." : `${fmtAUD(Number(String(lump.amount).replace(/[$,]/g, "")) || 0)} into ${dest} at ${when}.`;
              return (
                <article key={lump.id} className="ut-entry" style={{ borderColor: theme.border, opacity: lump.enabled ? 1 : 0.65 }}>
                  <EntryBar
                    title={titleText}
                    summary={summary}
                    enabled={lump.enabled}
                    expanded={lump.expanded}
                    theme={theme}
                    onToggle={() => updateLump(lump.id, { enabled: !lump.enabled })}
                    onEdit={() => updateLump(lump.id, { expanded: !lump.expanded })}
                    onDelete={() => setLumpSums(lumpSums.filter((x) => x.id !== lump.id))}
                  />
                  {lump.expanded ? (
                    <div className="ut-entry-fields">
                      <Field id={`${lump.id}-desc`} label="Description">
                        <input
                          id={`${lump.id}-desc`}
                          className="ut-mobile-input"
                          value={lump.description}
                          placeholder="Business sale"
                          onChange={(e) => updateLump(lump.id, { description: e.target.value })}
                          style={{ background: theme.inputBg, color: theme.text, borderColor: theme.border }}
                        />
                      </Field>
                      <MoneyInput id={`${lump.id}-amount`} label="Net amount available to invest" value={lump.amount} error={errors.amount} theme={theme} hint={moneyNumber(lump.amount) > 0 ? `${fmtAUD(moneyNumber(lump.amount))} comes in once` : "Type the amount that will be invested"} onChange={(amount) => updateLump(lump.id, { amount })} />
                      <p style={{ margin: 0, color: theme.muted, fontSize: 12 }}>Enter the amount you expect to invest after debts, tax and selling costs.</p>
                      <NumberInput id={`${lump.id}-age`} label="Investment age" value={lump.age} min={currentAge} max={horizonEnd} error={errors.age} theme={theme} onChange={(age) => updateLump(lump.id, { age })} />
                      <NumberInput id={`${lump.id}-month`} label="Month offset (optional)" value={lump.monthOffset} min={0} max={11} error={errors.monthOffset} theme={theme} onChange={(monthOffset) => updateLump(lump.id, { monthOffset })} />
                      <Field id={`${lump.id}-dest`} label="Destination">
                        <select
                          id={`${lump.id}-dest`}
                          className="ut-mobile-input"
                          value={lump.account}
                          onChange={(e) => updateLump(lump.id, { account: e.target.value })}
                          style={{ background: theme.inputBg, color: theme.text, borderColor: theme.border }}
                        >
                          <option value="personal">Personal investments</option>
                          <option value="super">Superannuation</option>
                        </select>
                      </Field>
                      <label className="ut-check" htmlFor={`${lump.id}-transfer`}>
                        <input
                          id={`${lump.id}-transfer`}
                          type="checkbox"
                          checked={!!lump.transfer}
                          onChange={(e) => updateLump(lump.id, { transfer: e.target.checked })}
                        />
                        This sale is an asset already included in the plan
                      </label>
                      {lump.transfer ? (
                        <MoneyInput
                          id={`${lump.id}-included`}
                          label="Amount currently included"
                          value={lump.includedAmount}
                          error={errors.includedAmount}
                          theme={theme}
                          onChange={(includedAmount) => updateLump(lump.id, { includedAmount })}
                        />
                      ) : null}
                      {lump.transfer ? (
                        <p style={{ margin: 0, color: theme.muted, fontSize: 12 }}>
                          The sold asset and its future growth are removed when the proceeds are invested, so both are not counted.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
            <button type="button" className="ut-add-btn" onClick={addLump} style={{ borderColor: theme.border, color: theme.text, background: theme.chipBg }}>
              Add lump sum
            </button>
          </section>
        </div>

        <div className="ut-contrib-results">
          <section style={card} aria-labelledby="flex-heading">
            <h3 id="flex-heading" style={{ margin: "0 0 6px" }}>Try the plan</h3>
            <p style={{ margin: "0 0 12px", color: theme.muted, fontSize: 13 }}>
              Personal investing and super are drawn down together after retirement. Annual spending sits with the chart so you can watch the line as you move it.
            </p>
            <PlanSlider id="contrib-personal-monthly" label="Personal investing per month" money theme={theme} min={0} max={25000} step={100} value={Math.max(0, personalMonthly)} onChange={onPersonalMonthly} />
            <PlanSlider id="contrib-super-monthly" label="Superannuation per month" money theme={theme} min={0} max={25000} step={100} value={Math.max(0, superMonthly)} onChange={onSuperMonthly} />
            <PlanSlider id="contrib-retire" label="Retirement age" theme={theme} min={currentAge + 1} max={100} step={1} value={retirementAge} onChange={onRetirementAge} />
            <PlanSlider id="contrib-life" label="Life expectancy" theme={theme} min={retirementAge + 1} max={110} step={1} value={lifeExpectancy} onChange={onLifeExpectancy} />
            <div className="ut-runout" style={{ borderColor: withExtra.depletedAge ? theme.danger : theme.success, marginTop: 12 }}>
              <strong>{withExtra.depletedAge ? `The plan runs out around age ${withExtra.depletedAge}` : `The plan lasts beyond age ${lifeExpectancy}`}</strong>
              <span>
                {baseline.depletedAge
                  ? `Without the extra contributions, they run out around age ${baseline.depletedAge}.`
                  : `Without the extra contributions, they last beyond age ${lifeExpectancy}.`}
              </span>
            </div>
          </section>
          <p style={{ margin: "0 0 8px", color: theme.muted }}>
            Compared at age {compareAge}
            {compareAge === retirementAge ? " — retirement age" : ""}.
          </p>
          <div className="ut-mobile-grid-4 ut-result-grid">
            <ResultCard theme={theme} label="Existing plan" value={fmtAUD(existingWealth)} />
            <ResultCard theme={theme} label="With additional contributions" value={fmtAUD(withWealth)} />
            <ResultCard theme={theme} label="Increase in projected wealth" value={fmtAUD(increase)} tone={increase >= 0 ? "success" : "danger"} />
            <ResultCard
              theme={theme}
              label={targetCapital == null ? "Gap to target" : above ? "Above target" : "Gap to target"}
              value={gapValue == null ? "Not fundable" : fmtAUD(gapValue)}
              tone={above ? "success" : "danger"}
              hint={targetCapital == null ? "Spending cannot be funded on these assumptions." : `Combined personal and super versus ${fmtAUD(targetCapital)} needed to fund spend to age ${lifeExpectancy}.`}
            />
          </div>
          <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: 13 }}>
            At age {compareAge}: personal {fmtAUD(extraRow?.personal || 0)}, super {fmtAUD(extraRow?.super || 0)}. Existing plan is personal {fmtAUD(baseRow?.personal || 0)} and super {fmtAUD(baseRow?.super || 0)}.
          </p>
        </div>
      </div>

      <section className="ut-contrib-chart-card" style={{ ...card, marginTop: 12 }} aria-labelledby="contrib-chart-title">
            <h2 id="contrib-chart-title" style={{ margin: "0 0 8px", fontSize: 18 }}>Projected wealth</h2>
            <PlanSlider id="contrib-spend" label="Annual spend in today's dollars" money theme={theme} min={0} max={1300000} step={1000} value={Math.max(0, annualSpendToday)} onChange={onAnnualSpend} />
            <p style={{ margin: "8px 0" }} aria-live="polite">
              {withExtra.depletedAge ? `At this spend the combined plan runs out around age ${withExtra.depletedAge}.` : `At this spend the combined plan lasts beyond age ${lifeExpectancy}.`}
              {" "}
              {increase >= 0
                ? `Additional contributions increase wealth at age ${compareAge} by ${fmtAUD(increase)}.`
                : `Additional contributions reduce wealth at age ${compareAge} by ${fmtAUD(Math.abs(increase))}.`}
              {" "}The lines are personal investments and super added together. After retirement, spending comes out of both. Tags show where extra contributions and lump sums go in.
            </p>
            <div className="ut-chart-key" aria-label="Chart key">
              <span className="ut-chart-key-item"><i style={{ background: theme.muted }} />Existing plan</span>
              <span className="ut-chart-key-item"><i style={{ background: "#22d3ee" }} />With additional contributions</span>
              {chartMarkers.map((ev, i) => (
                <span key={`${ev.kind}-${ev.age}-${i}`} className="ut-chart-key-item" style={{ borderColor: ev.kind === "schedule" ? "#22d3ee" : "#fbbf24" }}>
                  <b style={{ background: ev.kind === "schedule" ? "#22d3ee" : "#fbbf24" }}>{i + 1}</b>
                  {markerCaption(ev)} at {Number.isInteger(ev.age) ? ev.age : Number(ev.age).toFixed(1)}
                </span>
              ))}
            </div>
            <div className="ut-contrib-chart" style={{ width: "100%", height: 720 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartRows} margin={{ top: 28, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="age" domain={[startAge, endAge]} ticks={ageTicks} allowDecimals={false} tick={{ fill: theme.axis, fontSize: 14, fontWeight: 700 }} />
                  <YAxis domain={[0, yAxisScale.max]} ticks={yTicks} tickFormatter={fmtAxis} tick={{ fill: theme.axis, fontSize: 14, fontWeight: 700 }} width={64} />
                  <Tooltip content={<ContribTooltip theme={theme} />} />
                  <ReLine type="linear" dataKey="baseline" name="Existing plan" stroke={theme.muted} strokeWidth={3} dot={false} />
                  <ReLine type="linear" dataKey="withContributions" name="With additional contributions" stroke="#22d3ee" strokeWidth={5} dot={false} />
                  <ReferenceLine x={retirementAge} stroke={theme.gold} strokeWidth={3} strokeDasharray="6 3" />
                  <ReferenceLine x={lifeExpectancy} stroke={theme.axis} strokeWidth={2} strokeDasharray="3 3" />
                  {targetCapital > 0 ? <ReferenceLine y={targetCapital} stroke={theme.primary} strokeDasharray="4 4" label={{ value: "Target", fill: theme.primary, fontSize: 12, fontWeight: 800, position: "insideTopRight" }} /> : null}
                  <Customized
                    component={ChartMarks}
                    markers={chartMarkers}
                    chartRows={chartRows}
                    theme={theme}
                    retirementAge={retirementAge}
                    lifeExpectancy={lifeExpectancy}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p style={{ margin: "8px 0 0", color: theme.muted }}>
              The grey line is the existing plan. The bright line includes additional contributions. Both lines are personal investments and super added together, and retirement spending is taken from that combined balance.
              {contributionMarkers.length > 0 ? ` Extra monthly contributions start at: ${contributionMarkers.map((ev) => `${ev.label} from age ${ev.age}`).join("; ")}.` : ""}
              {lumpMarkers.length > 0 ? ` Lump sums: ${lumpMarkers.map((ev) => `${ev.label} ${fmtAUD(ev.amount)} into ${ev.account === "super" ? "super" : "personal"} at age ${Number.isInteger(ev.age) ? ev.age : ev.age.toFixed(1)}`).join("; ")}.` : ""}
            </p>
      </section>

      <section style={{ ...card, marginTop: 12 }}>
            <button
              type="button"
              className="ut-add-btn"
              aria-expanded={breakdownOpen}
              onClick={() => setBreakdownOpen((v) => !v)}
              style={{ borderColor: theme.border, color: theme.text, background: theme.chipBg, marginBottom: breakdownOpen ? 12 : 0 }}
            >
              {breakdownOpen ? "Hide annual breakdown" : "Show annual breakdown"}
            </button>
            {breakdownOpen ? (
              <div className="ut-table-wrap">
                <table className="ut-breakdown">
                  <caption>Annual breakdown of the plan with additional contributions. Opening balance plus contributions, growth, less fees, withdrawals and transferred assets, plus any unfunded shortfall, equals the combined balance.</caption>
                  <thead>
                    <tr>
                      <th>Age</th>
                      <th>Personal</th>
                      <th>Super</th>
                      <th>Contributions</th>
                      <th>Cumulative</th>
                      <th>Growth</th>
                      <th>Fees</th>
                      <th>Withdrawals</th>
                      {showRemoved ? <th>Transferred out</th> : null}
                      {showUnfunded ? <th>Unfunded</th> : null}
                      <th>Combined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withExtra.rows.map((r) => (
                      <tr key={r.age}>
                        <td>{r.age}</td>
                        <td>{fmtAUD(r.personal)}</td>
                        <td>{fmtAUD(r.super)}</td>
                        <td>{fmtAUD(r.contributions)}</td>
                        <td>{fmtAUD(r.cumulativeContributions)}</td>
                        <td>{fmtAUD(r.growth)}</td>
                        <td>{fmtAUD(r.fees)}</td>
                        <td>{fmtAUD(r.withdrawals)}</td>
                        {showRemoved ? <td>{fmtAUD(r.assetRemoved)}</td> : null}
                        {showUnfunded ? <td>{fmtAUD(r.unfunded)}</td> : null}
                        <td>{fmtAUD(r.nominal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
      </section>

      <section style={{ ...card, marginTop: 12 }} aria-labelledby="contrib-summary-title">
        <h2 id="contrib-summary-title" style={{ marginTop: 0, fontSize: 18 }}>Summary of this plan</h2>
        <ul className="ut-plan-summary">
          <li>You start with {fmtAUD(personalOpening)} in personal investments and {fmtAUD(superOpening)} in super. Combined, that is {fmtAUD(personalOpening + superOpening)}.</li>
          <li>Each month until age {retirementAge} you contribute {fmtAUD(personalMonthly)} to personal investments and {fmtAUD(superMonthly)} to superannuation. Extra amounts below are on top of that.</li>
          {schedules.filter((s) => s.enabled !== false && moneyNumber(s.amount) > 0).map((s) => {
            const extraPersonal = schedules.filter((item) => item.enabled !== false && item.account !== "super").reduce((sum, item) => sum + moneyNumber(item.amount), 0);
            const extraSuper = schedules.filter((item) => item.enabled !== false && item.account === "super").reduce((sum, item) => sum + moneyNumber(item.amount), 0);
            const personalTotal = Math.max(0, personalMonthly) + extraPersonal;
            const superTotal = Math.max(0, superMonthly) + extraSuper;
            const totalNote = s.account === "super"
              ? ` (${fmtAUD(superTotal)} a month into super in total)`
              : ` (${fmtAUD(personalTotal)} a month in total)`;
            return (
              <li key={s.id}>{s.account === "super" ? "Super" : "Personal"}: {s.name?.trim() || "Additional contribution"} — {formatContributionSummary(moneyNumber(s.amount), s.startAge, s.untilEnd ? horizonEnd : s.stopAge, s.untilEnd).replace(/\.$/, "")}{totalNote}.</li>
            );
          })}
          {schedules.filter((s) => s.enabled !== false && moneyNumber(s.amount) > 0).length === 0 ? <li>No additional monthly contributions.</li> : null}
          {lumpSums.filter((l) => l.enabled !== false && moneyNumber(l.amount) > 0).map((l) => (
            <li key={l.id}>{l.description?.trim() || "Lump sum"}: {fmtAUD(moneyNumber(l.amount))} into {l.account === "super" ? "super" : "personal investments"} at age {l.age}{Number(l.monthOffset) > 0 ? ` plus ${l.monthOffset} months` : ""}{l.transfer ? ", replacing an asset already in the plan" : ""}.</li>
          ))}
          {lumpSums.filter((l) => l.enabled !== false && moneyNumber(l.amount) > 0).length === 0 ? <li>No future lump sums.</li> : null}
          <li>Annual spending is {fmtAUD(annualSpendToday)} in today's dollars, drawn from personal investments and super together. {withExtra.depletedAge ? `At that spend, the plan runs out around age ${withExtra.depletedAge}.` : `At that spend, the plan lasts beyond age ${lifeExpectancy}.`}</li>
          <li>{increase >= 0 ? `The extra money increases projected wealth at age ${compareAge} by ${fmtAUD(increase)}.` : `The extra money reduces projected wealth at age ${compareAge} by ${fmtAUD(Math.abs(increase))}.`} At that age the plan holds {fmtAUD(extraRow?.personal || 0)} personally and {fmtAUD(extraRow?.super || 0)} in super.</li>
        </ul>
      </section>
    </div>
  );
}

function ResultCard({ theme, label, value, hint, tone }) {
  const color = tone === "danger" ? theme.danger : tone === "success" ? theme.success : theme.text;
  return (
    <div style={{ background: theme.chipBg, border: `1px solid ${theme.border}`, borderRadius: 14, padding: "10px 12px" }}>
      <div style={{ color: theme.muted, fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {hint ? <div style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}
