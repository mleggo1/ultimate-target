import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blueprintCalculateCompound,
  formatContributionSummary,
  getBalanceAtAge,
  hasFieldErrors,
  maxSustainableSpendToday,
  normalizeContributionState,
  parseNumericInput,
  principalInvestedToRetirement,
  requiredCapitalAtRetirement,
  resolveContributions,
  rowAtAge,
  simulate,
  validateLump,
  validateSchedule,
} from "./simulate.js";

function accumulation(overrides = {}) {
  const currentAge = overrides.currentAge ?? 30;
  const targetAge = overrides.targetAge ?? 65;
  return simulate({
    currentAge,
    retirementAge: overrides.retirementAge ?? targetAge,
    horizonYears: overrides.horizonYears ?? targetAge - currentAge,
    startAssets: overrides.startAssets ?? 0,
    monthlySave: overrides.monthlySave ?? 100,
    preAnnualGross: overrides.preAnnualGross ?? 0.08,
    postRealAnnualGross: overrides.postRealAnnualGross ?? 0.08,
    inflationAnnual: overrides.inflationAnnual ?? 0,
    annualSpendToday: overrides.annualSpendToday ?? 0,
    delayYears: overrides.delayYears ?? 0,
    feeAnnualPre: overrides.feeAnnualPre ?? 0,
    feeAnnualPost: overrides.feeAnnualPost ?? 0,
    fixedFeeAnnual: overrides.fixedFeeAnnual ?? 0,
  });
}

function expectBlueprintMatch({ startAge, monthly, years, annualReturn, initial = 0, label }) {
  const bp = blueprintCalculateCompound(startAge, monthly, years, annualReturn, initial);
  const ut = accumulation({
    currentAge: startAge,
    targetAge: startAge + years,
    startAssets: initial,
    monthlySave: monthly,
    preAnnualGross: annualReturn / 100,
    postRealAnnualGross: annualReturn / 100,
  });

  assert.deepEqual(ut.rows.map((r) => r.age), bp.map((r) => r.age), `${label} ages`);
  for (const row of bp) {
    const u = ut.rows.find((r) => r.age === row.age);
    assert.ok(u, `${label} missing age ${row.age}`);
    assert.equal(Math.round(u.nominal), row.total, `${label} age ${row.age} total`);
    assert.equal(Math.round(u.contributed), row.contributed, `${label} age ${row.age} contributed`);
  }
}

describe("parseNumericInput", () => {
  it("treats blank or missing values as 0", () => {
    assert.equal(parseNumericInput(""), 0);
    assert.equal(parseNumericInput("   "), 0);
    assert.equal(parseNumericInput(null), 0);
    assert.equal(parseNumericInput(undefined), 0);
  });

  it("parses decimals, money formatting, and rejects invalid text", () => {
    assert.equal(parseNumericInput("7.5"), 7.5);
    assert.equal(parseNumericInput("1500.50", { money: true }), 1500.5);
    assert.equal(parseNumericInput("$1,500.25", { money: true }), 1500.25);
    assert.equal(parseNumericInput("A$1,500", { money: true }), 1500);
    assert.equal(Number.isNaN(parseNumericInput("abc")), true);
    assert.equal(parseNumericInput("-100"), -100);
    assert.equal(parseNumericInput("-50", { money: true }), -50);
  });
});

