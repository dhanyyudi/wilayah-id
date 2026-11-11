import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots.txt", () => {
  it("leaves the website open and closes the API and the tiles", () => {
    expect(robots().rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/tiles/"],
    });
  });
});
