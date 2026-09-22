/**
 * Golden-set eval runner. Usage: `npm run eval` (needs the same Vertex creds /
 * .env as the app — it makes real Gemini calls). Prints a pass/fail table and
 * exits non-zero on any failure, so it can gate a prompt change in CI later.
 *
 * Run this BEFORE and AFTER a prompt rewrite; ship the rewrite only if the
 * pass-rate is >= the baseline.
 *
 * Model migration (Gemini 2.5 → 3.x): the model and temperature policy are env
 * driven, so the same golden set compares candidates without a code change:
 *
 *   EVAL_MODEL=gemini-3.6-flash EVAL_REPEATS=3 npm run eval
 *   EVAL_MODEL=gemini-3.5-flash-lite AI_TEMPERATURE_MODE=model-default npm run eval
 *
 * `EVAL_REPEATS` (default 1) runs every case N times. A case that passes on some
 * runs and fails on others is FLAKY — on the extraction surfaces that matters as
 * much as the pass rate, since non-determinism is what users report as "the task
 * turned out different".
 */
import { cases, EVAL_MODEL } from "./cases.js";

interface CaseResult {
  id: string;
  passes: number;
  runs: number;
  avgMs: number;
  firstFailure: string | null;
}

async function runCase(c: (typeof cases)[number], repeats: number): Promise<CaseResult> {
  let passes = 0;
  let totalMs = 0;
  let firstFailure: string | null = null;

  for (let i = 0; i < repeats; i++) {
    const startedAt = Date.now();
    try {
      const detail = c.assert(await c.run());
      if (detail === null) passes++;
      else firstFailure ??= detail;
    } catch (err) {
      firstFailure ??= `ERROR — ${err instanceof Error ? err.message : String(err)}`;
    }
    totalMs += Date.now() - startedAt;
  }

  return {
    id: c.id,
    passes,
    runs: repeats,
    avgMs: Math.round(totalMs / repeats),
    firstFailure,
  };
}

async function main(): Promise<void> {
  const repeats = Number(process.env["EVAL_REPEATS"] ?? "1");
  if (!Number.isInteger(repeats) || repeats < 1) {
    console.error(
      `EVAL_REPEATS must be a positive integer (got ${String(process.env["EVAL_REPEATS"])}).`,
    );
    process.exit(1);
  }
  const tempMode = process.env["AI_TEMPERATURE_MODE"] ?? "configured";
  console.log(
    `Running ${cases.length.toString()} eval cases × ${repeats.toString()} against ` +
      `${EVAL_MODEL} (temperature: ${tempMode})...\n`,
  );

  const startedAt = Date.now();
  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stdout.write(`• ${c.id} ... `);
    const r = await runCase(c, repeats);
    results.push(r);
    const score = `${r.passes.toString()}/${r.runs.toString()}`;
    if (r.passes === r.runs) console.log(`PASS ${score} (${r.avgMs.toString()}ms)`);
    else if (r.passes === 0) console.log(`FAIL ${score} — ${r.firstFailure ?? "?"}`);
    else console.log(`FLAKY ${score} — ${r.firstFailure ?? "?"}`);
  }

  const solid = results.filter((r) => r.passes === r.runs);
  const flaky = results.filter((r) => r.passes > 0 && r.passes < r.runs);
  const failed = results.filter((r) => r.passes === 0);
  const totalRuns = results.reduce((n, r) => n + r.runs, 0);
  const totalPasses = results.reduce((n, r) => n + r.passes, 0);

  console.log(
    `\n${solid.length.toString()}/${cases.length.toString()} cases fully passed` +
      ` · ${flaky.length.toString()} flaky · ${failed.length.toString()} failed`,
  );
  console.log(
    `${totalPasses.toString()}/${totalRuns.toString()} individual runs passed` +
      ` · ${((Date.now() - startedAt) / 1000).toFixed(1)}s wall clock` +
      ` · model ${EVAL_MODEL}`,
  );
  if (flaky.length > 0) console.log(`Flaky: ${flaky.map((r) => r.id).join(", ")}`);
  if (failed.length > 0) console.log(`Failed: ${failed.map((r) => r.id).join(", ")}`);

  process.exit(totalPasses === totalRuns ? 0 : 1);
}

void main();
