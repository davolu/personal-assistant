import { runGolden } from "../src/assistant/golden";

const report = await runGolden();
const failed = report.results.filter((result) => !result.passed);
console.log(`${report.decision}  ${report.results.length - failed.length}/${report.results.length} golden cases`);
for (const result of failed) {
  console.error(`FAIL ${result.id} [${result.dimension}] ${result.detail ?? ""}`);
}
if (report.decision !== "PROMOTE") process.exit(1);
