import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import AdmZip from "adm-zip";
import { storage } from "./storage";
import { conversionConfigSchema } from "@shared/schema";
import { setupBot } from "./bot";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize Telegram Bot if token is present
  setupBot();

  app.post("/api/convert", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Parse configuration from FormData
      const config = conversionConfigSchema.parse({
        contactName: req.body.contactName,
        fileName: req.body.fileName,
        splitLimit: req.body.splitLimit,
      });

      const fileContent = req.file.buffer.toString("utf-8");
      const lines = fileContent
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        return res.status(400).json({ message: "File is empty" });
      }

      const chunks: string[][] = [];
      for (let i = 0; i < lines.length; i += config.splitLimit) {
        chunks.push(lines.slice(i, i + config.splitLimit));
      }

      const vcfFiles: { name: string; content: string }[] = chunks.map((chunk, index) => {
        const filePartName = chunks.length > 1 
          ? `${config.fileName}_${index + 1}.vcf`
          : `${config.fileName}.vcf`;
        
        const vcardContent = chunk.map((number, numIndex) => {
          // Calculate global index for the contact name counter
          const globalIndex = index * config.splitLimit + numIndex + 1;
          return [
            "BEGIN:VCARD",
            "VERSION:3.0",
            `FN:${config.contactName} ${globalIndex}`,
            `TEL;TYPE=CELL:${number}`,
            "END:VCARD"
          ].join("\n");
        }).join("\n");

        return { name: filePartName, content: vcardContent };
      });

      if (vcfFiles.length === 1) {
        // Return single VCF file
        const file = vcfFiles[0];
        res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
        res.setHeader("Content-Type", "text/vcard");
        return res.send(file.content);
      } else {
        // Return ZIP
        const zip = new AdmZip();
        vcfFiles.forEach((f) => {
          zip.addFile(f.name, Buffer.from(f.content, "utf-8"));
        });
        
        const zipBuffer = zip.toBuffer();
        res.setHeader("Content-Disposition", `attachment; filename="${config.fileName}_converted.zip"`);
        res.setHeader("Content-Type", "application/zip");
        return res.send(zipBuffer);
      }

    } catch (error) {
      console.error("Conversion error:", error);
      res.status(500).json({ message: "Internal server error during conversion" });
    }
  });

  return httpServer;
}
