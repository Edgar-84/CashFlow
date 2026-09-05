import { describe, expect, it, vi } from "vitest";
import { createNavStack, type NavEntry } from "../src/lib/nav-stack";

function entry(screen: string): NavEntry {
  return { screen, restore: vi.fn() };
}

describe("createNavStack", () => {
  it("starts empty", () => {
    const stack = createNavStack();
    expect(stack.depth()).toBe(0);
    expect(stack.peek()).toBeNull();
  });

  it("push grows the stack and peek returns the top entry", () => {
    const stack = createNavStack();
    const home = entry("home");
    const statistics = entry("statistics");

    stack.push(home);
    expect(stack.depth()).toBe(1);
    expect(stack.peek()).toBe(home);

    stack.push(statistics);
    expect(stack.depth()).toBe(2);
    expect(stack.peek()).toBe(statistics);
  });

  it("replace swaps the top entry without growing the stack", () => {
    const stack = createNavStack();
    const first = entry("statistics");
    const second = entry("statistics");

    stack.push(entry("home"));
    stack.push(first);
    stack.replace(second);

    expect(stack.depth()).toBe(2);
    expect(stack.peek()).toBe(second);
  });

  it("replace on an empty stack behaves as push", () => {
    const stack = createNavStack();
    const home = entry("home");

    stack.replace(home);

    expect(stack.depth()).toBe(1);
    expect(stack.peek()).toBe(home);
  });

  it("pop drops the top entry and returns the one beneath it", () => {
    const stack = createNavStack();
    const home = entry("home");
    const statistics = entry("statistics");
    const expenses = entry("expenses");

    stack.push(home);
    stack.push(statistics);
    stack.push(expenses);

    expect(stack.pop()).toBe(statistics);
    expect(stack.depth()).toBe(2);
    expect(stack.peek()).toBe(statistics);
  });

  it("pop at the floor returns null and does not throw", () => {
    const stack = createNavStack();

    expect(stack.pop()).toBeNull();
    expect(stack.depth()).toBe(0);

    stack.push(entry("home"));
    expect(stack.pop()).toBeNull();
    expect(stack.depth()).toBe(0);
    expect(stack.pop()).toBeNull();
  });

  it("pop never calls the popped entry's restore", () => {
    const stack = createNavStack();
    const statistics = entry("statistics");
    stack.push(entry("home"));
    stack.push(statistics);

    stack.pop();

    expect(statistics.restore).not.toHaveBeenCalled();
  });

  it("reset empties the stack back to the floor", () => {
    const stack = createNavStack();
    stack.push(entry("home"));
    stack.push(entry("statistics"));
    stack.push(entry("expenses"));

    stack.reset();

    expect(stack.depth()).toBe(0);
    expect(stack.peek()).toBeNull();
    expect(stack.pop()).toBeNull();
  });
});