describe("age and projection timing", () => {
  it("treats current age 30 as the start of the 30-to-31 year", () => {
    const ut = accumulation({
      currentAge: 30,
      targetAge: 32,
      startAssets: 1000,
      monthlySave: 100,
    });
    assert.deepEqual(ut.rows.map((r) => r.age), [30, 31, 32]);
    assert.equal(ut.rows[0].nominal, 1000);
    assert.equal(ut.rows[0].contributed, 1000);
    assert.equal(ut.rows[1].contributed, 1000 + 100 * 12);
    assert.equal(ut.rows[2].contributed, 1000 + 100 * 24);
  });

  it("has no missing, duplicated, or extra years and ends at the target age", () => {
    const start = 30;
    const end = 90;
    const ut = accumulation({ currentAge: start, targetAge: end, monthlySave: 1500, startAssets: 200000 });
    const ages = ut.rows.map((r) => r.age);
    assert.equal(ages[0], start);
    assert.equal(ages[ages.length - 1], end);
    assert.equal(new Set(ages).size, ages.length);
    assert.deepEqual(ages, Array.from({ length: end - start + 1 }, (_, i) => start + i));
  });

  it("projects only the starting snapshot when current age equals target age", () => {
    const ut = accumulation({ currentAge: 40, targetAge: 40, horizonYears: 0, startAssets: 250000, monthlySave: 1000 });
    assert.equal(ut.rows.length, 1);
    assert.equal(ut.rows[0].age, 40);
    assert.equal(ut.rows[0].nominal, 250000);
    assert.equal(ut.endNom, 250000);
  });

  it("projects exactly one year when asked", () => {
    const ut = accumulation({ currentAge: 40, targetAge: 41, startAssets: 0, monthlySave: 100 });
    assert.deepEqual(ut.rows.map((r) => r.age), [40, 41]);
  });

  it("stops contributions at retirement and starts spend in the following month", () => {
    const ut = simulate({
      currentAge: 40,
      retirementAge: 60,
      horizonYears: 21,
      startAssets: 0,
      monthlySave: 1000,
      preAnnualGross: 0,
      postRealAnnualGross: 0,
      inflationAnnual: 0,
      annualSpendToday: 12000,
      delayYears: 0,
    });
    const at60 = rowAtAge(ut.rows, 60);
    const at61 = rowAtAge(ut.rows, 61);
    assert.equal(at60.contributed, 1000 * 12 * 20);
    assert.equal(at61.contributed, at60.contributed);
    assert.equal(Math.round(at61.nominal), Math.round(at60.nominal - 12000));
  });
});

describe("cross-app reconciliation with Family/Kids Wealth Blueprint", () => {
  it("matches Family Wealth Blueprint default 30–65, $100/mo, 8%", () => {
    expectBlueprintMatch({
      startAge: 30,
      monthly: 100,
      years: 35,
      annualReturn: 8,
      initial: 0,
      label: "FWB default",
    });
  });

  it("matches Kids Wealth Blueprint default 0–28, $100/mo, 8%", () => {
    expectBlueprintMatch({
      startAge: 0,
      monthly: 100,
      years: 28,
      annualReturn: 8,
      initial: 0,
      label: "KWB default",
    });
  });

  it("matches shared scenarios across starting balances, returns, and horizons", () => {
    const scenarios = [
      { startAge: 30, monthly: 100, years: 1, annualReturn: 8, initial: 0, label: "one year" },
      { startAge: 40, monthly: 1500, years: 20, annualReturn: 8, initial: 200000, label: "UT-like accumulation" },
      { startAge: 30, monthly: 1234.56, years: 10, annualReturn: 7.5, initial: 100.25, label: "decimals" },
      { startAge: 40, monthly: 0, years: 25, annualReturn: 8, initial: 50000, label: "zero contributions" },
      { startAge: 25, monthly: 25000, years: 40, annualReturn: 20, initial: 5_000_000, label: "very large" },
      { startAge: 18, monthly: 50, years: 72, annualReturn: 6, initial: 0, label: "long-term" },
      { startAge: 50, monthly: 2000, years: 15, annualReturn: 0, initial: 10000, label: "zero return" },
    ];
    for (const s of scenarios) expectBlueprintMatch(s);
  });

  it("still matches the live Family and Kids Wealth Blueprint source engines", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      path.resolve(here, "../../Family-Wealthblueprint/src/components/FamilyWealthBlueprint.tsx"),
      path.resolve(here, "../../Kids-Wealthblueprint/src/components/KidsWealthBlueprint.tsx"),
    ];
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, "utf8");
      assert.match(src, /const monthlyReturn = annualReturn \/ 100 \/ 12/);
      assert.match(src, /if \(month > 0\) \{/);
      assert.match(src, /balance = balance \* \(1 \+ monthlyReturn\) \+/);
      assert.match(src, /for \(let month = 0; month <= totalMonths; month\+\+\)/);
    }
  });
});

