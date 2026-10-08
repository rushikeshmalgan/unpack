import { describe, expect, it } from "vitest";
import { resolversFor } from "@/lib/pipeline/resolvers/registry";

describe("resolversFor", () => {
  it("routes github_repo to the github resolver", () => {
    const ids = resolversFor("github_repo").map((r) => r.id);
    expect(ids).toContain("github");
  });

  it("routes video to the youtube resolver", () => {
    expect(resolversFor("video").map((r) => r.id)).toContain("youtube");
  });

  it("routes an unrecognized/other type to the web-search fallback only", () => {
    const ids = resolversFor("other:some-made-up-type").map((r) => r.id);
    expect(ids).toEqual(["web_search"]);
  });

  it("always includes the web-search fallback alongside specific resolvers", () => {
    expect(resolversFor("github_repo").map((r) => r.id)).toContain("web_search");
  });

  it("routes library_package to both github and npm resolvers", () => {
    const ids = resolversFor("library_package").map((r) => r.id);
    expect(ids).toContain("github");
    expect(ids).toContain("npm");
  });

  it("ranks the package registry ahead of GitHub for library_package, with web search always last", () => {
    expect(resolversFor("library_package").map((r) => r.id)).toEqual(["npm", "github", "web_search"]);
  });
});
