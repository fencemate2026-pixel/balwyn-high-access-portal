-- Rollback for 001_thomastown_swing.sql. Deletes ALL mirrored Thomastown swing data in Azure
-- (the Pi's own database is not touched). Run as the Azure administrator.
DROP SCHEMA IF EXISTS gd CASCADE;
DROP ROLE IF EXISTS gd_app;
