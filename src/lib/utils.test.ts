import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn con tokens de DESIGN.md", () => {
  it("conserva el tamaño propio junto a un color del tema", () => {
    expect(cn("text-sm", "text-label text-muted-foreground")).toBe("text-label text-muted-foreground");
    expect(cn("text-xs", "text-badge-label text-success")).toBe("text-badge-label text-success");
  });

  it("los espaciados propios pisan a los de Tailwind", () => {
    expect(cn("p-2", "p-margin-panel")).toBe("p-margin-panel");
    expect(cn("gap-1", "gap-space-lg")).toBe("gap-space-lg");
  });
});
