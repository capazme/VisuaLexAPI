-- The Forum's Community (spec docs/superpowers/specs/2026-10-20-forum-community-glosse-design.md §7.2):
-- the key of the text a contributor accepts before writing a glossa, a reply or a comment. In its own
-- migration because Postgres refuses to use an enum value in the transaction that added it; the next
-- migration writes version 1 of the text.

-- AlterEnum
ALTER TYPE "LingoTestoChiave" ADD VALUE 'CONTRIBUTO_COMMUNITY';
