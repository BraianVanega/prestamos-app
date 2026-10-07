-- Cierre & Reparto — Cerrar el acceso por la Data API de Supabase.
--
-- Supabase expone el esquema `public` por PostgREST a los roles `anon` y
-- `authenticated` (la clave anon viaja al navegador para el login). La app lee y
-- escribe solo desde el servidor con Drizzle, conectada como dueña de las
-- tablas, así que esos roles no necesitan ningún acceso:
--   1. RLS activado en todas las tablas, sin políticas → la API no ve filas.
--   2. Sin permisos para anon/authenticated, ni sobre lo que exista ni sobre lo
--      que se cree después.
-- La dueña de las tablas no está sujeta a RLS (no se usa FORCE), por eso la app
-- y los triggers siguen funcionando igual.
-- En un Postgres sin esos roles (fuera de Supabase) solo se activa RLS.

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
--> statement-breakpoint

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;
