import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn con tokens de DESIGN.md", () => {
  it("conserva el tamaño propio junto a un color del tema", () => {
    expect(cn("text-sm", "text-label-caps text-on-surface-variant")).toBe("text-label-caps text-on-surface-variant");
    expect(cn("text-xs", "text-badge-label text-riesgo-verde-fg")).toBe("text-badge-label text-riesgo-verde-fg");
  });

  it("los espaciados propios pisan a los de Tailwind", () => {
    expect(cn("p-2", "p-margin-panel")).toBe("p-margin-panel");
    expect(cn("gap-1", "gap-space-lg")).toBe("gap-space-lg");
  });
});
