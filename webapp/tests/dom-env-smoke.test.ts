// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

// Throwaway: proves U0.5's per-file jsdom opt-in works. Deleted in U1.1,
// which replaces it with the real comment-only-save regression test.
describe("jsdom opt-in smoke test", () => {
  it("builds a DOM, dispatches an input event and reads document", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    let fired = false;
    input.addEventListener("input", () => {
      fired = true;
    });
    input.dispatchEvent(new Event("input"));

    expect(fired).toBe(true);
    expect(document.body.contains(input)).toBe(true);
  });
});
