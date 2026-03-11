import { describe, it, expect } from "vitest";
import {
  getRecipe,
  getAllRecipes,
  getRecipeNames,
  type Recipe,
  type Platform,
} from "../recipes/index.js";

const allRecipes = getAllRecipes();
const allNames = getRecipeNames();
const platforms: Platform[] = ["debian", "rhel", "windows"];

// ── Counts ────────────────────────────────────────────────────────────────────

describe("recipe registry", () => {
  it("has 31 recipes", () => {
    expect(allRecipes).toHaveLength(31);
    expect(allNames).toHaveLength(31);
  });

  it("getRecipe returns a recipe for every known name", () => {
    for (const name of allNames) {
      expect(getRecipe(name)).toBeDefined();
    }
  });

  it("getRecipe returns undefined for unknown names", () => {
    expect(getRecipe("nonexistent")).toBeUndefined();
    expect(getRecipe("")).toBeUndefined();
  });

  it("has no duplicate names", () => {
    const unique = new Set(allNames);
    expect(unique.size).toBe(allNames.length);
  });
});

// ── Data integrity ────────────────────────────────────────────────────────────

describe.each(allRecipes)("recipe '$name'", (recipe: Recipe) => {
  it("has required fields", () => {
    expect(recipe.name).toBeTruthy();
    expect(recipe.description).toBeTruthy();
    expect(recipe.timeoutSeconds).toBeGreaterThan(0);
    expect(recipe.timeoutSeconds).toBeLessThanOrEqual(600);
    expect(recipe.platforms).toBeDefined();
  });

  it("name matches its registry key", () => {
    const fetched = getRecipe(recipe.name);
    expect(fetched).toBe(recipe);
  });

  it("has at least one platform variant", () => {
    const variantCount = Object.keys(recipe.platforms).length;
    expect(variantCount).toBeGreaterThanOrEqual(1);
  });

  it("only uses valid platform keys", () => {
    for (const key of Object.keys(recipe.platforms)) {
      expect(platforms).toContain(key);
    }
  });

  it("each variant has a non-empty script and valid shell", () => {
    for (const [platform, variant] of Object.entries(recipe.platforms)) {
      expect(variant!.script).toBeTruthy();
      expect(variant!.script.length).toBeGreaterThan(10);
      expect(["bash", "powershell"]).toContain(variant!.shell);

      // Linux variants must use bash
      if (platform === "debian" || platform === "rhel") {
        expect(variant!.shell).toBe("bash");
      }
      // Windows variants must use powershell
      if (platform === "windows") {
        expect(variant!.shell).toBe("powershell");
      }
    }
  });

  it("dependencies reference existing recipes", () => {
    if (recipe.dependencies) {
      for (const dep of recipe.dependencies) {
        expect(getRecipe(dep)).toBeDefined();
      }
    }
  });
});

// ── Script quality ────────────────────────────────────────────────────────────

describe("bash script quality", () => {
  const bashVariants: { name: string; platform: string; script: string }[] = [];

  for (const recipe of allRecipes) {
    for (const platform of ["debian", "rhel"] as const) {
      const variant = recipe.platforms[platform];
      if (variant) {
        bashVariants.push({ name: recipe.name, platform, script: variant.script });
      }
    }
  }

  it.each(bashVariants)(
    "$name/$platform starts with set -euo pipefail",
    ({ script }) => {
      expect(script).toContain("set -euo pipefail");
    },
  );

  const debianWithApt = bashVariants.filter(
    (v) => v.platform === "debian" && /\bapt(-get)?\b/.test(v.script),
  );

  it.each(debianWithApt)(
    "$name/debian sets DEBIAN_FRONTEND=noninteractive (uses apt)",
    ({ script }) => {
      expect(script).toContain("DEBIAN_FRONTEND=noninteractive");
    },
  );

  it.each(bashVariants)(
    "$name/$platform does not use lsb_release",
    ({ script }) => {
      expect(script).not.toContain("lsb_release");
    },
  );
});

describe("powershell script quality", () => {
  const psVariants: { name: string; script: string }[] = [];

  for (const recipe of allRecipes) {
    const variant = recipe.platforms.windows;
    if (variant) {
      psVariants.push({ name: recipe.name, script: variant.script });
    }
  }

  it.each(psVariants)("$name/windows has no shebang", ({ script }) => {
    expect(script.trimStart()).not.toMatch(/^#!/);
  });
});

// ── Dependency graph ──────────────────────────────────────────────────────────

describe("dependency graph", () => {
  it("has no circular dependencies", () => {
    function hasCycle(name: string, visited: Set<string>): boolean {
      if (visited.has(name)) return true;
      visited.add(name);
      const recipe = getRecipe(name);
      if (!recipe?.dependencies) return false;
      for (const dep of recipe.dependencies) {
        if (hasCycle(dep, new Set(visited))) return true;
      }
      return false;
    }

    for (const name of allNames) {
      expect(hasCycle(name, new Set())).toBe(false);
    }
  });

  it("all dependency chains resolve completely", () => {
    function resolve(name: string, chain: string[] = []): string[] {
      const recipe = getRecipe(name);
      if (!recipe?.dependencies) return chain;
      for (const dep of recipe.dependencies) {
        expect(allNames).toContain(dep);
        resolve(dep, chain);
        chain.push(dep);
      }
      return chain;
    }

    for (const name of allNames) {
      resolve(name);
    }
  });
});
