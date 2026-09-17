-- Extensions the application expects on Postgres. Tables and the spatial
-- index are created by app.db.init_db() on startup.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
