import Decimal from "decimal.js";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BotonAnular } from "@/components/app/boton-anular";
import { Pestanas } from "@/components/app/pestanas";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/db";
import { cargarPagos, type PagoListado } from "@/db/listado-pagos";
import { formatearDocumento, formatearFecha } from "@/lib/formato";
import { formatearArs, formatearTc, formatearUsdt } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pagos · Cierre & Reparto" };

const POR_PAGINA = 25;

const FILTROS = {
  todos: { etiqueta: "Todos", incluye: () => true },
  transferencia: { etiqueta: "Transferencias", incluye: (p: PagoListado) => !p.anulado && p.tipo === "transferencia" },
  efectivo: { etiqueta: "Efectivo", incluye: (p: PagoListado) => !p.anulado && p.tipo === "efectivo" },
  "sin-convertir": {
    etiqueta: "Sin convertir",
    incluye: (p: PagoListado) => !p.anulado && (p.conversion === "sin_convertir" || p.conversion === "parcial"),
  },
  "con-saldo": { etiqueta: "Con saldo a favor", incluye: (p: PagoListado) => !p.anulado && p.saldoFavor.gt(0) },
  anulados: { etiqueta: "Anulados", incluye: (p: PagoListado) => p.anulado },
} as const;
type Filtro = keyof typeof FILTROS;
const esFiltro = (v: unknown): v is Filtro => typeof v === "string" && v in FILTROS;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Busca por cliente, DNI/CUIT o N° de préstamo imputado ("14", "#PR-0014"). */
function coincide(p: PagoListado, q: string): boolean {
  const numero = /^#?\s*(?:pr)?-?\s*0*(\d+)$/i.exec(q);
  if (numero && p.prestamos.some((x) => x.numero === Number.parseInt(numero[1]!, 10))) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos.length >= 3 && p.cliente.documento?.includes(digitos)) return true;
  return sinAcentos(p.cliente.nombre).includes(sinAcentos(q));
}

