-- CreateTable
CREATE TABLE "AnalyticsDocument" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDocument_key_key" ON "AnalyticsDocument"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDocument_year_month_key" ON "AnalyticsDocument"("year", "month");
