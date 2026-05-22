-- Add required password hashes for local JWT authentication.
-- Existing local POC users receive the seeded demo password hash, then the
-- default is removed so all future writes must supply an explicit hash.
ALTER TABLE "User"
ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '$2b$12$RX8J6mNs7g8WHbrjln4p1OeXcwMQsJZvcNyuNUKvGhMTXgtYhSzIS';

ALTER TABLE "User"
ALTER COLUMN "passwordHash" DROP DEFAULT;
