import { expect, test } from "vitest";

import { demoAppAlive } from "./index.js";

test("demo app package is alive", () => {
  expect(demoAppAlive).toBe("demo-app package alive");
});
