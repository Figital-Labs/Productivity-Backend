/**
 * Golden-set eval runner. Usage: `npm run eval` (needs the same Vertex creds /
 * .env as the app — it makes real Gemini calls). Prints a pass/fail table and
 * exits non-zero on any failure, so it can gate a prompt change in CI later.
 *
 * Run this BEFORE and AFTER a prompt rewrite; ship the rewrite only if the
 * pass-rate is >= the baseline.
 */
import { cases } from "./cases.js";

async function main(): Promise<void> {
  console.log(`Running ${cases.length.toString()} eval cases against ${"gemini-2.5-flash"}...\n`);
  let failures = 0;

  for (const c of cases) {
    process.stdout.write(`• ${c.id} ... `);
    try {
      const result = await c.run();
      const detail = c.assert(result);
      if (detail === null) {
        console.log("PASS");
      } else {
        failures++;
        console.log(`FAIL — ${detail}`);
      }
    } catch (err) {
      failures++;
      console.log(`ERROR — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const passed = cases.length - failures;
  console.log(`\n${passed.toString()}/${cases.length.toString()} passed.`);
  process.exit(failures > 0 ? 1 : 0);
}

void main();
