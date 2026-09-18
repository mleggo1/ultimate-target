import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blueprintCalculateCompound,
  getBalanceAtAge,
  maxSustainableSpendToday,
  parseNumericInput,
  principalInvestedToRetirement,
  rowAtAge,
  simulate,
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
