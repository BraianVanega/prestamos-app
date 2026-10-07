/** Listado de pagos contra la base real (siempre ROLLBACK). */
import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, type Tx } from "@/db";
import { insertarPrestamo } from "@/db/alta-prestamo";
import { anular } from "@/db/anulaciones";
import { insertarConversion } from "@/db/conversion";
import { cargarPagos } from "@/db/listado-pagos";
import { cargarDeudaCliente, insertarPago } from "@/db/registrar-pago";
import { clientes, participantes, usuarios } from "@/db/schema";
import { deudasAFecha, distribuirFifo } from "@/engine/pago";

class Rollback extends Error {}

async function enRollback(fn: (tx: Tx) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      await tx.execute(sql`set constraints all immediate`);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    return;
  }
  throw new Error("La transacción no terminó en ROLLBACK");
}

describe("cargarPagos", () => {
  it("transferencia, efectivo convertido en parte, saldo a favor y anulado", async () => {
    await enRollback(async (tx) => {
      const [u] = await tx.insert(usuarios).values({ email: `test-${crypto.randomUUID()}@test.local`, nombre: "Test" }).returning();
      await tx.execute(sql`select set_config('app.usuario_id', ${u!.id}, true)`);
      const [c] = await tx.insert(clientes).values({ nombre: "Cliente listado", creadoPor: u!.id }).returning();
      let [soc] = await tx.select().from(participantes).where(eq(participantes.tipo, "sociedad"));
      soc ??= (await tx.insert(participantes).values({ nombre: "Sociedad", tipo: "sociedad" }).returning())[0];
      const { id: prestamoId } = await insertarPrestamo(
        tx,
        {
          clienteId: c!.id,
          fechaDesembolso: "2026-01-01",
          arsCapital: new Decimal("100000"),
          tcEntrada: new Decimal("1600"),
          tasaMensualPct: new Decimal("10"),
          tasaTotalPct: new Decimal("20"),
          frecuencia: "mes",
          nCuotas: 2,
          moraPct: new Decimal("20"),
          diasGracia: 5,
          notas: null,
        },
        { usuarioId: u!.id, sociedadId: soc!.id },
      );
      const pagar = async (fecha: string, ars: string, efectivo: boolean, imputar = ars) => {
        const { deudas } = deudasAFecha(await cargarDeudaCliente(tx, c!.id), fecha);
        const { pagoId } = await insertarPago(
          tx,
          {
            clienteId: c!.id,
            fecha,
            tipo: efectivo ? "efectivo" : "transferencia",
            ars: new Decimal(ars),
            tcSalida: efectivo ? null : new Decimal("1500"),
            metodo: efectivo ? null : "Banco",
            notas: null,
            montos: distribuirFifo(imputar, deudas),
            usarSaldo: false,
            descuentos: new Map(),
            motivoDescuento: null,
          },
          { usuarioId: u!.id },
        );
        return pagoId!;
      };
      const transf = await pagar("2026-01-10", "30000", false, "20000"); // 10.000 a saldo a favor
      const efvo = await pagar("2026-01-12", "40000", true);
      await insertarConversion(
        tx,
        { fecha: "2026-01-13", ars: new Decimal("16000"), tc: new Decimal("1600"), notas: null, lotes: new Map([[efvo, new Decimal("16000")]]) },
        { usuarioId: u!.id },
      );
      const anulado = await pagar("2026-01-14", "1000", true);
      await anular(tx, "pagos", { id: anulado, motivo: "Duplicado" }, { usuarioId: u!.id, hoy: "2026-01-14" });

      const lista = (await cargarPagos(tx)).filter((p) => p.cliente.id === c!.id);
      expect(lista.map((p) => p.id)).toEqual([anulado, efvo, transf]);
      const [a, e, t] = lista;
      expect([t!.usdt.toFixed(8), t!.saldoFavor.toFixed(2), t!.conversion, t!.metodo]).toEqual(["20.00000000", "10000.00", null, "Banco"]);
      expect(t!.prestamos.map((x) => [x.id, x.ars.toFixed(2)])).toEqual([[prestamoId, "20000.00"]]);
      expect([e!.conversion, e!.convertidoArs!.toFixed(2), e!.usdt.toFixed(8)]).toEqual(["parcial", "16000.00", "10.00000000"]);
      expect([a!.anulado, a!.motivoAnulacion]).toEqual([true, "Duplicado"]);
    });
  });
});
