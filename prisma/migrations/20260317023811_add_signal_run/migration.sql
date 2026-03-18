-- CreateTable
CREATE TABLE "signal_run" (
    "id" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "signalMap" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_run_pkey" PRIMARY KEY ("id")
);
