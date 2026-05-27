const twilio = require("twilio");
const path = require("path");
const fs = require("fs");

// Load environment variables from .env file
require("dotenv").config({ path: path.join(__dirname, ".env") });

const isProduction = process.env.NODE_ENV === "production";

// Critical checks for production
if (isProduction) {
    const missing = [];
    if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
    if (!process.env.API_KEY) missing.push("API_KEY");
    if (!process.env.DB_PASSWORD) missing.push("DB_PASSWORD");
    if (!process.env.DB_USER) missing.push("DB_USER");
    if (!process.env.DB_HOST) missing.push("DB_HOST");
    if (!process.env.DB_NAME) missing.push("DB_NAME");

    if (missing.length > 0) {
        console.error(`FATAL ERROR: The following environment variables are required in production mode but are missing: ${missing.join(", ")}`);
        process.exit(1);
    }

    // Also warn if they use the default development credentials in production
    if (process.env.JWT_SECRET === "super-secure-secret-key-123") {
        console.error("FATAL ERROR: JWT_SECRET cannot be the default insecure development key in production.");
        process.exit(1);
    }
    if (process.env.API_KEY === "hms-api-key-2024-secure") {
        console.error("FATAL ERROR: API_KEY cannot be the default insecure development key in production.");
        process.exit(1);
    }
}

module.exports = {
    port: process.env.PORT || 5000,
    jwtSecret: process.env.JWT_SECRET || "super-secure-secret-key-123", // Use secure keys in env settings
    apiKey: process.env.API_KEY || "hms-api-key-2024-secure", // Static API key for public data endpoints
    db: {
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "Yaksh@1419",
        database: process.env.DB_NAME || "society_management",
        connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
        ssl: process.env.DB_SSL === "true" ? {
            ca: fs.readFileSync(path.join(__dirname, "ca.pem"))
        } : null
    },
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || "",
        authToken: process.env.TWILIO_AUTH_TOKEN || "",
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || ""
    },
    getTwilioClient: function() {
        if (!this.twilio.accountSid || !this.twilio.authToken) {
            console.warn("WARNING: Twilio credentials are not configured. SMS/WhatsApp alerts will be simulated in console logs.");
            // Return mock Twilio client to prevent runtime crashes and trigger local simulation response
            return {
                messages: {
                    create: async (opts) => {
                        console.log(`[SIMULATED TWILIO SMS] To: ${opts.to}, Body: ${opts.body}`);
                        throw new Error("Twilio credentials not configured. Using console simulation.");
                    }
                }
            };
        }
        return twilio(this.twilio.accountSid, this.twilio.authToken);
    }
};
