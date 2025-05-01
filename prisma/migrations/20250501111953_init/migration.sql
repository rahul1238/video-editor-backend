-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "duration" DOUBLE PRECISION,
    "size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "trimmedFilePath" TEXT,
    "subtitledFilePath" TEXT,
    "renderedFilePath" TEXT,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Video_filePath_key" ON "Video"("filePath");

-- CreateIndex
CREATE UNIQUE INDEX "Video_trimmedFilePath_key" ON "Video"("trimmedFilePath");

-- CreateIndex
CREATE UNIQUE INDEX "Video_subtitledFilePath_key" ON "Video"("subtitledFilePath");

-- CreateIndex
CREATE UNIQUE INDEX "Video_renderedFilePath_key" ON "Video"("renderedFilePath");
