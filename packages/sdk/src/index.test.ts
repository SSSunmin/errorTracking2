import { expect, test } from "vitest";

import { sdkAlive } from "./index.js";

test("sdk package is alive", () => {
  expect(sdkAlive).toBe("sdk package alive");
});
