import assert from "node:assert/strict";
import { test } from "node:test";
import { runGolden } from "./golden";

test("golden eval suite promotes", async () => {
  const report = await runGolden();
  const failed = report.results.filter((result) => !result.passed);
  assert.deepEqual(failed, []);
  assert.equal(report.decision, "PROMOTE");
});