describe("edge cases and dependent results", () => {
  it("treats invalid numeric inputs as 0 and clamps negative balances/fees/inflation/spend", () => {
    const ut = simulate({
      currentAge: "abc",
      retirementAge: NaN,
      horizonYears: undefined,
      startAssets: -5000,
      monthlySave: null,
      preAnnualGross: "nope",
      postRealAnnualGross: "",
      inflationAnnual: -0.05,
      annualSpendToday: -1000,
      delayYears: -3,
      feeAnnualPre: -0.1,
      feeAnnualPost: -0.1,
      fixedFeeAnnual: -2000,
    });
    assert.equal(ut.rows[0].age, 0);
    assert.equal(ut.rows[0].nominal, 0);
    assert.equal(ut.endNom, 0);
  });

  it("updates retirement balance, invested total, and end value when monthly savings change", () => {
    const low = accumulation({ currentAge: 40, targetAge: 60, monthlySave: 1000, startAssets: 200000 });
    const high = accumulation({ currentAge: 40, targetAge: 60, monthlySave: 2000, startAssets: 200000 });
    assert.ok(rowAtAge(high.rows, 60).nominal > rowAtAge(low.rows, 60).nominal);
    assert.ok(high.endNom > low.endNom);
    assert.equal(principalInvestedToRetirement(2000, 40, 60), 2000 * 12 * 20);
    assert.equal(principalInvestedToRetirement(1000, 40, 60), 1000 * 12 * 20);
  });

  it("reduces the retirement balance when contributions are delayed", () => {
    const now = accumulation({ currentAge: 40, targetAge: 60, monthlySave: 1500, startAssets: 200000, delayYears: 0 });
    const delayed = accumulation({ currentAge: 40, targetAge: 60, monthlySave: 1500, startAssets: 200000, delayYears: 3 });
    assert.ok(delayed.endNom < now.endNom);
    assert.equal(rowAtAge(delayed.rows, 43).contributed, 200000);
    assert.equal(rowAtAge(delayed.rows, 44).contributed, 200000 + 1500 * 12);
  });

  it("reduces balances when percentage or fixed fees increase", () => {
    const none = accumulation({ currentAge: 40, targetAge: 90, monthlySave: 1500, startAssets: 200000 });
    const pct = accumulation({
      currentAge: 40,
      targetAge: 90,
      monthlySave: 1500,
      startAssets: 200000,
      feeAnnualPre: 0.012,
      feeAnnualPost: 0.012,
    });
    const fixed = accumulation({
      currentAge: 40,
      targetAge: 90,
      monthlySave: 1500,
      startAssets: 200000,
      fixedFeeAnnual: 2000,
    });
    assert.ok(pct.endNom < none.endNom);
    assert.ok(fixed.endNom < none.endNom);
    assert.ok(pct.totalFees > 0);
    assert.ok(fixed.totalFees > 0);
  });

  it("treats retirement return as nominal and inflates spend from today", () => {
    const base = {
      currentAge: 40,
      retirementAge: 40,
      horizonYears: 10,
      startAssets: 100000,
      monthlySave: 0,
      preAnnualGross: 0.025,
      postRealAnnualGross: 0.025,
      annualSpendToday: 0,
    };
    const noInf = simulate({ ...base, inflationAnnual: 0 });
    const withInf = simulate({ ...base, inflationAnnual: 0.02 });
    assert.equal(Math.round(withInf.endNom), Math.round(noInf.endNom));
    assert.ok(withInf.endReal < withInf.endNom);

    const spend0 = simulate({
      ...base,
      retirementAge: 40,
      startAssets: 200000,
      annualSpendToday: 12000,
      inflationAnnual: 0,
      postRealAnnualGross: 0,
      preAnnualGross: 0,
    });
    const spendInf = simulate({
      ...base,
      retirementAge: 40,
      startAssets: 200000,
      annualSpendToday: 12000,
      inflationAnnual: 0.1,
      postRealAnnualGross: 0,
      preAnnualGross: 0,
    });
    assert.ok(spendInf.endNom < spend0.endNom);
  });

  it("keeps real equal to nominal when inflation is 0", () => {
    const ut = accumulation({ currentAge: 40, targetAge: 90, startAssets: 200000, monthlySave: 1500 });
    assert.ok(Math.abs(ut.endReal - ut.endNom) < 1e-6);
  });

  it("does not increase the ending balance when drawdown spend is added", () => {
    const none = simulate({
      currentAge: 40,
      retirementAge: 60,
      horizonYears: 50,
      startAssets: 200000,
      monthlySave: 1500,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0.02,
      annualSpendToday: 0,
    });
    const spend = simulate({
      currentAge: 40,
      retirementAge: 60,
      horizonYears: 50,
      startAssets: 200000,
      monthlySave: 1500,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0.02,
      annualSpendToday: 60000,
    });
    assert.ok(spend.endNom <= none.endNom);
    assert.ok(spend.endReal <= spend.endNom);
  });

  it("reads the balance at or before a given age", () => {
    const ut = accumulation({ currentAge: 30, targetAge: 35, startAssets: 1000, monthlySave: 0, preAnnualGross: 0 });
    assert.equal(getBalanceAtAge(ut.rows, 32.4), 1000);
    assert.equal(getBalanceAtAge(ut.rows, 30), 1000);
  });
});

