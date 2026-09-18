/**
 * Ultimate Target projection engine.
 *
 * Shared accumulation math matches Family Wealth Blueprint and Kids Wealth Blueprint:
 * - Entered current age is the beginning of the first projection year (30 = 30→31).
 * - Month 0 keeps the starting balance and does not add a contribution.
 * - Each later month grows at a simple monthly rate (annual / 12), then applies cashflows.
 * - Yearly snapshots are taken at integer ages from current age through the target age.
 *
 * Ultimate Target–only features (fees, delay, retirement spend, inflation, post-retire return)
 * use the same monthly timing and simple-rate compounding.
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function monthlyRateFromAnnual(annual) {
  return num(annual) / 12;
}

export function parseNumericInput(raw, { money = false } = {}) {
  if (raw == null || String(raw).trim() === "") return 0;
  if (money) {
    const cleaned = String(raw).replace(/[$,]/g, "").replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function simulate(input = {}) {
  const currentAge = num(input.currentAge);
  const retirementAge = num(input.retirementAge, currentAge);
  const horizonYears = Math.max(0, num(input.horizonYears));
  const startAssets = Math.max(0, num(input.startAssets));
  const monthlySave = num(input.monthlySave);
  const preAnnualGross = num(input.preAnnualGross);
  const postAnnualGross = num(input.postRealAnnualGross); // treated as nominal
  const inflationAnnual = Math.max(0, num(input.inflationAnnual));
  const annualSpendToday = Math.max(0, num(input.annualSpendToday));
  const delayYears = Math.max(0, num(input.delayYears));
  const feeAnnualPre = Math.max(0, num(input.feeAnnualPre));
  const feeAnnualPost = Math.max(0, num(input.feeAnnualPost));
  const fixedFeeAnnual = Math.max(0, num(input.fixedFeeAnnual));

  const months = Math.round(horizonYears * 12);
  const preNet = Math.max(-0.99, preAnnualGross - feeAnnualPre);
  const postNet = Math.max(-0.99, postAnnualGross - feeAnnualPost);
  const mPre = monthlyRateFromAnnual(preNet);
  const mPost = monthlyRateFromAnnual(postNet);
  const mInfl = monthlyRateFromAnnual(inflationAnnual);
  const mFix = fixedFeeAnnual / 12;
  const toRet = Math.max(0, Math.round((retirementAge - currentAge) * 12));
  const dly = Math.max(0, Math.round(delayYears * 12));

  const rows = [];
  let bal = startAssets;
  let dep = null;
  let totalContributed = startAssets;
  let totalFees = 0;

  rows.push({
    age: currentAge,
    nominal: bal,
    real: bal,
    contributed: totalContributed,
  });

  for (let m = 1; m <= months; m++) {
    const age = currentAge + m / 12;
    const pre = m <= toRet;
    const r = pre ? mPre : mPost;
    const feeAnnual = pre ? feeAnnualPre : feeAnnualPost;
    const c = pre && m > dly ? monthlySave : 0;
    const sp = m > toRet ? (annualSpendToday / 12) * Math.pow(1 + mInfl, m) : 0;

    if (bal > 0) {
      totalFees += bal * (feeAnnual / 12) + mFix;
    }

    bal = bal * (1 + r) + c - sp - mFix;
    totalContributed += c;

    if (bal <= 0 && dep == null) dep = age;
    if (bal < 0) bal = 0;

    if (m % 12 === 0) {
      const d = Math.pow(1 + mInfl, m);
      rows.push({
        age,
        nominal: bal,
        real: d !== 0 ? bal / d : bal,
        contributed: totalContributed,
      });
    }
  }

  return {
    rows,
    endNom: bal,
    endReal: rows[rows.length - 1]?.real ?? bal,
    depletedAge: dep != null ? Math.floor(dep) : null,
    depletedAgeExact: dep,
    totalContributed,
    totalFees,
  };
}

export function getBalanceAtAge(rows, age) {
  if (!rows?.length) return 0;
  let best = rows[0];
  for (const r of rows) {
    if (r.age <= age) best = r;
    else break;
  }
  return best?.nominal ?? 0;
}

export function rowAtAge(rows, age) {
  if (!rows?.length) return undefined;
  return rows.find((r) => r.age === age) || rows.find((r) => r.age > age) || rows[rows.length - 1];
}

export function principalInvestedToRetirement(monthlySave, currentAge, retirementAge) {
  return num(monthlySave) * 12 * Math.max(0, num(retirementAge) - num(currentAge));
}

export function maxSustainableSpendToday(input = {}) {
  const lifeExpectancy = num(input.lifeExpectancy);
  const sim = (s) => simulate({ ...input, annualSpendToday: s });
  const zero = sim(0);
  if (zero.depletedAgeExact != null && zero.depletedAgeExact < lifeExpectancy) return 0;

  let lo = 0;
  let hi = 100000;
  const max = 5e7;
  const tol = 0.1;
  const lasts = (s) => {
    const t = sim(s);
    const d = t.depletedAgeExact == null ? Infinity : t.depletedAgeExact;
    return d >= lifeExpectancy - tol;
  };
  while (lasts(hi) && hi < max) hi *= 2;
  if (hi >= max) return hi;
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    if (lasts(mid)) lo = mid;
    else hi = mid;
  }
  let spend = Math.round(lo);
  while (spend > 0 && !lasts(spend)) spend -= 1;
  return spend;
}

/**
 * Exact Family Wealth Blueprint / Kids Wealth Blueprint compound engine.
 * Copied for cross-app reconciliation tests.
 */
export function blueprintCalculateCompound(
  startAge,
  monthlyAmount,
  years,
  annualReturn,
  initialInvestment = 0
) {
  const data = [];
  let balance = initialInvestment;
  let totalContributed = initialInvestment;
  const monthlyReturn = annualReturn / 100 / 12;
  const totalMonths = years * 12;

  for (let month = 0; month <= totalMonths; month++) {
    const currentAge = startAge + month / 12;
    if (month > 0) {
      balance = balance * (1 + monthlyReturn) + monthlyAmount;
      totalContributed += monthlyAmount;
    }
    const growth = balance - totalContributed;
    if (month % 12 === 0) {
      data.push({
        age: currentAge,
        total: Math.round(balance),
        contributed: Math.round(totalContributed),
        growth: Math.round(growth),
        exact: balance,
      });
    }
  }
  return data;
}
