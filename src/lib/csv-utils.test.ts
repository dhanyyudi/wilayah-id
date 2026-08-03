import { describe, expect, it } from "vitest";
import { serializeCSV } from "./csv-utils";

describe("serializeCSV", () => {
  it.each([
    ["plain text", "plain text"],
    ["text,with,commas", '"text,with,commas"'],
    [42, "42"],
    [true, "true"],
    [null, ""],
    [undefined, ""],
    [["a", "b"], "a,b"],
    [{ code: "31" }, "[object Object]"],
  ])("preserves the legacy Array.join conversion for %j", (value, expected) => {
    expect(serializeCSV([{ value }])).toBe(`value\n${expected}`);
  });

  it("omits geometry fields from headers and rows", () => {
    expect(serializeCSV([{ code: "31", geom: "ignored", geometry: "ignored" }]))
      .toBe("code\n31");
  });
});
