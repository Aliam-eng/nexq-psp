-- Separate on/off switches for deposits and withdrawals per payment method.
-- "enabled" keeps meaning deposits. Defaults preserve today's behaviour:
-- Whish withdrawals were always offered; USDT withdrawals followed the USDT switch.

ALTER TABLE "ProviderConfig" ADD COLUMN "withdrawalsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ThreePayConfig" ADD COLUMN "withdrawalsEnabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ThreePayConfig" SET "withdrawalsEnabled" = "enabled";
