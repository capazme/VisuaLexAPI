-- CreateTable
CREATE TABLE "environments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "author" TEXT,
    "version" TEXT,
    "category" "EnvironmentCategory",
    "color" TEXT,
    "tags" TEXT[],
    "content" JSONB NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "environments_user_id_idx" ON "environments"("user_id");

-- CreateIndex
CREATE INDEX "environments_category_idx" ON "environments"("category");

-- CreateIndex
CREATE INDEX "environments_created_at_idx" ON "environments"("created_at");

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
