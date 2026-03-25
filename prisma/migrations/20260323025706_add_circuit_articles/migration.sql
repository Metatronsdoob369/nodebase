-- CreateTable
CREATE TABLE "circuit_article" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "summary" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signalScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "circuit_article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "circuit_article_url_key" ON "circuit_article"("url");

-- CreateIndex
CREATE INDEX "circuit_article_sector_idx" ON "circuit_article"("sector");

-- CreateIndex
CREATE INDEX "circuit_article_publishedAt_idx" ON "circuit_article"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "circuit_article_source_idx" ON "circuit_article"("source");
