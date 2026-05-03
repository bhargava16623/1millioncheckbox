"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = require("express");
const node_path_1 = __importDefault(require("node:path"));
const drizzle_orm_1 = require("drizzle-orm");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const cert_1 = require("../utils/cert");
const router = (0, express_1.Router)();
// GET /o/authorize?client_id=...&redirect_uri=...&state=...&response_type=code
router.get("/authorize", async (req, res) => {
    const { client_id, redirect_uri, state, response_type } = req.query;
    if (!client_id || !redirect_uri || response_type !== "code") {
        res.status(400).json({
            message: "client_id, redirect_uri, and response_type=code are required.",
        });
        return;
    }
    const [app] = await db_1.db
        .select()
        .from(schema_1.applicationsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.applicationsTable.clientId, client_id))
        .limit(1);
    if (!app) {
        res.status(404).json({ message: "Application not found." });
        return;
    }
    if (app.redirectUri !== redirect_uri) {
        res.status(400).json({ message: "redirect_uri mismatch." });
        return;
    }
    // Serve the authorize page — the frontend will display app name
    return res.sendFile(node_path_1.default.resolve("public", "authorize.html"));
});
// API to get app info for the authorize page
router.get("/authorize/app-info", async (req, res) => {
    const { client_id } = req.query;
    if (!client_id) {
        res.status(400).json({ message: "client_id is required." });
        return;
    }
    const [app] = await db_1.db
        .select({ displayName: schema_1.applicationsTable.displayName })
        .from(schema_1.applicationsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.applicationsTable.clientId, client_id))
        .limit(1);
    if (!app) {
        res.status(404).json({ message: "Application not found." });
        return;
    }
    res.json({ displayName: app.displayName });
});
// POST /o/authorize/callback — user submits credentials
router.post("/authorize/callback", async (req, res) => {
    const { email, password, client_id, redirect_uri, state } = req.body;
    if (!email || !password || !client_id || !redirect_uri) {
        res.status(400).json({
            message: "email, password, client_id, and redirect_uri are required.",
        });
        return;
    }
    // Validate client
    const [app] = await db_1.db
        .select()
        .from(schema_1.applicationsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.applicationsTable.clientId, client_id))
        .limit(1);
    if (!app) {
        res.status(404).json({ message: "Application not found." });
        return;
    }
    if (app.redirectUri !== redirect_uri) {
        res.status(400).json({ message: "redirect_uri mismatch." });
        return;
    }
    // Validate user credentials
    const [user] = await db_1.db
        .select()
        .from(schema_1.usersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.usersTable.email, email))
        .limit(1);
    if (!user || !user.password || !user.salt) {
        res.status(401).json({ message: "Invalid email or password." });
        return;
    }
    const hash = node_crypto_1.default
        .createHash("sha256")
        .update(password + user.salt)
        .digest("hex");
    if (hash !== user.password) {
        res.status(401).json({ message: "Invalid email or password." });
        return;
    }
    // Generate authorization code
    const code = node_crypto_1.default.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 1000); // 60 seconds
    await db_1.db.insert(schema_1.authorizationCodesTable).values({
        code,
        clientId: client_id,
        userId: user.id,
        redirectUri: redirect_uri,
        expiresAt,
    });
    // Build redirect URL
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
        redirectUrl.searchParams.set("state", state);
    }
    res.json({ redirectUrl: redirectUrl.toString() });
});
// POST /o/token — exchange authorization code for tokens
router.post("/token", async (req, res) => {
    const { code, client_id, client_secret, grant_type, redirect_uri } = req.body;
    if (grant_type !== "authorization_code") {
        res.status(400).json({ message: "grant_type must be authorization_code." });
        return;
    }
    if (!code || !client_id || !client_secret || !redirect_uri) {
        res.status(400).json({
            message: "code, client_id, client_secret, and redirect_uri are required.",
        });
        return;
    }
    // Validate client credentials
    const [app] = await db_1.db
        .select()
        .from(schema_1.applicationsTable)
        .where((0, drizzle_orm_1.eq)(schema_1.applicationsTable.clientId, client_id))
        .limit(1);
    if (!app) {
        res.status(401).json({ message: "Invalid client credentials." });
        return;
    }
    const secretHash = node_crypto_1.default
        .createHash("sha256")
        .update(client_secret)
        .digest("hex");
    if (secretHash !== app.clientSecretHash) {
        res.status(401).json({ message: "Invalid client credentials." });
        return;
    }
    // Validate authorization code
    const [authCode] = await db_1.db
        .select()
        .from(schema_1.authorizationCodesTable)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.authorizationCodesTable.code, code), (0, drizzle_orm_1.eq)(schema_1.authorizationCodesTable.clientId, client_id)))
        .limit(1);
    if (!authCode) {
        res.status(400).json({ message: "Invalid authorization code." });
        return;
    }
    if (authCode.used) {
        res.status(400).json({ message: "Authorization code already used." });
        return;
    }
    if (authCode.expiresAt < new Date()) {
        res.status(400).json({ message: "Authorization code expired." });
        return;
    }
    if (authCode.redirectUri !== redirect_uri) {
        res.status(400).json({ message: "redirect_uri mismatch." });
        return;
    }
    // Mark code as used
    await db_1.db
        .update(schema_1.authorizationCodesTable)
        .set({ used: true })
        .where((0, drizzle_orm_1.eq)(schema_1.authorizationCodesTable.id, authCode.id));
    // Fetch user
    const [user] = await db_1.db
        .select()
        .from(schema_1.usersTable)
        .where((0, drizzle_orm_1.eq)(schema_1.usersTable.id, authCode.userId))
        .limit(1);
    if (!user) {
        res.status(404).json({ message: "User not found." });
        return;
    }
    // Generate tokens
    const PORT = process.env.PORT ?? 8000;
    const ISSUER = `http://localhost:${PORT}`;
    const now = Math.floor(Date.now() / 1000);
    const idTokenClaims = {
        iss: ISSUER,
        sub: user.id,
        email: user.email,
        email_verified: String(user.emailVerified),
        exp: now + 3600,
        given_name: user.firstName ?? "",
        family_name: user.lastName ?? undefined,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        picture: user.profileImageURL ?? undefined,
    };
    const accessTokenClaims = {
        iss: ISSUER,
        sub: user.id,
        exp: now + 3600,
        scope: "openid profile email",
        client_id,
    };
    const id_token = jsonwebtoken_1.default.sign(idTokenClaims, cert_1.PRIVATE_KEY, {
        algorithm: "RS256",
    });
    const access_token = jsonwebtoken_1.default.sign(accessTokenClaims, cert_1.PRIVATE_KEY, {
        algorithm: "RS256",
    });
    res.json({
        access_token,
        id_token,
        token_type: "Bearer",
        expires_in: 3600,
    });
});
exports.default = router;
//# sourceMappingURL=oauth.js.map