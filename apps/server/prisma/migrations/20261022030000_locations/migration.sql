-- CreateEnum
CREATE TYPE "Locality" AS ENUM ('GOVERNORATE', 'DISTRICT', 'AREA');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "locality" "Locality" NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
