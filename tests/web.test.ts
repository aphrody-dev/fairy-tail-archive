import { test, expect } from "bun:test";
import { sources, inScope } from "../packages/crawler/sources.ts";
test("web discovery remains within topic and configured origin", () => {
  const source = sources.find((s) => s.id === "wikipedia-en")!;
  expect(
    inScope(
      source,
      "https://en.wikipedia.org/wiki/List_of_Fairy_Tail_episodes",
    ),
  ).toBe(true);
  expect(inScope(source, "https://en.wikipedia.org/wiki/Paris")).toBe(false);
  expect(
    inScope(
      source,
      "https://en.wikipedia.org/w/index.php?title=Fairy_Tail&action=edit",
    ),
  ).toBe(false);
  expect(inScope(source, "https://evil.test/wiki/Fairy_Tail")).toBe(false);
  expect(inScope(source, "https://en.wikipedia.org/wiki/Talk:Fairy_Tail")).toBe(
    false,
  );
});
