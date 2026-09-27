#!/bin/sh
# Runs once, when the postgres volume is empty (the image's entrypoint).
# One role and one database per component. visualex_test is the server
# suite's database: its setup refuses any database without "test" in the name.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE visualex LOGIN CREATEDB PASSWORD '${PLATFORM_DB_PASSWORD}';
CREATE ROLE merlt LOGIN PASSWORD '${MERLT_DB_PASSWORD}';
CREATE DATABASE visualex_platform OWNER visualex;
CREATE DATABASE visualex_test OWNER visualex;
CREATE DATABASE merlt OWNER merlt;
SQL