describe("sustainable spend", () => {
  it("returns 0 when even zero spend cannot last to life expectancy", () => {
    const spend = maxSustainableSpendToday({
      currentAge: 80,
      retirementAge: 80,
      horizonYears: 10,
      startAssets: 1000,
      monthlySave: 0,
      preAnnualGross: 0,
      postRealAnnualGross: 0,
      inflationAnnual: 0,
      delayYears: 0,
      feeAnnualPre: 0,
      feeAnnualPost: 0,
      fixedFeeAnnual: 5000,
      lifeExpectancy: 90,
    });
    assert.equal(spend, 0);
  });

  it("finds a positive spend that lasts to life expectancy on a large balance", () => {
    const spend = maxSustainableSpendToday({
      currentAge: 60,
      retirementAge: 60,
      horizonYears: 30,
      startAssets: 2_000_000,
      monthlySave: 0,
      preAnnualGross: 0.025,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0,
      delayYears: 0,
      feeAnnualPre: 0,
      feeAnnualPost: 0,
      fixedFeeAnnual: 0,
      lifeExpectancy: 90,
    });
    assert.ok(spend > 0);
    const atSpend = simulate({
      currentAge: 60,
      retirementAge: 60,
      horizonYears: 30,
      startAssets: 2_000_000,
      monthlySave: 0,
      preAnnualGross: 0.025,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0,
      annualSpendToday: spend,
      delayYears: 0,
    });
    assert.ok(atSpend.depletedAge == null || atSpend.depletedAgeExact >= 90 - 0.1);
  });

  it("includes fixed fees in the sustainable spend search", () => {
    const args = {
      currentAge: 60,
      retirementAge: 60,
      horizonYears: 30,
      startAssets: 1_000_000,
      monthlySave: 0,
      preAnnualGross: 0.025,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0,
      delayYears: 0,
      feeAnnualPre: 0,
      feeAnnualPost: 0,
      lifeExpectancy: 90,
    };
    const withoutFixed = maxSustainableSpendToday({ ...args, fixedFeeAnnual: 0 });
    const withFixed = maxSustainableSpendToday({ ...args, fixedFeeAnnual: 10000 });
    assert.ok(withFixed < withoutFixed);
  });
});

function plan(overrides = {}) {
  return {
    currentAge: 40,
    retirementAge: 65,
    horizonYears: 25,
    startAssets: 0,
    monthlySave: 0,
    preAnnualGross: 0,
    postRealAnnualGross: 0,
    inflationAnnual: 0,
    annualSpendToday: 0,
    delayYears: 0,
    feeAnnualPre: 0,
    feeAnnualPost: 0,
    fixedFeeAnnual: 0,
    ...overrides,
  };
}

function reconcile(rows) {
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const row = rows[i];
    const closing =
      prev.nominal +
      row.contributions +
      row.growth -
      row.fees -
      row.withdrawals -
      row.assetRemoved +
      row.unfunded;
    assert.ok(Math.abs(closing - row.nominal) < 1e-6, `age ${row.age} does not reconcile`);
    assert.ok(Math.abs(row.personal + row.super - row.nominal) < 1e-6, `age ${row.age} split`);
  }
}

