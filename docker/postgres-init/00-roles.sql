-- Local dev only. PostgREST (the "postgrest" service in docker-compose.yml)
-- executes every request as this role since no JWT verification is
-- configured — there's nothing here for it to switch between per-request.
-- Real deployments should point SUPABASE_URL/SUPABASE_SERVICE_KEY at an
-- actual Supabase project instead of this local stack.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role WITH LOGIN PASSWORD 'service_role_password' BYPASSRLS;
  END IF;
END $$;
