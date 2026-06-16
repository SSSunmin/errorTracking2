-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('sent', 'failed');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "alertRuleId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "channel" "AlertChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_alertRuleId_issueId_idx" ON "Notification"("alertRuleId", "issueId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
