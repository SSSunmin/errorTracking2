-- AlterEnum
ALTER TYPE "AlertCondition" ADD VALUE 'event_spike';

-- AlterTable
ALTER TABLE "AlertRule" ADD COLUMN     "baselineMinutes" INTEGER,
ADD COLUMN     "minEvents" INTEGER,
ADD COLUMN     "spikeMultiplier" DECIMAL(5,2);
