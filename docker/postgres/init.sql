CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Roles
--
-- migrator  — owns the schema and all tables; the only role that runs
--             `prisma migrate deploy`. Connects directly to Postgres (5433),
--             never through PgBouncer.
-- app_user  — used by the running API. NOT an owner, NOT BYPASSRLS, and only
--             has the DML grants it needs (no DDL, no role management).
--             Connects through PgBouncer (6433) in transaction pool mode.
--
-- Table-level grants for app_user are handled automatically via
-- ALTER DEFAULT PRIVILEGES below, so every table migrator creates from now on
-- is readable/writable by app_user without a manual GRANT in each migration.
-- The `tenants` table is the one deliberate exception (see the init migration,
-- which revokes INSERT/UPDATE/DELETE on it right after creating it).
-- ---------------------------------------------------------------------------

CREATE ROLE migrator LOGIN PASSWORD 'migrator_dev_pw';
CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'app_user_dev_pw';

ALTER DATABASE educrm OWNER TO migrator;
ALTER SCHEMA public OWNER TO migrator;

GRANT CONNECT ON DATABASE educrm TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
