-- The migrations above run as the Postgres superuser, so service_role
-- (which PostgREST connects as) needs explicit grants on what they create.
-- RLS is enabled with no policies on these tables (see migrations.sql),
-- so BYPASSRLS on the role (00-roles.sql) is what actually makes rows
-- visible — these grants alone would still leave every row denied.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
