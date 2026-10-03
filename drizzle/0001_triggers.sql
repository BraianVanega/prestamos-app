-- Cierre & Reparto — Triggers de integridad (fase 1)
-- Generar con: npx drizzle-kit generate --custom --name=triggers  y pegar este contenido.
-- En la app, dentro de cada transacción:
--   select set_config('app.usuario_id', '<uuid>', true);
--   select set_config('app.motivo', '<texto>', true);   -- opcional

/* ───────── 1. Inmutabilidad ───────── */

create or replace function fn_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'La tabla % es inmutable (%). Registrá una anulación.', TG_TABLE_NAME, TG_OP;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'pagos','imputaciones','cargos','cuotas','conversiones','conversion_lotes',
    'transacciones','asientos','anulaciones','prestamo_participaciones','auditoria'
  ] loop
    execute format(
      'create trigger trg_%1$s_inmutable before update or delete on %1$I
       for each row execute function fn_inmutable()', t);
    execute format(
      'create trigger trg_%1$s_no_truncate before truncate on %1$I
       for each statement execute function fn_inmutable()', t);
  end loop;
end $$;

-- Préstamos: solo estado, fecha_cierre y notas son editables. Nunca se borran.
create or replace function fn_prestamos_update() returns trigger
language plpgsql as $$
declare editables text[] := array['estado','fecha_cierre','notas'];
begin
  if (to_jsonb(new) - editables) is distinct from (to_jsonb(old) - editables) then
    raise exception 'En un préstamo solo se puede modificar estado, fecha_cierre y notas';
  end if;
  return new;
end $$;

create trigger trg_prestamos_update before update on prestamos
  for each row execute function fn_prestamos_update();

-- Clientes, préstamos, participantes y proveedores: editables (con auditoría) pero sin borrado.
create trigger trg_prestamos_no_delete     before delete on prestamos     for each row execute function fn_inmutable();
create trigger trg_clientes_no_delete      before delete on clientes      for each row execute function fn_inmutable();
create trigger trg_participantes_no_delete before delete on participantes for each row execute function fn_inmutable();
create trigger trg_proveedores_no_delete   before delete on proveedores   for each row execute function fn_inmutable();

/* ───────── 2. Auditoría ───────── */

create or replace function fn_auditoria() returns trigger
language plpgsql as $$
begin
  insert into auditoria (usuario_id, tabla, registro_id, accion, antes, despues, motivo)
  values (
    nullif(current_setting('app.usuario_id', true), '')::uuid,
    TG_TABLE_NAME,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'prestamo_id'),
    TG_OP,
    case when TG_OP <> 'INSERT' then to_jsonb(old) end,
    case when TG_OP <> 'DELETE' then to_jsonb(new) end,
    nullif(current_setting('app.motivo', true), '')
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','participantes','proveedores','clientes','prestamos','prestamo_participaciones',
    'cuotas','cargos','pagos','imputaciones','conversiones','conversion_lotes',
    'transacciones','anulaciones'
  ] loop
    execute format(
      'create trigger trg_%1$s_auditoria after insert or update or delete on %1$I
       for each row execute function fn_auditoria()', t);
  end loop;
end $$;

/* ───────── 3. Invariantes (diferidos al COMMIT) ───────── */

-- 3.1 Cada transacción balancea por moneda.
create or replace function fn_transaccion_balanceada() returns trigger
language plpgsql as $$
declare r record;
begin
  for r in
    select moneda, sum(monto) as s from asientos
    where transaccion_id = new.transaccion_id group by moneda
  loop
    if r.s <> 0 then
      raise exception 'Transacción % desbalanceada en %: %', new.transaccion_id, r.moneda, r.s;
    end if;
  end loop;
  return null;
end $$;

create constraint trigger trg_asientos_balance after insert on asientos
  deferrable initially deferred for each row execute function fn_transaccion_balanceada();

-- 3.2 Participaciones de cada préstamo suman 100% (capital y ganancia).
create or replace function fn_participaciones_100() returns trigger
language plpgsql as $$
declare
  pid uuid := coalesce((to_jsonb(new) ->> 'prestamo_id')::uuid, (to_jsonb(new) ->> 'id')::uuid);
  c numeric; g numeric;
begin
  select coalesce(sum(pct_capital), 0), coalesce(sum(pct_ganancia), 0) into c, g
  from prestamo_participaciones where prestamo_id = pid;
  if c <> 100 or g <> 100 then
    raise exception 'Préstamo %: participaciones suman capital %%% / ganancia %%% (deben ser 100)', pid, c, g;
  end if;
  return null;
end $$;

create constraint trigger trg_prestamos_participaciones after insert on prestamos
  deferrable initially deferred for each row execute function fn_participaciones_100();
create constraint trigger trg_participaciones_100 after insert on prestamo_participaciones
  deferrable initially deferred for each row execute function fn_participaciones_100();

-- 3.3 Cada pago queda 100% distribuido y el saldo a favor nunca es negativo.
create or replace function fn_pago_distribuido() returns trigger
language plpgsql as $$
declare
  pid uuid := coalesce((to_jsonb(new) ->> 'pago_id')::uuid, (to_jsonb(new) ->> 'id')::uuid);
  total numeric; imputado numeric; favor numeric;
begin
  select ars into total from pagos where id = pid;
  select coalesce(sum(ars), 0),
         coalesce(sum(ars) filter (where concepto = 'saldo_favor'), 0)
    into imputado, favor
  from imputaciones where pago_id = pid;
  if imputado <> total then
    raise exception 'Pago %: imputado % de % ARS', pid, imputado, total;
  end if;
  if favor < 0 then
    raise exception 'Pago %: saldo a favor negativo (%)', pid, favor;
  end if;
  return null;
end $$;

create constraint trigger trg_pagos_distribuido after insert on pagos
  deferrable initially deferred for each row execute function fn_pago_distribuido();
create constraint trigger trg_imputaciones_distribuido after insert on imputaciones
  deferrable initially deferred for each row execute function fn_pago_distribuido();

-- 3.4 Lotes de conversión: suman el total convertido, solo pagos en efectivo, sin sobreconvertir.
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

create constraint trigger trg_conversiones_lotes after insert on conversiones
  deferrable initially deferred for each row execute function fn_conversion_lotes();
create constraint trigger trg_lotes_conversion after insert on conversion_lotes
  deferrable initially deferred for each row execute function fn_conversion_lotes();

/* ───────── 4. Seed mínimo ───────── */
-- insert into participantes (nombre, tipo) values ('Sociedad', 'sociedad');
-- insert into participantes (nombre, tipo, pct_sociedad) values ('Socio 1','socio',50), ('Socio 2','socio',50);
