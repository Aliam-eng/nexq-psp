-- Switch from Rival Payments to direct Whish Pay.

-- Transaction: Rival's payment id becomes the Whish externalId we generate.
ALTER TABLE "Transaction" RENAME COLUMN "rivalPaymentId" TO "whishExternalId";
CREATE UNIQUE INDEX "Transaction_whishExternalId_key" ON "Transaction"("whishExternalId");

-- ProviderConfig: replace Rival key/paths/webhook secret with Whish header credentials.
ALTER TABLE "ProviderConfig"
  DROP COLUMN "apiKey",
  DROP COLUMN "createPaymentPath",
  DROP COLUMN "statusPath",
  DROP COLUMN "healthPath",
  DROP COLUMN "webhookSecret",
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "secret" TEXT,
  ADD COLUMN "websiteUrl" TEXT,
  ADD COLUMN "userAgent" TEXT,
  ALTER COLUMN "id" SET DEFAULT 'whish',
  ALTER COLUMN "baseUrl" SET DEFAULT 'https://partner.api.sbx.whish.money/itel-service/api';

-- Carry the existing row over (keeps minDeposit); disabled until Whish credentials are entered.
UPDATE "ProviderConfig"
  SET "id" = 'whish',
      "baseUrl" = 'https://partner.api.sbx.whish.money/itel-service/api',
      "enabled" = false
  WHERE "id" = 'rival';
