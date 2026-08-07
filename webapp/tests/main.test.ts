import { describe, expect, it } from "vitest";
import { boot, withCreatedTagPreselected } from "../src/main";

describe("boot", () => {
  it("resolves without throwing when no DOM is present (vitest's node environment)", async () => {
    await expect(boot()).resolves.toBeUndefined();
  });
});

describe("withCreatedTagPreselected", () => {
  it("appends the created tag id when it isn't already selected", () => {
    expect(withCreatedTagPreselected(["tag-vacation"], "tag-new")).toEqual(["tag-vacation", "tag-new"]);
  });

  it("leaves the draft's tags unchanged when nothing was created", () => {
    expect(withCreatedTagPreselected(["tag-vacation"], null)).toEqual(["tag-vacation"]);
  });

  it("doesn't duplicate a tag that's already selected (e.g. a rename, not a create)", () => {
    expect(withCreatedTagPreselected(["tag-vacation"], "tag-vacation")).toEqual(["tag-vacation"]);
  });
});
