import crypto from "node:crypto";
import { Router, type Router as RouterType } from "express";
import path from "node:path";
import { db } from "../db";
import { applicationsTable } from "../db/schema";

const router: RouterType = Router();

router.get("/register", (req, res) => {
  return res.sendFile(path.resolve("public", "admin-register.html"));
});

router.post("/register", async (req, res) => {
  const { displayName, applicationUrl, redirectUri } = req.body;

  if (!displayName || !applicationUrl || !redirectUri) {
    res.status(400).json({
      message: "displayName, applicationUrl, and redirectUri are required.",
    });
    return;
  }

  // Generate client credentials
  const clientId = crypto.randomBytes(16).toString("hex");
  const clientSecret = crypto.randomBytes(32).toString("hex");
  const clientSecretHash = crypto
    .createHash("sha256")
    .update(clientSecret)
    .digest("hex");

  await db.insert(applicationsTable).values({
    clientId,
    clientSecretHash,
    displayName,
    applicationUrl,
    redirectUri,
  });

  res.status(201).json({
    message: "Application registered successfully.",
    clientId,
    clientSecret, // Only shown once
  });
});

export default router;
