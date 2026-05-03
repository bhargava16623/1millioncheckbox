"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = require("express");
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const router = (0, express_1.Router)();
router.get("/register", (req, res) => {
    return res.sendFile(node_path_1.default.resolve("public", "admin-register.html"));
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
    const clientId = node_crypto_1.default.randomBytes(16).toString("hex");
    const clientSecret = node_crypto_1.default.randomBytes(32).toString("hex");
    const clientSecretHash = node_crypto_1.default
        .createHash("sha256")
        .update(clientSecret)
        .digest("hex");
    await db_1.db.insert(schema_1.applicationsTable).values({
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
exports.default = router;
//# sourceMappingURL=admin.js.map