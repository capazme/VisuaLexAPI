-- CreateEnum
CREATE TYPE "AliasType" AS ENUM ('shortcut', 'reference');

-- CreateTable
CREATE TABLE "quick_norms" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "search_params" JSONB NOT NULL,
    "source_url" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quick_norms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_aliases" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "alias_type" "AliasType" NOT NULL,
    "expand_to" TEXT NOT NULL,
    "search_params" JSONB,
    "description" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quick_norms_user_id_idx" ON "quick_norms"("user_id");

-- CreateIndex
CREATE INDEX "custom_aliases_user_id_idx" ON "custom_aliases"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_aliases_user_id_trigger_key" ON "custom_aliases"("user_id", "trigger");

-- AddForeignKey
ALTER TABLE "quick_norms" ADD CONSTRAINT "quick_norms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_aliases" ADD CONSTRAINT "custom_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
