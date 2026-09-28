#!/bin/sh
# Runs once, when the postgres volume is empty (the image's entrypoint).
# One role and one database per component. visualex_test is the server
# suite's database: its setup refuses any database without "test" in the name.
# The passwords travel as psql variables, which psql quotes itself (:'name'):
# pasted into the SQL, a quote in a password broke the script, and a failed
# init is never retried — the volume stayed without roles for good.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v platform_pw="$PLATFORM_DB_PASSWORD" -v merlt_pw="$MERLT_DB_PASSWORD" <<'SQL'
CREATE ROLE visualex LOGIN CREATEDB PASSWORD :'platform_pw';
CREATE ROLE merlt LOGIN PASSWORD :'merlt_pw';
CREATE DATABASE visualex_platform OWNER visualex;
CREATE DATABASE visualex_test OWNER visualex;
CREATE DATABASE merlt OWNER merlt;
SQL