export default async function PagosPage({ searchParams }: PageProps<"/pagos">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const mes = typeof params.mes === "string" && MES.test(params.mes) ? params.mes : "";
  const filtro: Filtro = esFiltro(params.tipo) ? params.tipo : "todos";
  const paginaPedida = typeof params.pagina === "string" ? Number.parseInt(params.pagina, 10) || 1 : 1;

  const todos = await cargarPagos(db);
  const buscados = todos.filter((p) => (!q || coincide(p, q)) && (!mes || p.fecha.startsWith(mes)));
  const visibles = buscados.filter(FILTROS[filtro].incluye);

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pagina = Math.min(Math.max(1, paginaPedida), paginas);
  const desde = (pagina - 1) * POR_PAGINA;
  const filas = visibles.slice(desde, desde + POR_PAGINA);

  // Totales sin anulados.
  const vigentes = visibles.filter((p) => !p.anulado);
  const sumar = (f: (p: PagoListado) => Decimal) => vigentes.reduce((s, p) => s.plus(f(p)), new Decimal(0));
  const totalArs = sumar((p) => p.ars);
  const totalUsdt = sumar((p) => p.usdt);
  const sinConvertir = sumar((p) => (p.convertidoArs ? p.ars.minus(p.convertidoArs) : new Decimal(0)));

  const href = (cambios: { tipo?: Filtro; pagina?: number }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (mes) sp.set("mes", mes);
    const t = cambios.tipo ?? filtro;
    if (t !== "todos") sp.set("tipo", t);
    const pg = cambios.pagina ?? 1;
    if (pg > 1) sp.set("pagina", String(pg));
    const s = sp.toString();
    return s ? `/pagos?${s}` : "/pagos";
  };

  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap";
  const num = "px-space-md py-space-sm text-right font-mono tabular-nums whitespace-nowrap";

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex flex-wrap items-center gap-gutter">
        <h1 className="text-headline-xl text-on-surface">Pagos</h1>
        <Link href="/pagos/nuevo" className={cn(buttonVariants(), "ml-auto gap-space-sm")}>
          <Plus aria-hidden />
          Registrar pago
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-gutter">
        <Pestanas
          etiqueta="Filtrar pagos"
          items={(Object.keys(FILTROS) as Filtro[]).map((f) => ({
            etiqueta: FILTROS[f].etiqueta,
            cantidad: buscados.filter(FILTROS[f].incluye).length,
            href: href({ tipo: f }),
            activa: f === filtro,
          }))}
        />
        <form action="/pagos" role="search" className="ml-auto flex w-full max-w-lg items-center gap-space-sm">
          {filtro !== "todos" && <input type="hidden" name="tipo" value={filtro} />}
          <Input
            name="mes"
            type="month"
            defaultValue={mes}
            aria-label="Mes"
            className="w-40 shrink-0 bg-surface-container-lowest font-mono tabular-nums"
          />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-space-md size-4 -translate-y-1/2 text-on-surface-variant" aria-hidden />
            <Input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Cliente, DNI o N° de préstamo…"
              aria-label="Filtrar pagos"
              className="bg-surface-container-lowest pl-8"
            />
          </div>
          <button type="submit" className={buttonVariants({ variant: "outline" })}>
            Filtrar
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="border-b border-outline-variant bg-surface-container-low">
              <tr>
                <th className={cn(th, "text-left")}>Fecha</th>
                <th className={cn(th, "text-left")}>Cliente</th>
                <th className={cn(th, "text-left")}>Tipo</th>
                <th className={cn(th, "text-right")}>Monto ARS</th>
                <th className={cn(th, "text-right")}>TC salida</th>
                <th className={cn(th, "text-right")}>USDT</th>
                <th className={cn(th, "text-left")}>Imputado a</th>
                <th className={cn(th, "text-left")}>Registró</th>
                <th className={th}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => (
                <FilaPago key={p.id} p={p} num={num} />
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-space-md py-margin-panel text-center text-body-lg text-on-surface-variant">
                    {todos.length === 0 ? "Todavía no hay pagos." : "No hay pagos que coincidan con el filtro."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-margin gap-y-space-sm border-t border-outline-variant bg-surface-container-low px-space-md py-space-sm text-body-md">
          <span className="font-medium text-on-surface">
            {visibles.length === 0 ? (
              "Sin resultados"
            ) : (
              <>
                Mostrando <span className="font-mono tabular-nums">{desde + 1}–{desde + filas.length}</span> de{" "}
                <span className="font-mono tabular-nums">{visibles.length}</span> pagos
              </>
            )}
          </span>
          <span className="text-on-surface-variant">
            Cobrado: <span className="font-mono text-on-surface tabular-nums">${formatearArs(totalArs)}</span>
          </span>
          <span className="text-on-surface-variant">
            En USDT: <span className="font-mono text-tertiary tabular-nums">{formatearUsdt(totalUsdt)} USDT</span>
          </span>
          {sinConvertir.gt(0) && (
            <span className="text-on-surface-variant">
              Efectivo sin convertir: <span className="font-mono text-riesgo-amarillo-fg tabular-nums">${formatearArs(sinConvertir)}</span>
            </span>
          )}
          {paginas > 1 && (
            <nav aria-label="Páginas" className="ml-auto flex items-center gap-space-xs">
              <Link
                href={href({ pagina: pagina - 1 })}
                aria-disabled={pagina === 1}
                className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), pagina === 1 && "pointer-events-none opacity-40")}
                aria-label="Página anterior"
              >
                <ChevronLeft aria-hidden />
              </Link>
              <span className="font-mono tabular-nums">
                {pagina} / {paginas}
              </span>
              <Link
                href={href({ pagina: pagina + 1 })}
                aria-disabled={pagina === paginas}
                className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), pagina === paginas && "pointer-events-none opacity-40")}
                aria-label="Página siguiente"
              >
                <ChevronRight aria-hidden />
              </Link>
            </nav>
          )}
        </div>
      </div>
    </section>
  );
}

