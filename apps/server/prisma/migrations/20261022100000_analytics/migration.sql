-- CreateTable
CREATE TABLE "AnalyticsDocument" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDocument_key_key" ON "AnalyticsDocument"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDocument_year_month_key" ON "AnalyticsDocument"("year", "month");

-- A real calendar month, and a workbook with something in it.
ALTER TABLE "AnalyticsDocument" ADD CONSTRAINT "AnalyticsDocument_month"
    CHECK ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 9999 AND "size" > 0);
