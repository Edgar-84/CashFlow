export function placeholderText(): string {
  return "CashFlow";
}

// Guarded: the vitest suite imports this module directly under a DOM-less
// Node environment to test placeholderText() in isolation.
if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  if (root) {
    root.textContent = placeholderText();
  }
}
