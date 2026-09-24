import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
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

function MoneyInput({ id, value, onChange, error, theme, label }) {
  return (
    <Field id={id} label={label} error={error}>
      <input
        id={id}
        className="ut-mobile-input"
        inputMode="decimal"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: theme.inputBg, color: theme.text, borderColor: error ? theme.danger : theme.border }}
      />
    </Field>
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

function ContribTooltip({ active, payload, label, theme }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "10px 12px", color: theme.text }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Age {label}</div>
      <div>Existing plan: {fmtAUD(row.baseline)}</div>
      <div>With contributions: {fmtAUD(row.withContributions)}</div>
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
  monthlySave,
  returnPa,
  postRetRealPa,
  inflationPa,
  diyFeePct,
  diyFixed,
  annualSpendToday,
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
  const ctx = { currentAge, endAge: horizonEnd, startAssets: Math.max(0, initialAmount) };

  const planInput = useMemo(
    () => ({
      currentAge,
      retirementAge,
      horizonYears: Math.max(0, lifeExpectancy - currentAge),
      startAssets: Math.max(0, initialAmount),
      monthlySave: Math.max(0, monthlySave),
      preAnnualGross: Math.max(0, returnPa) / 100,
      postRealAnnualGross: postRetRealPa / 100,
      inflationAnnual: Math.max(0, inflationPa) / 100,
      annualSpendToday: Math.max(0, annualSpendToday),
      delayYears: 0,
      feeAnnualPre: Math.max(0, diyFeePct) / 100,
      feeAnnualPost: Math.max(0, diyFeePct) / 100,
      fixedFeeAnnual: Math.max(0, diyFixed),
    }),
    [currentAge, retirementAge, lifeExpectancy, initialAmount, monthlySave, returnPa, postRetRealPa, inflationPa, annualSpendToday, diyFeePct, diyFixed]
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
  const spendable = extraRow?.personal || 0;
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
    baseline.rows.forEach((r) => map.set(r.age, { age: r.age, baseline: r.nominal }));
    withExtra.rows.forEach((r) => {
      const p = map.get(r.age) || { age: r.age, baseline: 0 };
      map.set(r.age, { ...p, withContributions: r.nominal, difference: r.nominal - (p.baseline || 0) });
    });
    return Array.from(map.values()).sort((a, b) => a.age - b.age);
  }, [baseline, withExtra]);

  const lumpMarkers = withExtra.events || [];
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
                    <MoneyInput id={`${s.id}-amount`} label="Additional monthly amount" value={s.amount} error={errors.amount} theme={theme} onChange={(amount) => updateSchedule(s.id, { amount })} />
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
    <div>
      <section style={{ ...card, marginTop: 10 }} aria-label="Using your existing assumptions">
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Using your existing assumptions</h2>
        <dl className="ut-assumptions">
          <div><dt>Current age</dt><dd>{currentAge}</dd></div>
          <div><dt>Retirement age</dt><dd>{retirementAge}</dd></div>
          <div><dt>Projection</dt><dd>To age {lifeExpectancy}</dd></div>
          <div><dt>Personal starting balance</dt><dd>{fmtAUD(initialAmount)}</dd></div>
          <div><dt>Super starting balance</dt><dd>{fmtAUD(0)}</dd></div>
          <div><dt>Existing contributions</dt><dd>{fmtAUD(monthlySave)}/month until {retirementAge}</dd></div>
          <div><dt>Return before retirement</dt><dd>{returnPa}% p.a.</dd></div>
          <div><dt>Retirement return</dt><dd>{postRetRealPa}% p.a.</dd></div>
          <div><dt>Inflation</dt><dd>{inflationPa}% p.a.</dd></div>
          <div><dt>DIY fees</dt><dd>{diyFeePct}% + {fmtAUD(diyFixed)}/yr</dd></div>
          <div><dt>Annual spend target</dt><dd>{fmtAUD(annualSpendToday)}</dd></div>
        </dl>
        <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: 12 }}>
          Personal and super use these same returns and fees. Amounts are money credited to investments; this plan does not apply a second tax deduction. No super access age is set, so super is not drawn to fund spending.
        </p>
      </section>

      <div className="ut-contrib-layout">
        <div className="ut-contrib-inputs">
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
                      <MoneyInput id={`${lump.id}-amount`} label="Net amount available to invest" value={lump.amount} error={errors.amount} theme={theme} onChange={(amount) => updateLump(lump.id, { amount })} />
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
              hint={targetCapital == null ? "Spending cannot be funded on these assumptions." : `Spendable personal investments versus ${fmtAUD(targetCapital)} needed to fund spend to age ${lifeExpectancy}.`}
            />
          </div>

          <section style={{ ...card, marginTop: 12 }} aria-labelledby="contrib-chart-title">
            <h2 id="contrib-chart-title" style={{ margin: "0 0 8px", fontSize: 18 }}>Projected wealth</h2>
            <p style={{ margin: "0 0 8px" }} aria-live="polite">
              {increase >= 0
                ? `Your additional investments increase projected wealth at age ${compareAge} by ${fmtAUD(increase)}.`
                : `Your additional investments reduce projected wealth at age ${compareAge} by ${fmtAUD(Math.abs(increase))}.`}
            </p>
            <div className="ut-mobile-chart-container" style={{ width: "100%", height: 420 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartRows} margin={{ top: 28, right: 8, left: 8, bottom: 24 }}>
                  <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="age" domain={[startAge, endAge]} ticks={ageTicks} allowDecimals={false} tick={{ fill: theme.axis, fontSize: 11 }} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fill: theme.axis, fontSize: 11 }} width={56} />
                  <Tooltip content={<ContribTooltip theme={theme} />} />
                  <Legend verticalAlign="top" align="right" wrapperStyle={{ color: theme.text, fontSize: 11 }} />
                  <ReLine type="monotone" dataKey="baseline" name="Existing plan" stroke={theme.muted} strokeWidth={2} dot={false} />
                  <ReLine type="monotone" dataKey="withContributions" name="With additional contributions" stroke={theme.accent} strokeWidth={3} dot={false} />
                  <ReferenceLine x={retirementAge} stroke={theme.gold} strokeDasharray="6 3" label={{ value: `Retirement ${retirementAge}`, fill: theme.gold, fontSize: 11, position: "insideTopLeft" }} />
                  <ReferenceLine x={lifeExpectancy} stroke={theme.axis} strokeDasharray="3 3" label={{ value: `Target horizon ${lifeExpectancy}`, fill: theme.axis, fontSize: 11, position: "insideTopRight" }} />
                  {targetCapital > 0 ? (
                    <ReferenceLine y={targetCapital} stroke={theme.primary} strokeDasharray="4 4" label={{ value: "Target", fill: theme.primary, fontSize: 11, position: "insideTopRight" }} />
                  ) : null}
                  {lumpMarkers.map((ev, i) => (
                    <ReferenceLine
                      key={`${ev.label}-${ev.age}-${i}`}
                      x={ev.age}
                      stroke={theme.gold}
                      strokeDasharray="2 4"
                      label={{ value: ev.label, fill: theme.text, fontSize: 10, position: "top" }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
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
        </div>
      </div>
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