describe("additional contributions and lump sums", () => {
  it("matches the existing projection when there are no additional entries", () => {
    const base = plan({
      startAssets: 200000,
      monthlySave: 1500,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.025,
      inflationAnnual: 0.02,
      annualSpendToday: 60000,
      delayYears: 3,
      feeAnnualPre: 0.002,
      feeAnnualPost: 0.002,
      fixedFeeAnnual: 0,
      retirementAge: 60,
      horizonYears: 50,
    });
    const plain = simulate(base);
    const empty = simulate({ ...base, additionalSchedules: [], lumpSums: [] });
    const disabled = simulate({
      ...base,
      additionalSchedules: [{ account: "personal", amount: 1000, startAge: 40, stopAge: 50, enabled: false }],
      lumpSums: [{ amount: 10000, age: 50, monthOffset: 0, account: "personal", enabled: false }],
    });
    assert.equal(empty.rows.length, plain.rows.length);
    for (let i = 0; i < plain.rows.length; i++) {
      assert.equal(empty.rows[i].nominal, plain.rows[i].nominal);
      assert.equal(empty.rows[i].contributed, plain.rows[i].contributed);
      assert.equal(empty.rows[i].real, plain.rows[i].real);
      assert.equal(disabled.rows[i].nominal, plain.rows[i].nominal);
    }
    assert.equal(empty.endNom, plain.endNom);
    assert.equal(empty.totalFees, plain.totalFees);
    assert.equal(empty.depletedAgeExact, plain.depletedAgeExact);
  });

  it("adds exactly $22,000 at zero returns and fees for 12 monthly deposits plus a lump sum", () => {
    const lump = { amount: 10000, age: 40, monthOffset: 0, account: "personal", enabled: true, transfer: false };
    const schedule = { account: "personal", amount: 1000, startAge: 40, stopAge: 41, enabled: true };
    const before = simulate(plan({ startAssets: 5000, monthlySave: 200 }));
    const after = simulate(plan({ startAssets: 5000, monthlySave: 200, additionalSchedules: [schedule], lumpSums: [lump] }));
    const at41 = rowAtAge(after.rows, 41).nominal - rowAtAge(before.rows, 41).nominal;
    assert.equal(at41, 22000);
    assert.equal(rowAtAge(after.rows, 40).nominal - rowAtAge(before.rows, 40).nominal, 10000);
    reconcile(after.rows);
  });

  it("earns nothing before the investment date and keeps compounding after deposits stop", () => {
    const schedule = { account: "personal", amount: 1000, startAge: 50, stopAge: 55, enabled: true };
    const lump = { amount: 10000, age: 58, monthOffset: 6, account: "personal", enabled: true };
    const before = simulate(plan({ startAssets: 1000, preAnnualGross: 0.08, postRealAnnualGross: 0.08 }));
    const after = simulate(plan({
      startAssets: 1000,
      preAnnualGross: 0.08,
      postRealAnnualGross: 0.08,
      additionalSchedules: [schedule],
      lumpSums: [lump],
    }));
    assert.equal(rowAtAge(after.rows, 50).nominal, rowAtAge(before.rows, 50).nominal);
    assert.ok(rowAtAge(after.rows, 51).nominal > rowAtAge(before.rows, 51).nominal);
    const extraAt55 = rowAtAge(after.rows, 55).nominal - rowAtAge(before.rows, 55).nominal;
    const extraAt58 = rowAtAge(after.rows, 58).nominal - rowAtAge(before.rows, 58).nominal;
    assert.ok(extraAt58 > extraAt55);
    const flat = simulate(plan({ additionalSchedules: [schedule], lumpSums: [{ ...lump, age: 70, monthOffset: 0 }] }));
    const gained = rowAtAge(flat.rows, 55).nominal - rowAtAge(simulate(plan()).rows, 55).nominal;
    assert.equal(gained, 60000);
    assert.equal(rowAtAge(flat.rows, 65).nominal - rowAtAge(simulate(plan()).rows, 65).nominal, 60000);
    const mid = simulate(plan({ lumpSums: [lump], preAnnualGross: 0.08, postRealAnnualGross: 0.08, startAssets: 0 }));
    assert.equal(rowAtAge(mid.rows, 58).nominal, 0);
    assert.ok(rowAtAge(mid.rows, 59).nominal > 10000);
  });

  it("adds overlapping schedules and simultaneous lump sums", () => {
    const schedules = [
      { account: "personal", amount: 1000, startAge: 50, stopAge: 55, enabled: true },
      { account: "super", amount: 500, startAge: 52, stopAge: 54, enabled: true },
    ];
    const lumps = [
      { id: "a", amount: 5000, age: 60, monthOffset: 0, account: "personal", enabled: true },
      { id: "b", amount: 7000, age: 60, monthOffset: 0, account: "super", enabled: true },
    ];
    const after = simulate(plan({ additionalSchedules: schedules, lumpSums: lumps }));
    assert.equal(rowAtAge(after.rows, 52).super, 0);
    assert.equal(rowAtAge(after.rows, 52).personal, 1000 * 24);
    assert.equal(rowAtAge(after.rows, 54).super, 500 * 24);
    assert.equal(rowAtAge(after.rows, 55).personal, 1000 * 60);
    assert.equal(rowAtAge(after.rows, 60).personal, 1000 * 60 + 5000);
    assert.equal(rowAtAge(after.rows, 60).super, 500 * 24 + 7000);
    assert.equal(formatContributionSummary(1000, 50, 55, false), "$1,000/month from age 50 until 55.");
    reconcile(after.rows);
  });

  it("treats a related sale as a transfer and does not keep the sold asset", () => {
    const lump = {
      id: "sale",
      amount: 80000,
      age: 50,
      monthOffset: 0,
      account: "personal",
      enabled: true,
      transfer: true,
      includedAmount: 100000,
      description: "Property sale",
    };
    const before = simulate(plan({ startAssets: 100000, horizonYears: 15, retirementAge: 55 }));
    const after = simulate(plan({ startAssets: 100000, horizonYears: 15, retirementAge: 55, lumpSums: [lump] }));
    assert.equal(rowAtAge(before.rows, 50).nominal, 100000);
    assert.equal(rowAtAge(after.rows, 49).nominal, 100000);
    assert.equal(rowAtAge(after.rows, 50).nominal, 80000);
    assert.equal(rowAtAge(after.rows, 55).nominal, 80000);
    reconcile(after.rows);
  });

  it("keeps a split starting balance in personal and super", () => {
    const split = simulate(plan({
      startAssets: 300000,
      startPersonal: 100000,
      startSuper: 200000,
      monthlySave: 0,
      annualSpendToday: 12000,
      retirementAge: 40,
      horizonYears: 2,
    }));
    assert.equal(rowAtAge(split.rows, 40).personal, 100000);
    assert.equal(rowAtAge(split.rows, 40).super, 200000);
    assert.equal(rowAtAge(split.rows, 40).nominal, 300000);
    assert.equal(rowAtAge(split.rows, 41).super, 200000);
    assert.ok(rowAtAge(split.rows, 41).personal < 100000);
  });

  it("does not draw super to fund spending when no access age exists", () => {
    const withSuper = simulate(plan({
      currentAge: 60,
      retirementAge: 60,
      horizonYears: 2,
      startAssets: 0,
      annualSpendToday: 12000,
      lumpSums: [{ amount: 50000, age: 60, monthOffset: 0, account: "super", enabled: true }],
    }));
    assert.equal(rowAtAge(withSuper.rows, 60).super, 50000);
    assert.equal(rowAtAge(withSuper.rows, 61).super, 50000);
    assert.equal(rowAtAge(withSuper.rows, 61).personal, 0);
    assert.equal(withSuper.depletedAge, 60);
  });

  it("loads saved plans with no additional contributions and validates fields", () => {
    assert.deepEqual(normalizeContributionState({}), { contributionSchedules: [], lumpSums: [] });
    assert.deepEqual(normalizeContributionState({ contributionSchedules: [{ amount: 1 }], lumpSums: null }), {
      contributionSchedules: [{ amount: 1 }],
      lumpSums: [],
    });
    const ctx = { currentAge: 40, endAge: 65, startAssets: 100000 };
    assert.equal(hasFieldErrors(validateSchedule({ amount: "", startAge: 40, stopAge: 50 }, ctx)), true);
    assert.equal(validateSchedule({ amount: "1000", startAge: 30, stopAge: 50 }, ctx).startAge.includes("before"), true);
    assert.equal(validateSchedule({ amount: "1000", startAge: 50, stopAge: 50 }, ctx).stopAge.includes("after"), true);
    assert.equal(hasFieldErrors(validateSchedule({ amount: "$1,000", startAge: 50, stopAge: 55 }, ctx)), false);
    assert.equal(validateLump({ amount: "10", age: 70, monthOffset: 0 }, ctx).age.includes("beyond"), true);
    assert.equal(validateLump({ amount: "10", age: 50, monthOffset: 12 }, ctx).monthOffset.includes("0 to 11"), true);
    assert.ok(validateLump({ amount: "10", age: 50, monthOffset: 0, transfer: true, includedAmount: "" }, ctx).includedAmount);
    assert.equal(resolveContributions(plan()).schedules.length, 0);
  });

  it("finds retirement capital required to fund spending", () => {
    const target = requiredCapitalAtRetirement({
      retirementAge: 60,
      lifeExpectancy: 90,
      annualSpendToday: 12000,
      postRealAnnualGross: 0,
      inflationAnnual: 0,
      feeAnnualPre: 0,
      feeAnnualPost: 0,
      fixedFeeAnnual: 0,
    });
    assert.equal(target, 12000 * 30);
  });
});
