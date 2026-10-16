import { describe, expect, it } from "vitest";
import { CATEGORIES, docText, docs } from "./content";

describe("docs content", () => {
  it("has unique, url-safe slugs", () => {
    const slugs = docs.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    slugs.forEach((s) => expect(s).toMatch(/^[a-z0-9-]+$/));
  });

  it("uses only known categories and every category has pages", () => {
    docs.forEach((d) => expect(CATEGORIES).toContain(d.category));
    CATEGORIES.forEach((c) => expect(docs.some((d) => d.category === c)).toBe(true));
  });

  it("keeps the documents grouped in category order", () => {
    const order = docs.map((d) => CATEGORIES.indexOf(d.category));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("has content in every page", () => {
    docs.forEach((d) => {
      expect(d.title.length).toBeGreaterThan(3);
      expect(d.summary.length).toBeGreaterThan(10);
      expect(d.blocks.length).toBeGreaterThan(1);
    });
  });

  it("has non-empty code blocks and consistent tables", () => {
    docs.forEach((d) =>
      d.blocks.forEach((b) => {
        if (b.t === "code") expect(b.code.trim().length).toBeGreaterThan(0);
        if (b.t === "table") b.rows.forEach((r) => expect(r.length).toBe(b.head.length));
      }),
    );
  });

  it("can be searched", () => {
    expect(docs.filter((d) => docText(d).includes("$lookup")).length).toBeGreaterThan(0);
    expect(docs.filter((d) => docText(d).includes("on conflict")).length).toBeGreaterThan(0);
  });
});