function FilaPago({ p, num }: { p: PagoListado; num: string }) {
  const tachado = p.anulado && "line-through";
  return (
    <tr className={cn("border-b border-outline-variant/60 align-top transition-colors last:border-b-0 hover:bg-primary/4", p.anulado && "text-on-surface-variant")}>
      <td className={cn("px-space-md py-space-sm font-mono text-data-cell whitespace-nowrap tabular-nums", tachado)}>{formatearFecha(p.fecha)}</td>
      <td className="px-space-md py-space-sm">
        <div className="flex min-w-0 flex-col">
          <Link href={`/clientes/${p.cliente.id}`} className="truncate text-body-lg font-medium text-on-surface hover:text-primary">
            {p.cliente.nombre}
          </Link>
          {p.cliente.documento && (
            <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">{formatearDocumento(p.cliente.documento)}</span>
          )}
        </div>
      </td>
      <td className="px-space-md py-space-sm text-body-md whitespace-nowrap">
        <span className="font-medium text-on-surface">{p.tipo === "efectivo" ? "Efectivo" : "Transferencia"}</span>
        {p.metodo && <span className="block text-body-sm text-on-surface-variant">{p.metodo}</span>}
      </td>
      <td className={cn(num, "text-data-currency-primary text-on-surface", tachado)}>${formatearArs(p.ars)}</td>
      <td className={cn(num, "text-data-cell text-on-surface-variant", tachado)}>{p.tcSalida ? `$${formatearTc(p.tcSalida)}` : "—"}</td>
      <td className={cn(num, "text-data-cell")}>
        <Usdt p={p} />
      </td>
      <td className="px-space-md py-space-sm">
        <ul className="flex flex-col gap-space-2xs">
          {p.prestamos.map((x) => (
            <li key={x.id} className="flex items-baseline gap-space-sm font-mono text-data-cell whitespace-nowrap tabular-nums">
              <Link href={`/prestamos/${x.id}`} className="font-semibold text-primary hover:underline">
                {numeroPrestamo(x.numero)}
              </Link>
              <span className="text-on-surface-variant">${formatearArs(x.ars)}</span>
            </li>
          ))}
          {p.saldoFavor.gt(0) && (
            <li className="font-mono text-data-cell whitespace-nowrap text-tertiary tabular-nums">Saldo a favor ${formatearArs(p.saldoFavor)}</li>
          )}
        </ul>
      </td>
      <td className="px-space-md py-space-sm text-body-md whitespace-nowrap text-on-surface">{p.usuario}</td>
      <td className="px-space-md py-space-sm text-right">
        {p.anulado ? (
          <span className="flex flex-col items-end">
            <span className="text-body-sm font-medium text-error">Anulado</span>
            {p.motivoAnulacion && <span className="max-w-48 text-body-sm text-on-surface-variant">{p.motivoAnulacion}</span>}
          </span>
        ) : (
          <BotonAnular
            entidad="pagos"
            id={p.id}
            titulo="el pago"
            detalle={`Pago ${p.tipo === "efectivo" ? "en efectivo" : "por transferencia"} de $${formatearArs(p.ars)} de ${p.cliente.nombre} (${formatearFecha(p.fecha)})`}
            aviso="Se anula el pago completo (todas sus imputaciones y el saldo a favor que se haya aplicado desde él). Si era efectivo ya convertido, anulá antes la conversión. La mora y los descuentos que nacieron con el pago se anulan aparte, desde la ficha."
          />
        )}
      </td>
    </tr>
  );
}

function Usdt({ p }: { p: PagoListado }) {
  if (p.anulado && p.tipo === "efectivo") return <span className="text-on-surface-variant">—</span>;
  if (p.conversion === "sin_convertir") {
    return (
      <span className="rounded-full border border-riesgo-amarillo-borde bg-riesgo-amarillo-bg px-space-sm py-space-2xs font-sans text-badge-label text-riesgo-amarillo-fg">
        Sin convertir
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      <span className={cn("text-on-surface", p.anulado && "line-through")}>{formatearUsdt(p.usdt)} USDT</span>
      {p.conversion === "parcial" && (
        <span className="text-body-sm text-riesgo-amarillo-fg">
          Falta convertir ${formatearArs(p.ars.minus(p.convertidoArs!))}
        </span>
      )}
    </span>
  );
}
