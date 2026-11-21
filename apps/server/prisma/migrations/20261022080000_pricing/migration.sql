-- CreateTable
CREATE TABLE "Pricing" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "car" "CarBody" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pricing_fromId_toId_classId_car_key" ON "Pricing"("fromId", "toId", "classId", "car");

-- AddForeignKey
ALTER TABLE "Pricing" ADD CONSTRAINT "Pricing_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pricing" ADD CONSTRAINT "Pricing_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pricing" ADD CONSTRAINT "Pricing_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TripClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
