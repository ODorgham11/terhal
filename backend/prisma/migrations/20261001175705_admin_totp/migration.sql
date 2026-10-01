-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "totpLastUsedStep" INTEGER;

-- AlterTable
ALTER TABLE "AdminInvitation" ADD COLUMN     "totpSecret" TEXT;
