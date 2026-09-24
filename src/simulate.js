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
 *
 * Deposit timing (used for the existing monthly savings and any additional contributions):
 * - Age N is the beginning of the projection year N→N+1. Month 0 keeps the opening balance
 *   and does not credit a monthly deposit.
 * - Each later month grows the opening balance at the simple monthly net rate, then credits
 *   deposits and debits withdrawals and the fixed fee.
 * - A monthly schedule from start age S to stop age T is start-inclusive and stop-exclusive:
 *   it deposits while the end-of-month age is greater than S and less than or equal to T
 *   (age 50 until 55 is five years / 60 deposits).
 * - A lump sum at age A plus a month offset is credited once, on that month boundary, after
 *   growth. It earns nothing before that date. Offset 0 at the current age is part of the
 *   opening balance.
 * - After a schedule stops, the balance it built stays invested and keeps compounding.
 * - A lump sum marked as a transfer removes the grown value of the included asset from
 *   personal investments at the same moment the proceeds are credited, so the asset and
 *   the proceeds are not both counted.
 * - Personal investments and superannuation stay separate. Super uses the same return and
 *   fee rate. There is no super access age, so retirement spending is taken from personal
 *   investments only. The fixed fee stays on that existing account.
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

function blankYearFlows() {
  return {
    contributions: 0,
    existingContributions: 0,
    additionalContributions: 0,
    lumpSums: 0,
    cumulativeContributions: 0,
    growth: 0,
    fees: 0,
    withdrawals: 0,
    assetRemoved: 0,
    unfunded: 0,
  };
}

/**
 * Active additional schedules and one-off investments.
 * Invalid or excluded entries are omitted so they cannot change the projection.
 */
export function resolveContributions(input = {}) {
  const currentAge = num(input.currentAge);
  const horizonYears = Math.max(0, num(input.horizonYears));
  const months = Math.round(horizonYears * 12);
  const endAge = currentAge + horizonYears;
  const startAssets = Math.max(0, num(input.startAssets));

  const schedules = [];
  for (const s of input.additionalSchedules || []) {
    if (!s || s.enabled === false) continue;
    const amount = parseNumericInput(s.amount, { money: true });
    if (!(amount > 0)) continue;
    const startAge = num(s.startAge, NaN);
    const stopAge = s.untilEnd ? endAge : num(s.stopAge, NaN);
    if (!Number.isFinite(startAge) || !Number.isFinite(stopAge)) continue;
    if (startAge < currentAge || startAge >= endAge || stopAge <= startAge || stopAge > endAge + 1e-9) continue;
    schedules.push({
      amount,
      startAge,
      stopAge,
      account: s.account === "super" ? "super" : "personal",
    });
  }

  const lumps = [];
  let includedPool = startAssets;
  for (const lump of input.lumpSums || []) {
    if (!lump || lump.enabled === false) continue;
    const amount = parseNumericInput(lump.amount, { money: true });
    if (!(amount > 0)) continue;
    const age = num(lump.age, NaN);
    if (!Number.isFinite(age)) continue;
    const rawOffset = lump.monthOffset;
    const monthOffset = rawOffset == null || rawOffset === "" ? 0 : num(rawOffset, NaN);
    if (!Number.isInteger(monthOffset) || monthOffset < 0 || monthOffset > 11) continue;
    const at = age + monthOffset / 12;
    const monthIndex = Math.round((at - currentAge) * 12);
    if (monthIndex < 0 || monthIndex > months) continue;
    const account = lump.account === "super" ? "super" : "personal";
    let included = 0;
    if (lump.transfer) {
      const requested = parseNumericInput(lump.includedAmount, { money: true });
      if (!(requested > 0) || requested > includedPool + 1e-6) continue;
      included = requested;
      includedPool -= included;
    }
    lumps.push({
      id: lump.id,
      amount,
      account,
      monthIndex,
      age: at,
      transfer: !!lump.transfer,
      included,
      label: String(lump.description || lump.name || "Lump sum").trim() || "Lump sum",
    });
  }

  return { schedules, lumps, endAge, months };
}

