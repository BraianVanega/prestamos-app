-- Lotes de conversión: lo ya convertido de un pago no cuenta las conversiones anuladas.
-- Antes, anular una conversión y volver a convertir el mismo efectivo (a mano o al
-- editar un préstamo, que rebobina y repite las conversiones) sumaba el lote dos veces.
create or replace function fn_conversion_lotes() returns trigger
language plpgsql as $$
declare
  cid uuid := coalesce((to_jsonb(new) ->> 'conversion_id')::uuid, (to_jsonb(new) ->> 'id')::uuid);
  total numeric; asignado numeric; r record;
begin
  select ars into total from conversiones where id = cid;
  select coalesce(sum(ars), 0) into asignado from conversion_lotes where conversion_id = cid;
  if asignado <> total then
    raise exception 'Conversión %: lotes suman % de % ARS', cid, asignado, total;
  end if;

  for r in
    select p.id, p.tipo, p.ars, sum(l.ars) as convertido
    from conversion_lotes l join pagos p on p.id = l.pago_id
    where l.pago_id in (select pago_id from conversion_lotes where conversion_id = cid)
      and not exists (select 1 from anulaciones a where a.entidad = 'conversiones' and a.entidad_id = l.conversion_id)
    group by p.id, p.tipo, p.ars
  loop
    if r.tipo <> 'efectivo' then
      raise exception 'Pago % no es en efectivo', r.id;
    end if;
    if r.convertido > r.ars then
      raise exception 'Pago %: convertido % supera % ARS', r.id, r.convertido, r.ars;
    end if;
  end loop;
  return null;
end $$;
