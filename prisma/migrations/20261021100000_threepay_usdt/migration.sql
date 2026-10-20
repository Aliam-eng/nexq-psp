-- 3Pay (USDT-TRC20) deposits and payouts.

ALTER TABLE "Transaction"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'WHISH',
  ADD COLUMN "threepayInvoiceNo" TEXT,
  ADD COLUMN "threepayTxId" TEXT,
  ADD COLUMN "grossAmount" DOUBLE PRECISION,
  ADD COLUMN "cryptoTxHash" TEXT;
CREATE UNIQUE INDEX "Transaction_threepayInvoiceNo_key" ON "Transaction"("threepayInvoiceNo");

ALTER TABLE "Withdrawal"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'WHISH',
  ALTER COLUMN "phone" DROP NOT NULL,
  ADD COLUMN "walletAddress" TEXT,
  ADD COLUMN "payoutId" TEXT,
  ADD COLUMN "payoutTxHash" TEXT,
  ADD COLUMN "payoutFee" DOUBLE PRECISION,
  ADD COLUMN "payoutNet" DOUBLE PRECISION,
  ADD COLUMN "payoutError" TEXT,
  ADD COLUMN "payoutSentAt" TIMESTAMP(3),
  ADD COLUMN "refundDealId" TEXT;
CREATE UNIQUE INDEX "Withdrawal_payoutId_key" ON "Withdrawal"("payoutId");

CREATE TABLE "ThreePayConfig" (
    "id" TEXT NOT NULL DEFAULT 'threepay',
    "baseUrl" TEXT DEFAULT 'https://pay.3pa-y.com/api/v1',
    "apiKey" TEXT,
    "apiSecret" TEXT,
    "webhookSecret" TEXT,
    "minDeposit" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreePayConfig_pkey" PRIMARY KEY ("id")
);