export function monthlyScheduleActive(schedule, ageEnd) {
  return ageEnd > schedule.startAge && ageEnd <= schedule.stopAge;
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
  const resolved = resolveContributions(input);

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
  let personal = startAssets;
  let superBal = 0;
  let dep = null;
  let totalContributed = startAssets;
  let totalFees = 0;
  let cumulativeDeposits = 0;
  const slices = resolved.lumps
    .filter((l) => l.transfer && l.monthIndex > 0 && l.included > 0)
    .map((l) => ({ id: l.id, value: l.included, sold: false }));

  const openingLumps = resolved.lumps.filter((l) => l.monthIndex === 0);
  let openingRemoved = 0;
  for (const lump of openingLumps) {
    if (lump.transfer) {
      const take = Math.min(personal, lump.included);
      personal -= take;
      openingRemoved += take;
    }
    if (lump.account === "super") superBal += lump.amount;
    else personal += lump.amount;
    totalContributed += lump.amount;
    cumulativeDeposits += lump.amount;
  }

  const pushRow = (age, monthIndex, flows) => {
    const nominal = superBal === 0 ? personal : personal + superBal;
    const d = monthIndex === 0 ? 1 : Math.pow(1 + mInfl, monthIndex);
    rows.push({
      age,
      nominal,
      real: d !== 0 ? nominal / d : nominal,
      contributed: totalContributed,
      personal,
      super: superBal,
      contributions: flows.contributions,
      existingContributions: flows.existingContributions,
      additionalContributions: flows.additionalContributions,
      lumpSums: flows.lumpSums,
      cumulativeContributions: cumulativeDeposits,
      growth: flows.growth,
      fees: flows.fees,
      withdrawals: flows.withdrawals,
      assetRemoved: flows.assetRemoved,
      unfunded: flows.unfunded,
    });
  };

  pushRow(currentAge, 0, { ...blankYearFlows(), assetRemoved: openingRemoved, lumpSums: openingLumps.reduce((sum, l) => sum + l.amount, 0), contributions: openingLumps.reduce((sum, l) => sum + l.amount, 0) });

  let yGrowth = 0;
  let yFees = 0;
  let yWithdraw = 0;
  let yContrib = 0;
  let yExisting = 0;
  let yAdditional = 0;
  let yLump = 0;
  let yRemoved = 0;
  let yUnfunded = 0;

  const lumpsByMonth = new Map();
  for (const lump of resolved.lumps) {
    if (lump.monthIndex <= 0) continue;
    const list = lumpsByMonth.get(lump.monthIndex) || [];
    list.push(lump);
    lumpsByMonth.set(lump.monthIndex, list);
  }

  for (let m = 1; m <= months; m++) {
    const age = currentAge + m / 12;
    const pre = m <= toRet;
    const r = pre ? mPre : mPost;
    const feeAnnual = pre ? feeAnnualPre : feeAnnualPost;
    const c = pre && m > dly ? monthlySave : 0;
    const sp = m > toRet ? (annualSpendToday / 12) * Math.pow(1 + mInfl, m) : 0;
    const openingPersonal = personal;
    const openingSuper = superBal;

    if (openingPersonal > 0) {
      totalFees += openingPersonal * (feeAnnual / 12) + mFix;
    }
    if (openingSuper > 0) {
      totalFees += openingSuper * (feeAnnual / 12);
    }

    let extraP = 0;
    let extraS = 0;
    for (const schedule of resolved.schedules) {
      if (!monthlyScheduleActive(schedule, age)) continue;
      if (schedule.account === "super") extraS += schedule.amount;
      else extraP += schedule.amount;
    }

    for (const slice of slices) {
      if (!slice.sold) slice.value *= 1 + r;
    }

    let removed = 0;
    let proceedsP = 0;
    let proceedsS = 0;
    const due = lumpsByMonth.get(m) || [];
    for (const lump of due) {
      if (lump.transfer) {
        const slice = slices.find((s) => s.id === lump.id && !s.sold);
        const grown = slice ? slice.value : 0;
        const take = Math.min(Math.max(0, openingPersonal * (1 + r) + c + extraP - removed), grown);
        removed += take;
        if (slice) slice.sold = true;
      }
      if (lump.account === "super") proceedsS += lump.amount;
      else proceedsP += lump.amount;
    }

    const personalPct = openingPersonal > 0 ? openingPersonal * (feeAnnual / 12) : 0;
    const superPct = openingSuper > 0 ? openingSuper * (feeAnnual / 12) : 0;
    const personalNet = openingPersonal * (1 + r) - openingPersonal;
    const superNet = openingSuper * (1 + r) - openingSuper;

    const hasPersonalEvent = extraP !== 0 || removed !== 0 || proceedsP !== 0;
    if (hasPersonalEvent) {
      personal = openingPersonal * (1 + r) + c + extraP - removed + proceedsP - sp - mFix;
    } else {
      personal = openingPersonal * (1 + r) + c - sp - mFix;
    }

    if (extraS !== 0 || proceedsS !== 0) {
      superBal = openingSuper * (1 + r) + extraS + proceedsS;
    } else if (openingSuper !== 0) {
      superBal = openingSuper * (1 + r);
    }

    let personalShort = 0;
    if (personal < 0) {
      personalShort = -personal;
      personal = 0;
    }
    let superShort = 0;
    if (superBal < 0) {
      superShort = -superBal;
      superBal = 0;
    }

    if (personal <= 0 && dep == null) dep = age;

    const deposited = c + extraP + extraS + proceedsP + proceedsS;
    totalContributed += deposited;
    cumulativeDeposits += deposited;

    yGrowth += personalNet + personalPct + superNet + superPct;
    yFees += personalPct + superPct + mFix;
    yWithdraw += sp;
    yContrib += deposited;
    yExisting += c;
    yAdditional += extraP + extraS;
    yLump += proceedsP + proceedsS;
    yRemoved += removed;
    yUnfunded += personalShort + superShort;

    if (m % 12 === 0) {
      pushRow(age, m, {
        contributions: yContrib,
        existingContributions: yExisting,
        additionalContributions: yAdditional,
        lumpSums: yLump,
        growth: yGrowth,
        fees: yFees,
        withdrawals: yWithdraw,
        assetRemoved: yRemoved,
        unfunded: yUnfunded,
      });
      yGrowth = 0;
      yFees = 0;
      yWithdraw = 0;
      yContrib = 0;
      yExisting = 0;
      yAdditional = 0;
      yLump = 0;
      yRemoved = 0;
      yUnfunded = 0;
    }
  }

  const endNom = superBal === 0 ? personal : personal + superBal;
  return {
    rows,
    endNom,
    endReal: rows[rows.length - 1]?.real ?? endNom,
    depletedAge: dep != null ? Math.floor(dep) : null,
    depletedAgeExact: dep,
    totalContributed,
    totalFees,
    personalEnd: personal,
    superEnd: superBal,
    events: resolved.lumps.map((l) => ({ age: l.age, label: l.label, amount: l.amount, account: l.account })),
  };
}

