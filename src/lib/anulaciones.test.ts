import { describe, expect, it } from "vitest";
import { esquemaAnulacion } from "./anulaciones";

const id = "6f1c1d5e-8a3b-4c2d-9e0f-123456789abc";

describe("esquemaAnulacion", () => {
  it("acepta y recorta el motivo", () => {
    expect(esquemaAnulacion.parse({ entidad: "pagos", id, motivo: "  Rebotó  " })).toEqual({ entidad: "pagos", id, motivo: "Rebotó" });
  });

  it("exige motivo y una entidad conocida", () => {
    const r = esquemaAnulacion.safeParse({ entidad: "prestamos", id: "x", motivo: " a " });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0])).toEqual(["entidad", "id", "motivo"]);
  });
});
