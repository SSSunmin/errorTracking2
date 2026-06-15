import { expect, test } from "vitest";

import { dashboardAlive } from "./index.js";

test("dashboard package is alive", () => {
  expect(dashboardAlive).toBe("dashboard package alive");
});
