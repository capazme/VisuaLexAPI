-- A study card outlives its author's account when the community has taken it
-- up: the author becomes optional and the foreign key sets it to NULL instead of
-- cascading. Drafts and archived cards, which belong to the person alone, are
-- removed by the application before the user (deleteUserAccount). The table has
-- no rows yet: nothing writes cards. Generated with `prisma migrate diff`.

-- DropForeignKey
ALTER TABLE "lingo_cards" DROP CONSTRAINT "lingo_cards_autore_id_fkey";

-- AlterTable
ALTER TABLE "lingo_cards" ALTER COLUMN "autore_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "lingo_cards" ADD CONSTRAINT "lingo_cards_autore_id_fkey" FOREIGN KEY ("autore_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