/** Capital at retirement that funds the entered spend through life expectancy. */
export function requiredCapitalAtRetirement(input = {}) {
  const lifeExpectancy = num(input.lifeExpectancy);
  const retirementAge = num(input.retirementAge);
  const spend = Math.max(0, num(input.annualSpendToday));
  if (!(spend > 0) || !(lifeExpectancy > retirementAge)) return 0;

  const base = {
    currentAge: retirementAge,
    retirementAge,
    horizonYears: lifeExpectancy - retirementAge,
    monthlySave: 0,
    preAnnualGross: num(input.postRealAnnualGross),
    postRealAnnualGross: num(input.postRealAnnualGross),
    inflationAnnual: Math.max(0, num(input.inflationAnnual)),
    annualSpendToday: spend,
    delayYears: 0,
    feeAnnualPre: Math.max(0, num(input.feeAnnualPre)),
    feeAnnualPost: Math.max(0, num(input.feeAnnualPost)),
    fixedFeeAnnual: Math.max(0, num(input.fixedFeeAnnual)),
  };
  const lasts = (assets) => {
    const t = simulate({ ...base, startAssets: assets });
    const short = t.rows.reduce((sum, row) => sum + (row.unfunded || 0), 0);
    if (short > 0.5) return false;
    const d = t.depletedAgeExact == null ? Infinity : t.depletedAgeExact;
    return d >= lifeExpectancy - 1e-6;
  };
  if (!lasts(0) && simulate({ ...base, startAssets: 0 }).depletedAgeExact == null) return 0;
  const max = 1e12;
  if (!lasts(max)) return null;
  let lo = 0;
  let hi = 100000;
  while (!lasts(hi) && hi < max) hi *= 2;
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2;
    if (lasts(mid)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

export function formatContributionSummary(amount, startAge, stopAge, untilEnd) {
  const n = num(amount);
  const money =
    "$" +
    n.toLocaleString("en-AU", {
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    });
  if (untilEnd) return `${money}/month from age ${startAge} until the end of the projection.`;
  return `${money}/month from age ${startAge} until ${stopAge}.`;
}

export function validateSchedule(schedule, ctx) {
  const errors = {};
  const currentAge = num(ctx.currentAge);
  const endAge = num(ctx.endAge);
  const raw = schedule?.amount;
  const amount = parseNumericInput(raw, { money: true });
  if (raw == null || String(raw).trim() === "") errors.amount = "Enter an additional monthly amount.";
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount greater than zero.";

  const start = Number(schedule?.startAge);
  if (!Number.isFinite(start)) errors.startAge = "Enter a start age.";
  else if (start < currentAge) errors.startAge = "Start age is before your current age.";
  else if (start >= endAge) errors.startAge = "Start age is at or after the end of the projection.";

  if (!schedule?.untilEnd) {
    const stop = Number(schedule?.stopAge);
    if (!Number.isFinite(stop)) errors.stopAge = "Enter a stop age.";
    else if (Number.isFinite(start) && stop <= start) errors.stopAge = "Stop age must be after the start age. A schedule from 50 to 55 runs for five years.";
    else if (stop > endAge) errors.stopAge = "Stop age is beyond the projection.";
  }
  return errors;
}

export function validateLump(lump, ctx, lumps = []) {
  const errors = {};
  const currentAge = num(ctx.currentAge);
  const endAge = num(ctx.endAge);
  const startAssets = Math.max(0, num(ctx.startAssets));
  const raw = lump?.amount;
  const amount = parseNumericInput(raw, { money: true });
  if (raw == null || String(raw).trim() === "") errors.amount = "Enter the net amount available to invest.";
  else if (!Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount greater than zero.";

  const age = Number(lump?.age);
  if (!Number.isFinite(age)) errors.age = "Enter the age when this amount is invested.";
  else if (age < currentAge) errors.age = "Investment age is before your current age.";
  else if (age > endAge) errors.age = "Investment age is beyond the projection.";

  const rawOffset = lump?.monthOffset;
  const offset = rawOffset == null || rawOffset === "" ? 0 : Number(rawOffset);
  if (!Number.isInteger(offset) || offset < 0 || offset > 11) {
    errors.monthOffset = "Month offset must be a whole number from 0 to 11.";
  } else if (Number.isFinite(age)) {
    const at = age + offset / 12;
    if (at > endAge + 1e-9) errors.monthOffset = "That month is beyond the projection.";
  }

  if (lump?.transfer) {
    const includedRaw = lump?.includedAmount;
    const included = parseNumericInput(includedRaw, { money: true });
    if (includedRaw == null || String(includedRaw).trim() === "") {
      errors.includedAmount = "Enter the amount of this asset already included in your plan.";
    } else if (!Number.isFinite(included) || included <= 0) {
      errors.includedAmount = "Enter an included amount greater than zero.";
    } else if (included > startAssets) {
      errors.includedAmount = "This is more than your starting balance.";
    } else {
      let used = 0;
      for (const other of lumps) {
        if (!other || other.enabled === false || !other.transfer) continue;
        const value = parseNumericInput(other.includedAmount, { money: true });
        if (Number.isFinite(value) && value > 0) used += value;
      }
      if (used > startAssets + 1e-6) {
        errors.includedAmount = "Included assets add up to more than your starting balance.";
      }
    }
  }
  return errors;
}

export function hasFieldErrors(errors) {
  return Object.keys(errors || {}).length > 0;
}

export function normalizeContributionState(saved) {
  return {
    contributionSchedules: Array.isArray(saved?.contributionSchedules) ? saved.contributionSchedules : [],
    lumpSums: Array.isArray(saved?.lumpSums) ? saved.lumpSums : [],
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
