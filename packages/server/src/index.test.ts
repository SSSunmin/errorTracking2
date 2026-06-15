import { expect, test } from "vitest";

import { serverAlive } from "./index.js";

test("server package is alive", () => {
  expect(serverAlive).toBe("server package alive");
});
