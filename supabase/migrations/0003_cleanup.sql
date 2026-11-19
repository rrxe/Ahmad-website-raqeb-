-- RAQEEB — cleanup of earlier experimental admin-bootstrap objects (safe if they never existed)
begin;
drop function if exists public.check_admin_setup_code(text);
drop function if exists public.admin_setup_available();
drop function if exists public.set_admin_setup_code(text);
drop table if exists public.admin_setup;
drop table if exists public.admin_bootstrap_attempts;
commit;
