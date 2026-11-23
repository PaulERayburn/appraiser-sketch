import { describe, expect, it } from "vitest";
import { Store, newSketch, typingStep } from "../src/app/store.js";

/** Type or delete in the first area's walls box, one keystroke per text, as the app does. */
function type(store: Store, texts: string[]) {
  for (const text of texts) {
    const before = store.state.sketch.structures[0]!.areas[0]!.vectors;
    store.update(
      (draft) => {
        draft.structures[0]!.areas[0]!.vectors = text;
      },
      { coalesce: typingStep("vectors", before, text) },
    );
  }
}
const walls = (store: Store) => store.state.sketch.structures[0]!.areas[0]!.vectors;

describe("undo while typing walls", () => {
  it("keeps one wall's keystrokes in one step", () => {
    expect(typingStep("vectors", "R", "R2")).toBe(typingStep("vectors", "R2", "R24"));
    expect(typingStep("vectors", "R24", "R24 ")).toBe(typingStep("vectors", "R2", "R24"));
  });

  it("starts a new step at each new wall", () => {
    expect(typingStep("vectors", "R24 ", "R24 U")).not.toBe(typingStep("vectors", "R2", "R24"));
  });

  it("starts a new step when typing turns to deleting", () => {
    expect(typingStep("vectors", "R24", "R2")).not.toBe(typingStep("vectors", "R2", "R24"));
  });

  it("undoes one wall at a time", () => {
    const store = new Store(newSketch());
    type(store, ["R", "R2", "R24", "R24 ", "R24 U", "R24 U3", "R24 U30"]);
    store.undo();
    expect(walls(store)).toBe("R24 ");
    store.undo();
    expect(walls(store)).toBe("");
  });

  it("gets the outline back after it is deleted from the box", () => {
    const store = new Store(newSketch());
    const full = "R10\nU5\nR30";
    type(store, ["R", "R1", "R10", "R10\n", "R10\nU", "R10\nU5", "R10\nU5\n", "R10\nU5\nR", "R10\nU5\nR3", full]);
    // Backspace through it, as when clearing the box by mistake.
    type(store, ["R10\nU5\nR3", "R10\nU5\nR", "R10\nU5\n", "R10\nU5", "R10\nU", "R10\n", "R10", "R1", "R", ""]);
    const seen: string[] = [];
    while (store.canUndo && walls(store) !== full) {
      store.undo();
      seen.push(walls(store));
    }
    expect(walls(store)).toBe(full);
    expect(seen.length).toBeLessThanOrEqual(4);
  });

  it("gets the outline back after select-all and delete", () => {
    const store = new Store(newSketch());
    type(store, ["R", "R1", "R10", "R10 ", "R10 U", "R10 U5"]);
    type(store, [""]);
    store.undo();
    expect(walls(store)).toBe("R10 U5");
  });
});
