import assert from "node:assert/strict";
import test from "node:test";
import { hapticTap } from "./haptic";

test("tap feedback vibrates only when the API exists", () => {
  const calls: number[] = [];
  hapticTap({ vibrate: (ms) => { calls.push(ms); return true; } });
  assert.deepEqual(calls, [10]);
  hapticTap(undefined);
  hapticTap({});
  hapticTap({ vibrate: () => { throw new Error("blocked"); } });
  assert.deepEqual(calls, [10]);
});
