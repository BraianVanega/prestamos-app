import Decimal from "decimal.js";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pestanas } from "@/components/app/pestanas";
import { BadgeRiesgo, BarraProgreso, COLORES_RIESGO } from "@/components/app/riesgo";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cargarResumenPrestamos, type ResumenPrestamo } from "@/db/resumen-prestamos";
import { formatearDocumento, formatearFecha } from "@/lib/formato";
import { hoyArgentina } from "@/lib/hoy";
import { formatearArs, formatearTc, formatearUsdt } from "@/lib/numeros";
import { numeroPrestamo } from "@/lib/prestamos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Préstamos · Cierre & Reparto" };

const POR_PAGINA = 25;

const FILTROS = {
  todos: { etiqueta: "Todos", incluye: (p: ResumenPrestamo) => p.estado !== "anulado" },
  "al-dia": { etiqueta: "Al día", incluye: (p: ResumenPrestamo) => p.estado === "vigente" && p.plan.diasAtraso === 0 },
  "en-mora": { etiqueta: "En mora", incluye: (p: ResumenPrestamo) => p.estado === "vigente" && p.plan.diasAtraso > 0 },
  finalizados: { etiqueta: "Finalizados", incluye: (p: ResumenPrestamo) => p.estado === "cancelado" || p.estado === "castigado" },
  refinanciados: { etiqueta: "Refinanciados", incluye: (p: ResumenPrestamo) => p.estado === "refinanciado" },
  anulados: { etiqueta: "Anulados", incluye: (p: ResumenPrestamo) => p.estado === "anulado" },
} as const;
type Filtro = keyof typeof FILTROS;
const esFiltro = (v: unknown): v is Filtro => typeof v === "string" && v in FILTROS;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Busca por cliente, DNI/CUIT o N° de préstamo ("14", "#PR-0014", "pr14"). */
function coincide(p: ResumenPrestamo, q: string): boolean {
  const numero = /^#?\s*(?:pr)?-?\s*0*(\d+)$/i.exec(q);
  if (numero && Number.parseInt(numero[1]!, 10) === p.numero) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos.length >= 3 && p.cliente.documento?.includes(digitos)) return true;
  return sinAcentos(p.cliente.nombre).includes(sinAcentos(q));
}

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default async function PrestamosPage({ searchParams }: PageProps<"/prestamos">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const filtro: Filtro = esFiltro(params.estado) ? params.estado : "todos";
  const paginaPedida = typeof params.pagina === "string" ? Number.parseInt(params.pagina, 10) || 1 : 1;

  const hoy = hoyArgentina();
  const todos = (await cargarResumenPrestamos(hoy)).sort((a, b) => b.numero - a.numero);
  const buscados = q ? todos.filter((p) => coincide(p, q)) : todos;
  const visibles = buscados.filter(FILTROS[filtro].incluye);

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pagina = Math.min(Math.max(1, paginaPedida), paginas);
  const desde = (pagina - 1) * POR_PAGINA;
  const filas = visibles.slice(desde, desde + POR_PAGINA);

  const totalUsdt = visibles.reduce((s, p) => s.plus(p.usdtPrestado), new Decimal(0));
  const totalArs = visibles.reduce((s, p) => s.plus(p.arsCapital), new Decimal(0));
  const totalRecuperado = visibles.reduce((s, p) => s.plus(p.recuperadoUsdt), new Decimal(0));
  const pctRecuperado = totalUsdt.isZero() ? new Decimal(0) : totalRecuperado.div(totalUsdt).times(100);

  const href = (cambios: { estado?: Filtro; pagina?: number }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    const e = cambios.estado ?? filtro;
    if (e !== "todos") sp.set("estado", e);
    const pg = cambios.pagina ?? 1;
    if (pg > 1) sp.set("pagina", String(pg));
    const s = sp.toString();
    return s ? `/prestamos?${s}` : "/prestamos";
  };

  const th = "px-space-md py-space-sm text-label-caps text-on-surface-variant uppercase whitespace-nowrap";
  const num = "px-space-md py-space-sm text-right font-mono tabular-nums whitespace-nowrap";

  return (
    <section className="flex flex-col gap-margin">
      <div className="flex flex-wrap items-center gap-gutter">
        <h1 className="text-headline-xl text-on-surface">Préstamos</h1>
        <Link href="/prestamos/nuevo" className={cn(buttonVariants(), "ml-auto gap-space-sm")}>
          <Plus aria-hidden />
          Nuevo préstamo
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-gutter">
        <Pestanas
          etiqueta="Filtrar por estado"
          items={(Object.keys(FILTROS) as Filtro[])
            .map((f) => ({
              etiqueta: FILTROS[f].etiqueta,
              cantidad: buscados.filter(FILTROS[f].incluye).length,
              href: href({ estado: f }),
              activa: f === filtro,
              // Los anulados (correcciones de carga) solo aparecen si hay.
              oculta: f === "anulados" && f !== filtro && !buscados.some(FILTROS[f].incluye),
            }))
            .filter((i) => !i.oculta)}
        />
        <form action="/prestamos" role="search" className="relative ml-auto w-full max-w-sm">
          {filtro !== "todos" && <input type="hidden" name="estado" value={filtro} />}
          <Search className="pointer-events-none absolute top-1/2 left-space-md size-4 -translate-y-1/2 text-on-surface-variant" aria-hidden />
          <Input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Filtrar por cliente, DNI o N° de préstamo…"
            aria-label="Filtrar préstamos"
            className="bg-surface-container-lowest pl-8"
          />
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="border-b border-outline-variant bg-surface-container-low">
              <tr>
                <th className={cn(th, "text-left")}>N° préstamo</th>
                <th className={cn(th, "text-left")}>Cliente</th>
                <th className={cn(th, "text-left")}>Emisión</th>
                <th className={cn(th, "text-left")}>Dueño capital</th>
                <th className={cn(th, "text-right")}>Capital ARS orig.</th>
                <th className={cn(th, "text-right")}>TC entrada</th>
                <th className={cn(th, "text-right")}>Prestado USDT</th>
                <th className={cn(th, "text-left")}>Recuperado USDT</th>
                <th className={cn(th, "text-left")}>Próxima cuota</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => (
                <FilaPrestamo key={p.id} p={p} num={num} />
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-space-md py-margin-panel text-center text-body-lg text-on-surface-variant">
                    {todos.length === 0 ? "Todavía no hay préstamos." : "No hay préstamos que coincidan con el filtro."}
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
                <span className="font-mono tabular-nums">{visibles.length}</span> préstamos
              </>
            )}
          </span>
          <span className="text-on-surface-variant">
            Total prestado:{" "}
            <span className="font-mono text-on-surface tabular-nums">{formatearUsdt(totalUsdt)} USDT</span>{" "}
            <span className="font-mono tabular-nums">(${formatearArs(totalArs)})</span>
          </span>
          <span className="text-on-surface-variant">
            Total recuperado:{" "}
            <span className="font-mono text-tertiary tabular-nums">
              {formatearUsdt(totalRecuperado)} USDT ({pctRecuperado.toFixed(1).replace(".", ",")}%)
            </span>
          </span>
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

function FilaPrestamo({ p, num }: { p: ResumenPrestamo; num: string }) {
  const pct = p.usdtPrestado.isZero() ? new Decimal(0) : p.recuperadoUsdt.div(p.usdtPrestado).times(100);
  const colores = COLORES_RIESGO[p.riesgo];
  const proxima = p.plan.proxima;

  return (
    <tr className="border-b border-outline-variant/60 transition-colors last:border-b-0 hover:bg-primary/4">
      <td className="px-space-md py-space-sm">
        <Link href={`/prestamos/${p.id}`} className="font-mono text-body-lg font-semibold text-primary tabular-nums hover:underline">
          {numeroPrestamo(p.numero)}
        </Link>
      </td>
      <td className="px-space-md py-space-sm">
        <div className="flex items-center gap-space-md">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-fixed font-mono text-badge-label text-on-primary-fixed-variant">
            {iniciales(p.cliente.nombre)}
          </span>
          <div className="flex min-w-0 flex-col">
            <Link href={`/clientes/${p.cliente.id}`} className="truncate text-body-lg font-medium text-on-surface hover:text-primary">
              {p.cliente.nombre}
            </Link>
            {p.cliente.documento && (
              <span className="font-mono text-data-cell text-on-surface-variant tabular-nums">{formatearDocumento(p.cliente.documento)}</span>
            )}
          </div>
        </div>
      </td>
      <td className="px-space-md py-space-sm font-mono text-data-cell whitespace-nowrap tabular-nums">{formatearFecha(p.fechaDesembolso)}</td>
      <td className="px-space-md py-space-sm">
        <span className="rounded-sm bg-surface-container px-space-sm py-space-2xs text-body-sm whitespace-nowrap text-on-surface-variant">
          {p.dueno}
        </span>
      </td>
      <td className={cn(num, "text-data-cell")}>${formatearArs(p.arsCapital)}</td>
      <td className={cn(num, "text-data-cell text-on-surface-variant")}>${formatearTc(p.tcEntrada)}</td>
      <td className={num}>
        <span className="text-data-currency-primary text-on-surface">{formatearUsdt(p.usdtPrestado)}</span>{" "}
        <span className="text-data-currency-secondary text-on-surface-variant">USDT</span>
      </td>
      <td className="min-w-44 px-space-md py-space-sm">
        <div className="flex items-baseline justify-between gap-space-md font-mono text-data-cell tabular-nums">
          <span className={cn("font-semibold", colores.texto)}>{formatearUsdt(p.recuperadoUsdt)} USDT</span>
          <span className="text-on-surface-variant">{pct.toFixed(0)}%</span>
        </div>
        <div className="mt-space-xs">
          <BarraProgreso pct={pct} nivel={p.riesgo} />
        </div>
      </td>
      <td className="px-space-md py-space-sm text-body-md whitespace-nowrap">
        <ProximaCuota p={p} />
        {proxima && p.estado === "vigente" && (
          <span className="block font-mono text-data-cell text-on-surface-variant tabular-nums">
            {formatearFecha(proxima.vencimiento)}
          </span>
        )}
      </td>
    </tr>
  );
}

function ProximaCuota({ p }: { p: ResumenPrestamo }) {
  if (p.estado !== "vigente") {
    const texto = { cancelado: "Cancelado", castigado: "Castigado", refinanciado: "Refinanciado", anulado: "Anulado" }[p.estado];
    return <span className="font-medium text-on-surface-variant">{texto}</span>;
  }
  const proxima = p.plan.proxima;
  if (!proxima) return <span className="font-medium text-tertiary">Pagado</span>;
  const cuota = (
    <span className="font-mono tabular-nums">
      {proxima.numero}/{p.nCuotas}
    </span>
  );
  if (p.plan.diasAtraso > 0) {
    return (
      <span className="flex items-center gap-space-sm font-medium text-on-surface">
        <BadgeRiesgo nivel={p.riesgo}>+{p.plan.diasAtraso} días</BadgeRiesgo>
        Cuota {cuota}
      </span>
    );
  }
  return <span className="font-medium text-on-surface">Cuota {cuota}</span>;
}
