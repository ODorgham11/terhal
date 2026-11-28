-- Cash a driver hands in to the company (the company's cash they were holding): raises what the company owes them.
ALTER TYPE "DriverTransactionType" ADD VALUE 'CASH_HANDED_IN';

-- Compared as text: a value added to an enum can't be used as one until the transaction that added it commits.
ALTER TABLE "DriverTransaction" DROP CONSTRAINT "DriverTransaction_sign";
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_sign" CHECK (
    CASE "type"::text
        WHEN 'TRIP_FEE' THEN "amount" > 0
        WHEN 'EXPENSE_REIMBURSEMENT' THEN "amount" > 0
        WHEN 'CASH_COLLECTED' THEN "amount" < 0
        WHEN 'PAYOUT' THEN "amount" < 0
        WHEN 'CASH_HANDED_IN' THEN "amount" > 0
        ELSE "amount" <> 0
    END
);
