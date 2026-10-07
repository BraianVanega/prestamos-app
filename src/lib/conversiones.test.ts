import { describe, expect, it } from "vitest";
import { esquemaConversion } from "./conversiones";

const id = "11111111-1111-4111-8111-111111111111";
const base = { fecha: "2026-10-07", ars: "120.000", tc: "1.300,5", notas: " ", lotes: JSON.stringify({ [id]: "120000.00" }) };

describe("esquemaConversion", () => {
  it("parsea montos es-AR y lotes", () => {
    const r = esquemaConversion.parse(base);
    expect([r.ars.toFixed(2), r.tc.toFixed(1), r.notas, r.lotes[id]]).toEqual(["120000.00", "1300.5", null, "120000.00"]);
  });

  it("rechaza TC vacío y lotes mal formados", () => {
    expect(esquemaConversion.safeParse({ ...base, tc: "" }).success).toBe(false);
    expect(esquemaConversion.safeParse({ ...base, lotes: JSON.stringify({ x: "1" }) }).success).toBe(false);
    expect(esquemaConversion.safeParse({ ...base, lotes: JSON.stringify({ [id]: "1,5" }) }).success).toBe(false);
  });
});
