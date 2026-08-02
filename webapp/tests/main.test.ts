import { describe, expect, it } from "vitest";
import { boot } from "../src/main";

describe("boot", () => {
  it("resolves without throwing when no DOM is present (vitest's node environment)", async () => {
    await expect(boot()).resolves.toBeUndefined();
  });
});
