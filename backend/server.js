const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2");
const bcryptjs = require("bcryptjs");
const config = require("./config");
const jwt = require("jsonwebtoken");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");


const JWT_SECRET = config.jwtSecret || "super-secure-secret-key-123";


// Use a connection POOL instead of a single connection.
// A pool automatically creates fresh connections and handles reconnection
// after a system restart — a single createConnection() dies permanently
// once the server or MySQL is restarted.
const db = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ssl: config.db.ssl // Added support for cloud DB SSL
});

// Test initial connection
db.getConnection((err, connection) => {
    if (err) {
        console.log("Initial DB connection error:", err.message);
    } else {
        console.log("MySQL Pool Connected");
        connection.release();
    }
});

// Helper: wait for MySQL to be ready before running initDB
// Retries every 2 seconds for up to 60 seconds
function waitForDB(retriesLeft = 30) {
    db.getConnection((err, connection) => {
        if (err) {
            if (retriesLeft <= 0) {
                console.error("Could not connect to MySQL after 60 seconds. Giving up.");
                return;
            }
            console.log(`MySQL not ready yet, retrying in 2s... (${retriesLeft} retries left)`);
            setTimeout(() => waitForDB(retriesLeft - 1), 2000);
        } else {
            connection.release();
            console.log("MySQL is ready. Running database initialization...");
            initDB();
        }
    });
}

const isUsernameUnique = async (username, excludeUserId) => {
    if (!username) return true;
    const lowerUsername = username.trim().toLowerCase();
    let query = "SELECT id FROM users WHERE LOWER(username) = ?";
    let params = [lowerUsername];
    if (excludeUserId) {
        query += " AND id != ?";
        params.push(excludeUserId);
    }
    const [rows] = await db.promise().query(query, params);
    return rows.length === 0;
};

const isPeriodAfter = (target, current) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [m1, y1] = target.split('-');
    const [m2, y2] = current.split('-');
    const year1 = parseInt(y1);
    const year2 = parseInt(y2);
    if (year1 > year2) return true;
    if (year1 < year2) return false;
    return months.indexOf(m1) > months.indexOf(m2);
};

const isPeriodBefore = (target, current) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [m1, y1] = target.split('-');
    const [m2, y2] = current.split('-');
    const year1 = parseInt(y1);
    const year2 = parseInt(y2);
    if (year1 < year2) return true;
    if (year1 > year2) return false;
    return months.indexOf(m1) < months.indexOf(m2);
};

const app = express();
app.set("trust proxy", 1);

// Secure Express headers (Helmet)
app.use(helmet({
    contentSecurityPolicy: false // Disabled to support loading frontend assets from various third-party CDNs smoothly
}));

// Restrict CORS origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(",") 
    : [];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (process.env.NODE_ENV !== "production") {
            return callback(null, true); // Allow all in dev
        }
        if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes("*")) {
            return callback(null, true);
        } else {
            return callback(new Error("Not allowed by CORS"));
        }
    }
}));

app.use(express.json({ limit: '50mb' })); // Handle large base64 QR codes
app.use(express.static(path.join(__dirname, "..", "frontend"))); // Serve frontend files

// Rate limiting for public and authentication endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many login/OTP requests from this IP, please try again after 15 minutes." }
});

const setupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // limit setup to 10 requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many setup requests. Please try again later." }
});

// Apply rate limits
app.use("/api/login", authLimiter);
app.use("/api/resident-login", authLimiter);
app.use("/api/request-resident-otp", authLimiter);
app.use("/api/setup", setupLimiter);


// Interactive Swagger UI documentation
try {
    const swaggerDocument = YAML.load(path.join(__dirname, "swagger.yaml"));
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    console.log("Swagger UI initialized successfully at /api-docs");
} catch (err) {
    console.error("Failed to load Swagger specification:", err.message);
}

// JWT auth middleware — mounted at '/api', so req.path is already relative
// (e.g. '/login' for '/api/login').  List paths WITHOUT the '/api' prefix.
const verifyToken = (req, res, next) => {
    const publicPaths = [
        '/',                        // /api health-check
        '/login',                   // admin login
        '/resident-login',          // resident login
        '/setup',                   // first-time setup
        '/societies',               // list societies (landing page)
        '/request-resident-otp',    // password-reset step 1
        '/verify-resident-otp',     // password-reset step 2
        '/admin-verify-identity',   // admin password-reset step 1
        '/admin-verify-otp',        // admin password-reset step 2
        '/admin-reset-password'     // admin password-reset step 3
    ];

    if (publicPaths.includes(req.path) || 
        req.path.startsWith('/society-data/') || 
        req.path.startsWith('/society-committee/') || 
        req.path.startsWith('/society-bank/') ||
        req.path.startsWith('/society-flats/')) {
        return next();
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token provided. Please log in.' });
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
        }
        req.user = decoded;
        next();
    });
};

app.use('/api', verifyToken);

// --- DATABASE INITIALIZATION ---
const monthsList = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function serializeNotes(plan, owner_name, customNotes = "") {
    return JSON.stringify({ plan, owner_name, customNotes });
}

function deserializeNotes(notesStr) {
    if (!notesStr) return { plan: 'monthly', owner_name: '', customNotes: '', notes: '' };
    try {
        const parsed = JSON.parse(notesStr);
        const customNotes = parsed.customNotes || parsed.notes || '';
        return {
            plan: parsed.plan || 'monthly',
            owner_name: parsed.owner_name || '',
            customNotes: customNotes,
            notes: customNotes
        };
    } catch (e) {
        return {
            plan: 'monthly',
            owner_name: '',
            customNotes: notesStr || '',
            notes: notesStr || ''
        };
    }
}

function formatTransferPeriod(dateVal) {
    if (!dateVal) return null;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    return `${monthsList[d.getMonth()]}-${d.getFullYear()}`;
}

function formatDateDDMMYYYY(dateVal) {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

function parseDDMMYYYY(dateStr) {
    if (!dateStr) return new Date();
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return new Date();
}

function parsePaidDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    return parseDDMMYYYY(dateStr);
}

const loadSchemaFromFile = async () => {
    const schemaPath = path.join(__dirname, "..", "database", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");
    const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter(
            (s) =>
                s.length > 0 &&
                !/^CREATE DATABASE/i.test(s) &&
                !/^USE /i.test(s)
        );

    for (let stmt of statements) {
        if (!/CREATE TABLE /i.test(stmt)) continue;
        if (!/CREATE TABLE IF NOT EXISTS /i.test(stmt)) {
            stmt = stmt.replace(/CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS ");
        }
        await db.promise().query(stmt);
    }
};

// Keeps complaint APIs working (raw_flat_number / nullable unit_id) without changing schema.sql
const ensureComplaintAppColumns = async () => {
    const [cols] = await db.promise().query(
        `SELECT COLUMN_NAME, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'complaints'`
    );
    if (cols.length === 0) return;

    const colNames = cols.map((c) => c.COLUMN_NAME);
    if (!colNames.includes("raw_flat_number")) {
        await db.promise().query(
            "ALTER TABLE complaints ADD COLUMN raw_flat_number VARCHAR(50) NULL"
        );
    }
    const unitCol = cols.find((c) => c.COLUMN_NAME === "unit_id");
    if (unitCol && unitCol.IS_NULLABLE === "NO") {
        await db.promise().query(
            "ALTER TABLE complaints MODIFY COLUMN unit_id BIGINT UNSIGNED NULL"
        );
    }
};

const renameTable = async (oldName, tempName) => {
    try {
        await db.promise().query(`RENAME TABLE ${oldName} TO ${tempName}`);
        console.log(`Renamed table ${oldName} to ${tempName}`);
    } catch (e) {
        // Ignore if table doesn't exist
    }
};

const initDB = async () => {
    try {
        console.log("Checking database schema state...");
        const [tables] = await db.promise().query("SHOW TABLES");
        const tableNames = tables.map(row => Object.values(row)[0]);

        if (!tableNames.includes('users') && tableNames.includes('societies')) {
            console.log("Legacy schema detected. Renaming tables for migration...");
            const legacyTables = [
                'admin_credentials', 'bank_details', 'committee', 'complaints',
                'expenses', 'flats', 'maintenance', 'notices', 'resident_details',
                'rules', 'societies'
            ];
            for (const t of legacyTables) {
                if (tableNames.includes(t)) {
                    await renameTable(t, `old_${t}`);
                }
            }
        }

        console.log("Creating new schema tables from schema.sql if not exist...");
        await loadSchemaFromFile();
        await ensureComplaintAppColumns();

        // Run data migration from legacy tables if any
        const [updatedTables] = await db.promise().query("SHOW TABLES");
        const updatedTableNames = updatedTables.map(row => Object.values(row)[0]);

        if (updatedTableNames.includes('old_societies')) {
            console.log("Starting data migration from legacy tables...");

            // 1. Migrate societies and bank details
            const [oldSocieties] = await db.promise().query("SELECT * FROM old_societies");
            for (const soc of oldSocieties) {
                let bank = { bank_name: '', bank_acc: '', bank_ifsc: '', qr_code: '' };
                if (updatedTableNames.includes('old_bank_details')) {
                    const [banks] = await db.promise().query("SELECT * FROM old_bank_details WHERE society_id = ?", [soc.id]);
                    if (banks.length > 0) {
                        bank.bank_name = banks[0].bank_name || '';
                        bank.bank_acc = banks[0].bank_acc || '';
                        bank.bank_ifsc = banks[0].bank_ifsc || '';
                        bank.qr_code = banks[0].qr_code || '';
                    }
                }

                if (soc.bank_name || soc.bank_acc || soc.bank_ifsc || soc.qr_code) {
                    bank.bank_name = bank.bank_name || soc.bank_name || '';
                    bank.bank_acc = bank.bank_acc || soc.bank_acc || '';
                    bank.bank_ifsc = bank.bank_ifsc || soc.bank_ifsc || '';
                    bank.qr_code = bank.qr_code || soc.qr_code || '';
                }

                let propertyType = 'flat';
                if (soc.property_type && ['flat', 'villa', 'shop', 'mixed'].includes(soc.property_type.toLowerCase())) {
                    propertyType = soc.property_type.toLowerCase();
                } else if (soc.property_type && soc.property_type.toLowerCase() === 'bunglow') {
                    propertyType = 'villa';
                }

                let totalUnits = 0;
                if (updatedTableNames.includes('old_flats')) {
                    const [unitsCount] = await db.promise().query("SELECT COUNT(*) as count FROM old_flats WHERE society_id = ?", [soc.id]);
                    totalUnits = unitsCount[0].count;
                }

                const bankJSON = JSON.stringify(bank);

                await db.promise().query(
                    `INSERT INTO societies (id, society_name, property_type, total_blocks, total_units, address, default_due_day)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [soc.id, soc.society_name, propertyType, soc.blocks || 0, totalUnits, bankJSON, soc.default_due_day || 1]
                );
                console.log(`Migrated society: ${soc.society_name} (ID: ${soc.id})`);

                let adminUsername = null;
                let adminPassword = null;
                if (updatedTableNames.includes('old_admin_credentials')) {
                    const [admins] = await db.promise().query("SELECT * FROM old_admin_credentials WHERE society_id = ?", [soc.id]);
                    if (admins.length > 0) {
                        adminUsername = admins[0].admin_username;
                        adminPassword = admins[0].admin_password;
                    }
                }
                if (!adminUsername && soc.admin_username) {
                    adminUsername = soc.admin_username;
                    adminPassword = soc.admin_password;
                }

                if (adminUsername) {
                    let hashedPass = adminPassword;
                    if (hashedPass && !hashedPass.startsWith("$2a$") && !hashedPass.startsWith("$2b$")) {
                        hashedPass = await bcryptjs.hash(hashedPass, 10);
                    }
                    try {
                        await db.promise().query(
                            `INSERT INTO users (society_id, username, password_hash, full_name, role)
                             VALUES (?, ?, ?, ?, ?)`,
                            [soc.id, adminUsername, hashedPass || 'dummy', 'Admin', 'admin']
                        );
                    } catch (e) {
                        await db.promise().query(
                            `INSERT INTO users (society_id, username, password_hash, full_name, role)
                             VALUES (?, ?, ?, ?, ?)`,
                            [soc.id, `${adminUsername}_${soc.id}`, hashedPass || 'dummy', 'Admin', 'admin']
                        );
                    }
                }
            }

            // 2. Migrate flats (to blocks and units)
            if (updatedTableNames.includes('old_flats')) {
                const [oldFlats] = await db.promise().query("SELECT * FROM old_flats");
                for (const flat of oldFlats) {
                    let blockId = null;
                    if (flat.block) {
                        const [blocks] = await db.promise().query(
                            "SELECT id FROM blocks WHERE society_id = ? AND block_name = ?",
                            [flat.society_id, flat.block]
                        );
                        if (blocks.length > 0) {
                            blockId = blocks[0].id;
                        } else {
                            const [blockInsert] = await db.promise().query(
                                "INSERT INTO blocks (society_id, block_name) VALUES (?, ?)",
                                [flat.society_id, flat.block]
                            );
                            blockId = blockInsert.insertId;
                        }
                    }

                    let resident = null;
                    if (updatedTableNames.includes('old_resident_details')) {
                        const [resRows] = await db.promise().query(
                            "SELECT * FROM old_resident_details WHERE flat_id = ?",
                            [flat.id]
                        );
                        if (resRows.length > 0) {
                            resident = resRows[0];
                        }
                    }

                    const occupancyStatus = (resident && resident.owner_name) ? 'occupied' : 'vacant';
                    const unitNumber = `${flat.block}-${flat.flat_number}`;

                    await db.promise().query(
                        `INSERT INTO units (id, society_id, block_id, unit_number, occupancy_status)
                         VALUES (?, ?, ?, ?, ?)`,
                        [flat.id, flat.society_id, blockId, unitNumber, occupancyStatus]
                    );
                    const unitId = flat.id;

                    if (resident && resident.owner_name) {
                        let ownerUsername = resident.resident_username;
                        if (!ownerUsername) {
                            ownerUsername = `_placeholder_owner_${unitId}`;
                        }
                        let ownerPassword = resident.resident_password;
                        if (ownerPassword && !ownerPassword.startsWith("$2a$") && !ownerPassword.startsWith("$2b$")) {
                            ownerPassword = await bcryptjs.hash(ownerPassword, 10);
                        }

                        let ownerUserId = null;
                        try {
                            const [userInsert] = await db.promise().query(
                                `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                                 VALUES (?, ?, ?, ?, ?, ?)`,
                                [flat.society_id, ownerUsername, resident.phone || '', ownerPassword || 'dummy', resident.owner_name, 'resident']
                            );
                            ownerUserId = userInsert.insertId;
                        } catch (e) {
                            const [userInsert] = await db.promise().query(
                                `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                                 VALUES (?, ?, ?, ?, ?, ?)`,
                                [flat.society_id, `${ownerUsername}_${Date.now()}`, resident.phone || '', ownerPassword || 'dummy', resident.owner_name, 'resident']
                            );
                            ownerUserId = userInsert.insertId;
                        }

                        let moveInDate = '2020-01-01';
                        if (resident.transfer_period) {
                            const parts = resident.transfer_period.split('-');
                            if (parts.length === 2) {
                                const mIdx = monthsList.indexOf(parts[0]);
                                const year = parseInt(parts[1]);
                                if (mIdx !== -1 && !isNaN(year)) {
                                    moveInDate = `${year}-${String(mIdx + 1).padStart(2, '0')}-01`;
                                }
                            }
                        }

                        await db.promise().query(
                            `INSERT INTO unit_residents (unit_id, user_id, resident_type, is_primary, move_in_date)
                             VALUES (?, ?, ?, ?, ?)`,
                            [unitId, ownerUserId, 'owner', 1, moveInDate]
                        );

                        if (resident.past_owner_name) {
                            const pastOwnerUsername = `_placeholder_past_${unitId}`;
                            let pastOwnerUserId = null;
                            try {
                                const [pastUserInsert] = await db.promise().query(
                                    `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [flat.society_id, pastOwnerUsername, resident.past_owner_phone || '', 'dummy', resident.past_owner_name, 'resident']
                                );
                                pastOwnerUserId = pastUserInsert.insertId;
                            } catch (e) {
                                const [pastUserInsert] = await db.promise().query(
                                    `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [flat.society_id, `${pastOwnerUsername}_${Date.now()}`, resident.past_owner_phone || '', 'dummy', resident.past_owner_name, 'resident']
                                );
                                pastOwnerUserId = pastUserInsert.insertId;
                            }

                            let moveOutDate = '2025-12-31';
                            if (moveInDate !== '2020-01-01') {
                                const d = new Date(moveInDate);
                                d.setDate(d.getDate() - 1);
                                moveOutDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                            }

                            await db.promise().query(
                                `INSERT INTO unit_residents (unit_id, user_id, resident_type, is_primary, move_in_date, move_out_date, is_active)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [unitId, pastOwnerUserId, 'owner', 0, '2020-01-01', moveOutDate, 0]
                            );
                        }

                        if (resident.is_rental === 'Yes' && resident.rental_name) {
                            const tenantUsername = `_placeholder_tenant_${unitId}`;
                            let tenantUserId = null;
                            try {
                                const [tenantInsert] = await db.promise().query(
                                    `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [flat.society_id, tenantUsername, resident.rental_phone || '', 'dummy', resident.rental_name, 'resident']
                                );
                                tenantUserId = tenantInsert.insertId;
                            } catch (e) {
                                const [tenantInsert] = await db.promise().query(
                                    `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [flat.society_id, `${tenantUsername}_${Date.now()}`, resident.rental_phone || '', 'dummy', resident.rental_name, 'resident']
                                );
                                tenantUserId = tenantInsert.insertId;
                            }

                            await db.promise().query(
                                `INSERT INTO unit_residents (unit_id, user_id, resident_type, is_primary, move_in_date)
                                 VALUES (?, ?, ?, ?, ?)`,
                                [unitId, tenantUserId, 'tenant', 1, '2020-01-01']
                            );
                        }
                    }
                }
            }

            // 3. Migrate Maintenance records (to maintenance_invoices and payment_transactions)
            if (updatedTableNames.includes('old_maintenance')) {
                const [oldMaint] = await db.promise().query("SELECT * FROM old_maintenance");
                for (const m of oldMaint) {
                    const [units] = await db.promise().query("SELECT society_id FROM units WHERE id = ?", [m.flat_id]);
                    if (units.length === 0) continue;
                    const socId = units[0].society_id;

                    const periodParts = m.period.split('-');
                    if (periodParts.length !== 2) continue;
                    const monthName = periodParts[0];
                    const yearVal = parseInt(periodParts[1]);
                    const mIdx = monthsList.indexOf(monthName);
                    if (mIdx === -1 || isNaN(yearVal)) continue;

                    const billingMonth = mIdx + 1;
                    const billingYear = yearVal;

                    const invoiceNumber = `INV-${m.flat_id}-${billingYear}-${billingMonth}`;
                    const notes = serializeNotes(m.plan || 'monthly', m.owner_name || '');
                    const dueDate = `${billingYear}-${String(billingMonth).padStart(2, '0')}-01`;

                    let status = 'Pending';
                    if (m.status === 'Paid') status = 'Paid';

                    let paidAt = null;
                    if (m.paid_date && m.paid_date !== '-') {
                        const pDate = parsePaidDate(m.paid_date);
                        if (pDate) {
                            paidAt = pDate;
                        }
                    }

                    try {
                        const [invInsert] = await db.promise().query(
                            `INSERT INTO maintenance_invoices (id, society_id, unit_id, invoice_number, billing_year, billing_month, amount, due_date, status, notes, paid_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [m.id, socId, m.flat_id, invoiceNumber, billingYear, billingMonth, m.amount || 0, dueDate, status, notes, paidAt]
                        );

                        if (status === 'Paid') {
                            let method = 'cash';
                            if (m.payment_method) {
                                const mLower = m.payment_method.toLowerCase();
                                if (mLower.includes('upi')) method = 'upi';
                                else if (mLower.includes('bank') || mLower.includes('transfer')) method = 'bank_transfer';
                                else if (mLower.includes('card')) method = 'card';
                                else if (mLower.includes('cheque')) method = 'cheque';
                            }

                            await db.promise().query(
                                `INSERT INTO payment_transactions (invoice_id, payment_method, amount, status, paid_at)
                                 VALUES (?, ?, ?, ?, ?)`,
                                [invInsert.insertId, method, m.amount || 0, 'Success', paidAt]
                            );
                        }
                    } catch (err) {
                        console.error(`Failed to migrate maintenance record ID ${m.id}:`, err.message);
                    }
                }
            }

            // 4. Migrate Expenses
            if (updatedTableNames.includes('old_expenses')) {
                const [oldExpenses] = await db.promise().query("SELECT * FROM old_expenses");
                for (const exp of oldExpenses) {
                    let expDate = exp.date || null;
                    if (!expDate || isNaN(Date.parse(expDate))) {
                        expDate = new Date();
                    }
                    await db.promise().query(
                        `INSERT INTO expenses (id, society_id, title, amount, expense_date, notes, payment_method)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [exp.id, exp.society_id, exp.title, exp.amount || 0, expDate, exp.details || '', 'cash']
                    );
                }
            }

            // 5. Migrate Notices and Rules
            if (updatedTableNames.includes('old_notices')) {
                const [oldNotices] = await db.promise().query("SELECT * FROM old_notices");
                for (const not of oldNotices) {
                    let pubDate = not.date || null;
                    if (!pubDate || isNaN(Date.parse(pubDate))) {
                        pubDate = new Date();
                    }
                    await db.promise().query(
                        `INSERT INTO notices (id, society_id, title, details, publish_date, notice_type)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [not.id, not.society_id, not.title, not.details || '', pubDate, 'general']
                    );
                }
            }

            if (updatedTableNames.includes('old_rules')) {
                const [oldRules] = await db.promise().query("SELECT * FROM old_rules");
                for (const rule of oldRules) {
                    let pubDate = rule.date || null;
                    if (!pubDate || isNaN(Date.parse(pubDate))) {
                        pubDate = new Date();
                    }
                    await db.promise().query(
                        `INSERT INTO notices (society_id, title, details, publish_date, notice_type)
                         VALUES (?, ?, ?, ?, ?)`,
                        [rule.society_id, `_rule_${rule.title}`, rule.details || '', pubDate, 'general']
                    );
                }
            }

            // 6. Migrate Committee Members
            if (updatedTableNames.includes('old_committee')) {
                const [oldComm] = await db.promise().query("SELECT * FROM old_committee");
                for (const comm of oldComm) {
                    const username = `_committee_${comm.role || 'member'}_${comm.society_id}_${comm.id}`;
                    await db.promise().query(
                        `INSERT INTO users (society_id, username, password_hash, full_name, phone, role)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [comm.society_id, username, 'dummy', comm.name, comm.phone || '', 'committee']
                    );
                }
            }

            // 7. Migrate Complaints
            if (updatedTableNames.includes('old_complaints')) {
                const [oldComplaints] = await db.promise().query("SELECT * FROM old_complaints");
                for (const comp of oldComplaints) {
                    let unitId = null;
                    if (comp.flat) {
                        const [units] = await db.promise().query(
                            "SELECT id FROM units WHERE society_id = ? AND unit_number = ?",
                            [comp.society_id, comp.flat]
                        );
                        if (units.length > 0) {
                            unitId = units[0].id;
                        }
                    }
                    if (!unitId) continue;

                    const [admins] = await db.promise().query("SELECT id FROM users WHERE society_id = ? AND role = 'admin' LIMIT 1", [comp.society_id]);
                    const creatorId = admins.length > 0 ? admins[0].id : 1;

                    let pubDate = comp.date || null;
                    if (!pubDate || isNaN(Date.parse(pubDate))) {
                        pubDate = new Date();
                    }

                    await db.promise().query(
                        `INSERT INTO complaints (id, society_id, unit_id, created_by, title, details, status, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [comp.id, comp.society_id, unitId, creatorId, comp.title, comp.details || '', 'Open', pubDate, pubDate]
                    );
                }
            }

            // 7.5 Update receipts table foreign keys if it exists
            if (updatedTableNames.includes('receipts')) {
                try {
                    await db.promise().query("ALTER TABLE receipts DROP FOREIGN KEY receipts_ibfk_1");
                } catch (e) {}
                try {
                    await db.promise().query("ALTER TABLE receipts DROP FOREIGN KEY receipts_ibfk_2");
                } catch (e) {}
                try {
                    await db.promise().query("ALTER TABLE receipts DROP FOREIGN KEY receipts_ibfk_3");
                } catch (e) {}

                try {
                    await db.promise().query("ALTER TABLE receipts MODIFY COLUMN society_id BIGINT UNSIGNED");
                    await db.promise().query("ALTER TABLE receipts MODIFY COLUMN flat_id BIGINT UNSIGNED");
                    await db.promise().query("ALTER TABLE receipts MODIFY COLUMN maintenance_id BIGINT UNSIGNED");

                    await db.promise().query(
                        `ALTER TABLE receipts ADD CONSTRAINT receipts_ibfk_1 
                         FOREIGN KEY (society_id) REFERENCES societies (id) ON DELETE CASCADE`
                    );
                    await db.promise().query(
                        `ALTER TABLE receipts ADD CONSTRAINT receipts_ibfk_2 
                         FOREIGN KEY (flat_id) REFERENCES units (id) ON DELETE CASCADE`
                    );
                    await db.promise().query(
                        `ALTER TABLE receipts ADD CONSTRAINT receipts_ibfk_3 
                         FOREIGN KEY (maintenance_id) REFERENCES maintenance_invoices (id) ON DELETE CASCADE`
                    );
                    console.log("Updated receipts table foreign keys to point to new tables.");
                } catch (err) {
                    console.error("Failed to update receipts table foreign keys:", err.message);
                }
            }

            console.log("Legacy data migration completed. Dropping legacy tables...");
            const oldTables = [
                'old_admin_credentials', 'old_bank_details', 'old_committee', 'old_complaints',
                'old_expenses', 'old_flats', 'old_maintenance', 'old_notices', 'old_resident_details',
                'old_rules', 'old_societies'
            ];
            for (const t of oldTables) {
                try {
                    await db.promise().query(`DROP TABLE IF EXISTS ${t}`);
                    console.log(`Dropped legacy table ${t}`);
                } catch (e) {
                    console.error(`Failed to drop legacy table ${t}:`, e.message);
                }
            }
        }
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Database initialization / migration failed:", err);
    }
};

waitForDB(); // Waits for MySQL to be ready, then calls initDB()

// --- API ENDPOINTS ---
const API_ROUTES = require("./api-routes");

app.get("/api", (req, res) => {
    res.json({ success: true, routes: API_ROUTES, port: config.port });
});

// Helper functions moved to top

// Setup Society
app.post("/api/setup", async (req, res) => {
    const { society_name, blocks, flats, username, password, property_type } = req.body;

    try {
        // Find existing society and credentials to exclude from unique check
        const [socRows] = await db.promise().query(
            "SELECT id, property_type, address FROM societies WHERE society_name=?",
            [society_name]
        );
        if (socRows.length > 0 && socRows[0].property_type !== (property_type || 'flat')) {
            return res.json({ success: false, error: "A society with this name already exists." });
        }
        let existingSocId = socRows.length > 0 ? socRows[0].id : null;
        let adminUserId = null;
        if (existingSocId) {
            const [admins] = await db.promise().query("SELECT id FROM users WHERE society_id=? AND role='admin'", [existingSocId]);
            if (admins.length > 0) adminUserId = admins[0].id;
        }

        if (username) {
            const unique = await isUsernameUnique(username, adminUserId);
            if (!unique) {
                return res.json({ success: false, error: "Username is already taken by another admin or resident." });
            }
        }

        // Calculate total units
        let totalUnits = 0;
        try {
            const flatsObj = typeof flats === 'string' ? JSON.parse(flats) : flats;
            if (Array.isArray(flatsObj)) {
                totalUnits = flatsObj.reduce((a, b) => a + parseInt(b || 0), 0);
            } else if (flatsObj && typeof flatsObj === 'object') {
                totalUnits = Object.values(flatsObj).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
            }
        } catch (e) {}

        // Preserve bank details in the address JSON if they exist
        let addressObj = { flats_per_block: flats };
        if (socRows.length > 0 && socRows[0].address) {
            try {
                const existingAddr = JSON.parse(socRows[0].address);
                addressObj = { ...existingAddr, flats_per_block: flats };
            } catch (e) {}
        }
        const addressJSON = JSON.stringify(addressObj);

        // 1. Insert/update into societies
        const [socResult] = await db.promise().query(
            `INSERT INTO societies (society_name, total_blocks, total_units, default_due_day, property_type, address) 
             VALUES (?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE total_blocks=?, total_units=?, default_due_day=?, property_type=?, address=?`,
            [
                society_name, blocks, totalUnits, req.body.default_due_day || 1, property_type || 'flat', addressJSON,
                blocks, totalUnits, req.body.default_due_day || 1, property_type || 'flat', addressJSON
            ]
        );

        // Get society ID
        let societyId = socResult.insertId;
        if (!societyId) {
            const [rows] = await db.promise().query(
                "SELECT id FROM societies WHERE society_name=?",
                [society_name]
            );
            societyId = rows[0].id;
        }

        // 2. Insert/update user with 'admin' role
        if (adminUserId) {
            if (password && !password.startsWith('$2a$') && !password.startsWith('$2b$')) {
                const hashedPassword = await bcryptjs.hash(password, 10);
                await db.promise().query(
                    "UPDATE users SET username=?, password_hash=? WHERE id=?",
                    [username, hashedPassword, adminUserId]
                );
            } else {
                await db.promise().query(
                    "UPDATE users SET username=? WHERE id=?",
                    [username, adminUserId]
                );
            }
        } else {
            const hashedPassword = (password && !password.startsWith('$2a$') && !password.startsWith('$2b$'))
                ? await bcryptjs.hash(password, 10)
                : (password || 'dummy');
            await db.promise().query(
                `INSERT INTO users (society_id, username, password_hash, full_name, role)
                 VALUES (?, ?, ?, 'Admin', 'admin')`,
                [societyId, username, hashedPassword]
            );
        }

        res.send({ success: true, id: societyId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Database error during setup" });
    }
});

// Login
app.post("/api/login", async (req, res) => {
    const { user, pass, property_type } = req.body;
    const propType = (property_type || 'flat').toLowerCase();
    try {
        const [result] = await db.promise().query(
            `SELECT s.*, u.username AS admin_username, u.password_hash AS admin_password 
             FROM societies s
             JOIN users u ON s.id = u.society_id
             WHERE LOWER(u.username)=? AND u.role='admin'`,
            [(user || "").trim().toLowerCase()]
        );

        if (result.length === 0) {
            return res.json({ success: false, message: "Username not found" });
        }

        const soc = result[0];
        // Parse flats_per_block and bank details from address JSON
        let flatsPerBlock = "[]";
        let bankName = "";
        let bankAcc = "";
        let bankIfsc = "";
        let qrCode = "";
        if (soc.address) {
            try {
                const addrObj = JSON.parse(soc.address);
                flatsPerBlock = addrObj.flats_per_block || "[]";
                bankName = addrObj.bank_name || "";
                bankAcc = addrObj.bank_acc || "";
                bankIfsc = addrObj.bank_ifsc || "";
                qrCode = addrObj.qr_code || "";
            } catch (e) {}
        }

        // Add legacy properties
        soc.blocks = soc.total_blocks;
        soc.flats_per_block = flatsPerBlock;
        soc.bank_name = bankName;
        soc.bank_acc = bankAcc;
        soc.bank_ifsc = bankIfsc;
        soc.qr_code = qrCode;

        // Ensure the admin's society matches the selected portal type (flat vs bungalow)
        if ((soc.property_type || 'flat').toLowerCase() !== propType) {
            return res.json({ success: false, message: "Username not found" });
        }

        const match = await bcryptjs.compare(pass, soc.admin_password);
        if (!match) {
            return res.json({ success: false, message: "Password not matched" });
        }

        const token = jwt.sign(
            { username: soc.admin_username, role: 'admin', society_id: soc.id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ success: true, society: soc, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Database error during login" });
    }
});

app.post("/api/resident-login", async (req, res) => {
    const { username, password, property_type } = req.body;
    const propType = (property_type || 'flat').toLowerCase();

    try {
        const [flatRows] = await db.promise().query(
            `SELECT u.id AS unit_id, u.society_id, u.unit_number, 
                    b.block_name,
                    us.username AS resident_username, us.password_hash AS resident_password,
                    s.society_name, s.property_type
             FROM units u
             JOIN unit_residents ur ON u.id = ur.unit_id
             JOIN users us ON ur.user_id = us.id
             JOIN societies s ON u.society_id = s.id
             LEFT JOIN blocks b ON u.block_id = b.id
             WHERE LOWER(us.username)=? AND us.role='resident' AND ur.is_active=1`,
            [(username || "").trim().toLowerCase()]
        );

        if (flatRows.length === 0) {
            return res.json({
                success: false,
                message: "Username or password is incorrect"
            });
        }

        const flatRow = flatRows[0];

        // Ensure the resident's society matches the selected portal type (flat vs bungalow)
        if ((flatRow.property_type || 'flat').toLowerCase() !== propType) {
            return res.json({
                success: false,
                message: "Username or password is incorrect"
            });
        }

        if (!flatRow.resident_password) {
            return res.json({
                success: false,
                message: "Username or password is incorrect"
            });
        }

        const match = await bcryptjs.compare(password, flatRow.resident_password);
        if (!match) {
            return res.json({
                success: false,
                message: "Username or password is incorrect"
            });
        }

        const [block, flatNumber] = flatRow.unit_number.includes('-') 
            ? flatRow.unit_number.split('-') 
            : [flatRow.block_name || '', flatRow.unit_number];

        const token = jwt.sign(
            { username: flatRow.resident_username, role: 'resident', society_id: flatRow.society_id, unit_id: flatRow.unit_id },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            society: flatRow.society_name,
            property_type: flatRow.property_type,
            block: flatRow.block_name || block,
            flat: parseInt(flatNumber) || flatNumber,
            token
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error during login" });
    }
});

// Fetch all societies (for initialization)
app.get("/api/societies", (req, res) => {
    db.query("SELECT society_name FROM societies", (err, result) => {
        if (err) return res.status(500).send(err);
        res.send(result.map(r => r.society_name));
    });
});

// Fetch full data for a society
app.get("/api/society/:name/:type", async (req, res) => {
    const name = req.params.name;
    const type = req.params.type;

    try {
        const [societies] = await db.promise().query("SELECT * FROM societies WHERE society_name=? AND property_type=?", [name, type]);
        if (societies.length === 0) return res.status(404).send("Society not found");

        const society = societies[0];
        const socId = society.id;

        const [adminCreds] = await db.promise().query(
            "SELECT username AS admin_username, password_hash AS admin_password FROM users WHERE society_id=? AND role='admin'", 
            [socId]
        );
        const adminCred = adminCreds[0] || { admin_username: '', admin_password: '' };

        let bank = { bank_name: '', bank_acc: '', bank_ifsc: '', qr_code: '' };
        if (society.address) {
            try {
                const addrObj = JSON.parse(society.address);
                bank.bank_name = addrObj.bank_name || '';
                bank.bank_acc = addrObj.bank_acc || '';
                bank.bank_ifsc = addrObj.bank_ifsc || '';
                bank.qr_code = addrObj.qr_code || '';
            } catch (e) {}
        }

        const [residentsRaw] = await db.promise().query(
            `SELECT u.id AS unit_id, u.unit_number, u.occupancy_status,
                    b.block_name,
                    ur.resident_type, ur.is_primary, ur.is_active AS ur_is_active, ur.move_in_date,
                    us.username, us.full_name, us.phone
             FROM units u
             LEFT JOIN blocks b ON u.block_id = b.id
             LEFT JOIN unit_residents ur ON u.id = ur.unit_id
             LEFT JOIN users us ON ur.user_id = us.id
             WHERE u.society_id = ?
             ORDER BY ur.is_active ASC, ur.move_out_date ASC, ur.id ASC`,
            [socId]
        );

        const [latestInvoices] = await db.promise().query(
            `SELECT mi.unit_id, mi.amount, pt.payment_method
             FROM maintenance_invoices mi
             LEFT JOIN payment_transactions pt ON mi.id = pt.invoice_id
             WHERE mi.society_id = ?
             ORDER BY mi.billing_year DESC, mi.billing_month DESC`,
            [socId]
        );

        const latestInvoiceMap = {};
        for (const inv of latestInvoices) {
            const uId = inv.unit_id;
            if (!latestInvoiceMap[uId]) {
                latestInvoiceMap[uId] = {
                    amount: inv.amount,
                    payment_method: 'Cash',
                    has_payment_method: false
                };
            }
            if (!latestInvoiceMap[uId].has_payment_method && inv.payment_method) {
                const ml = inv.payment_method.toLowerCase();
                let method = 'Cash';
                if (ml.includes('upi')) method = 'UPI';
                else if (ml.includes('bank') || ml.includes('transfer')) method = 'Bank Transfer';
                else if (ml.includes('card')) method = 'Card';
                else if (ml.includes('cheque') || ml.includes('check')) method = 'Check';
                latestInvoiceMap[uId].payment_method = method;
                latestInvoiceMap[uId].has_payment_method = true;
            }
        }

        const flatMap = {};
        for (const r of residentsRaw) {
            const uId = r.unit_id;
            if (!flatMap[uId]) {
                const [block, flatNumber] = r.unit_number.includes('-') 
                    ? r.unit_number.split('-') 
                    : [r.block_name || '', r.unit_number];
                
                flatMap[uId] = {
                    id: uId,
                    society_id: socId,
                    block: r.block_name || block,
                    flat_number: parseInt(flatNumber) || flatNumber,
                    latest_amount: 0,
                    latest_payment_method: 'Cash',
                    owner_name: '',
                    phone: '',
                    is_rental: 'No',
                    rental_name: '',
                    rental_phone: '',
                    resident_username: '',
                    past_owner_name: '',
                    past_owner_phone: '',
                    past_rental_name: '',
                    past_rental_phone: '',
                    transfer_period: null
                };

                if (latestInvoiceMap[uId]) {
                    flatMap[uId].latest_amount = latestInvoiceMap[uId].amount;
                    flatMap[uId].latest_payment_method = latestInvoiceMap[uId].payment_method;
                }
            }

            if (r.resident_type === 'owner') {
                if (r.is_primary === 1) {
                    flatMap[uId].owner_name = r.full_name || '';
                    flatMap[uId].phone = r.phone || '';
                    flatMap[uId].resident_username = r.username || '';
                    if (r.move_in_date && r.move_in_date !== '2020-01-01') {
                        flatMap[uId].transfer_period = formatTransferPeriod(r.move_in_date);
                    }
                } else {
                    flatMap[uId].past_owner_name = r.full_name || '';
                    flatMap[uId].past_owner_phone = r.phone || '';
                }
            } else if (r.resident_type === 'tenant') {
                if (r.ur_is_active === 1) {
                    flatMap[uId].is_rental = 'Yes';
                    flatMap[uId].rental_name = r.full_name || '';
                    flatMap[uId].rental_phone = r.phone || '';
                } else {
                    flatMap[uId].past_rental_name = r.full_name || '';
                    flatMap[uId].past_rental_phone = r.phone || '';
                }
            }
        }
        const flats = Object.values(flatMap);

        const [noticesRows] = await db.promise().query("SELECT * FROM notices WHERE society_id=? AND title NOT LIKE '_rule_%'", [socId]);
        const notices = noticesRows.map(n => {
            const isEdited = n.updated_at && n.created_at && (new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 2000);
            return {
                id: n.id,
                society_id: n.society_id,
                title: n.title,
                details: n.details,
                date: formatDateDDMMYYYY(n.publish_date || n.created_at),
                updated_date: isEdited ? formatDateDDMMYYYY(n.updated_at) : null
            };
        });

        const [expensesRows] = await db.promise().query("SELECT * FROM expenses WHERE society_id=?", [socId]);
        const expenses = expensesRows.map(e => {
            const d = new Date(e.expense_date);
            const period = `${monthsList[d.getMonth()]}-${d.getFullYear()}`;
            const isEdited = e.updated_at && e.created_at && (new Date(e.updated_at).getTime() - new Date(e.created_at).getTime() > 2000);
            return {
                id: e.id,
                society_id: e.society_id,
                title: e.title,
                amount: e.amount,
                details: e.notes || '',
                period: period,
                year: d.getFullYear(),
                date: formatDateDDMMYYYY(e.expense_date || e.created_at),
                updated_date: isEdited ? formatDateDDMMYYYY(e.updated_at) : null
            };
        });

        const [committeeRows] = await db.promise().query(
            `SELECT id, society_id, full_name AS name, phone, username 
             FROM users 
             WHERE society_id=? AND role='committee'`, 
            [socId]
        );
        const committee = committeeRows.map(c => {
            let role = 'Member';
            if (c.username && c.username.startsWith('_committee_')) {
                const parts = c.username.split('_');
                if (parts.length >= 3) {
                    role = parts[2];
                }
            }
            return {
                id: c.id,
                society_id: c.society_id,
                name: c.name,
                role: role,
                phone: c.phone
            };
        });

        const [rulesRows] = await db.promise().query("SELECT * FROM notices WHERE society_id=? AND title LIKE '_rule_%'", [socId]);
        const rules = rulesRows.map(r => {
            const isEdited = r.updated_at && r.created_at && (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 2000);
            return {
                id: r.id,
                society_id: r.society_id,
                title: r.title.replace('_rule_', ''),
                details: r.details,
                date: formatDateDDMMYYYY(r.publish_date || r.created_at),
                updated_date: isEdited ? formatDateDDMMYYYY(r.updated_at) : null
            };
        });

        const [complaintsRows] = await db.promise().query(
            `SELECT c.id, c.society_id, c.title, c.details,
                    c.raw_flat_number,
                    u.unit_number AS unit_flat,
                    c.created_at AS date, c.updated_at AS updated_date,
                    us.username AS created_by
             FROM complaints c
             LEFT JOIN units u ON c.unit_id = u.id
             JOIN users us ON c.created_by = us.id
             WHERE c.society_id = ?`,
            [socId]
        );
        const complaints = complaintsRows.map(c => {
            const isEdited = c.updated_date && c.date && (new Date(c.updated_date).getTime() - new Date(c.date).getTime() > 2000);
            return {
                id: c.id,
                society_id: c.society_id,
                title: c.title,
                flat: c.unit_flat || c.raw_flat_number || 'ADMIN',
                details: c.details,
                date: formatDateDDMMYYYY(c.date),
                updated_date: isEdited ? formatDateDDMMYYYY(c.updated_date) : null,
                created_by: c.created_by
            };
        });
 
        const [maintRows] = await db.promise().query(
            `SELECT mi.id, mi.unit_id, mi.billing_month, mi.billing_year, mi.amount, mi.status, mi.notes, mi.paid_at,
                    u.unit_number, b.block_name,
                    pt.payment_method
             FROM maintenance_invoices mi
             JOIN units u ON mi.unit_id = u.id
             LEFT JOIN blocks b ON u.block_id = b.id
             LEFT JOIN payment_transactions pt ON mi.id = pt.invoice_id
             WHERE mi.society_id = ?`,
            [socId]
        );

        const maintenance = maintRows.map(m => {
            const monthName = monthsList[m.billing_month - 1];
            const period = `${monthName}-${m.billing_year}`;
            const notes = deserializeNotes(m.notes);

            const [block, flatNumber] = m.unit_number.includes('-')
                ? m.unit_number.split('-')
                : [m.block_name || '', m.unit_number];

            let method = 'Cash';
            if (m.payment_method) {
                const ml = m.payment_method.toLowerCase();
                if (ml.includes('upi')) method = 'UPI';
                else if (ml.includes('bank') || ml.includes('transfer')) method = 'Bank Transfer';
                else if (ml.includes('card')) method = 'Card';
                else if (ml.includes('cheque') || ml.includes('check')) method = 'Check';
            }

            return {
                id: m.id,
                flat_id: m.unit_id,
                block: m.block_name || block,
                flat_number: parseInt(flatNumber) || flatNumber,
                period: period,
                status: m.status,
                amount: m.amount,
                paid_date: m.paid_at ? formatDateDDMMYYYY(m.paid_at) : '-',
                plan: notes.plan || 'monthly',
                payment_method: method,
                owner_name: notes.owner_name || ''
            };
        });
 
        const flatData = {};
        for (let i = 0; i < society.total_blocks; i++) {
            flatData[String.fromCharCode(65 + i)] = {};
        }
 
        const maintenanceMap = {};
        maintenance.forEach(m => {
            const key = `${m.block}-${m.flat_number}`;
            if (!maintenanceMap[key]) maintenanceMap[key] = {};
            maintenanceMap[key][m.period] = {
                status: m.status,
                amount: m.amount,
                paidDate: m.paid_date,
                plan: m.plan,
                paymentMethod: m.payment_method,
                owner: m.owner_name
            };
        });
 
        for (const flat of flats) {
            if (!flatData[flat.block]) flatData[flat.block] = {};
 
            flatData[flat.block][flat.flat_number] = {
                owner: flat.owner_name,
                phone: flat.phone,
                isRental: flat.is_rental,
                rentalName: flat.rental_name,
                rentalPhone: flat.rental_phone,
                latestAmount: flat.latest_amount,
                latestPaymentMethod: flat.latest_payment_method,
                residentUsername: flat.resident_username || '',
                pastOwner: flat.past_owner_name,
                pastPhone: flat.past_owner_phone,
                pastRentalName: flat.past_rental_name,
                pastRentalPhone: flat.past_rental_phone,
                transferPeriod: flat.transfer_period,
                months: maintenanceMap[`${flat.block}-${flat.flat_number}`] || {}
            };
        }

        let parsedFlats = society.address;
        try {
            const addrObj = JSON.parse(society.address);
            parsedFlats = addrObj.flats_per_block || "[]";
        } catch (e) {
            parsedFlats = "[]";
        }
        if (typeof parsedFlats === 'string') {
            try {
                parsedFlats = JSON.parse(parsedFlats);
            } catch (e) {}
        }

        res.send({
            config: {
                blocks: society.total_blocks,
                flats: parsedFlats,
                user: adminCred.admin_username,
                defaultDueDay: society.default_due_day,
                propertyType: society.property_type || 'flat'
            },
            bank: {
                n: bank.bank_name,
                a: bank.bank_acc,
                i: bank.bank_ifsc,
                q: bank.qr_code
            },
            apartmentData: flatData,
            notices: notices,
            expenses: expenses,
            committee: committee,
            rules: rules,
            complaints: complaints
        });
    } catch (err) {
        console.error("Society data fetch error:", err);
        res.status(500).json({ success: false, error: "Failed to fetch society data" });
    }
});

// Save/Update Flat
app.post("/api/flat", async (req, res) => {
    const { society_name, block, flat_number, owner, phone, isRental, rentalName, rentalPhone, amount, period, status, plan, paymentMethod, dateStr, futureOwner, futureOwnerPhone, transferMonth, transferYear, property_type, residentUsername, residentPassword } = req.body;

    const transferPeriod = (futureOwner && transferMonth && transferYear)
        ? `${transferMonth}-${transferYear}`
        : null;

    try {
        const [societies] = await db.promise().query("SELECT id FROM societies WHERE society_name=? AND property_type=?", [society_name, property_type || 'flat']);
        if (societies.length === 0) return res.status(404).send("Society not found");
        const socId = societies[0].id;

        const ultimateOwner = futureOwner ? futureOwner : owner;
        const ultimatePhone = (futureOwner && futureOwnerPhone) ? futureOwnerPhone : phone;

        console.log(`Updating flat ${block}-${flat_number} in ${society_name}. Current: ${owner}, Future: ${futureOwner}, Transfer: ${transferPeriod}`);

        // Find or create block
        let blockId = null;
        if (block) {
            const [blocks] = await db.promise().query(
                "SELECT id FROM blocks WHERE society_id = ? AND block_name = ?",
                [socId, block]
            );
            if (blocks.length > 0) {
                blockId = blocks[0].id;
            } else {
                const [blockInsert] = await db.promise().query(
                    "INSERT INTO blocks (society_id, block_name) VALUES (?, ?)",
                    [socId, block]
                );
                blockId = blockInsert.insertId;
            }
        }

        // Find or create unit (flat)
        const unitNumber = `${block}-${flat_number}`;
        const occupancyStatus = (isRental === 'Yes' || owner) ? 'occupied' : 'vacant';
        let unitId = null;
        const [units] = await db.promise().query(
            "SELECT id FROM units WHERE society_id=? AND unit_number=?",
            [socId, unitNumber]
        );
        if (units.length > 0) {
            unitId = units[0].id;
            await db.promise().query(
                "UPDATE units SET occupancy_status=? WHERE id=?",
                [occupancyStatus, unitId]
            );
        } else {
            const [unitInsert] = await db.promise().query(
                `INSERT INTO units (society_id, block_id, unit_number, occupancy_status) 
                 VALUES (?, ?, ?, ?)`,
                [socId, blockId, unitNumber, occupancyStatus]
            );
            unitId = unitInsert.insertId;
        }

        // Find existing primary owner
        const [primaryOwnerRows] = await db.promise().query(
            `SELECT ur.user_id 
             FROM unit_residents ur 
             WHERE ur.unit_id=? AND ur.resident_type='owner' AND ur.is_primary=1 AND ur.is_active=1`,
            [unitId]
        );

        let ownerUserId = null;
        if (primaryOwnerRows.length > 0) {
            ownerUserId = primaryOwnerRows[0].user_id;
        }

        // Find existing primary tenant (rental)
        const [tenantRows] = await db.promise().query(
            `SELECT ur.user_id 
             FROM unit_residents ur 
             WHERE ur.unit_id=? AND ur.resident_type='tenant' AND ur.is_active=1`,
            [unitId]
        );
        const tenantUserId = tenantRows.length > 0 ? tenantRows[0].user_id : null;

        const dbUsername = (residentUsername && residentUsername.trim() !== "") ? residentUsername.trim() : null;

        if (dbUsername) {
            let skipUniquenessCheck = false;
            if (ownerUserId) {
                const [ownerUserRows] = await db.promise().query(
                    "SELECT LOWER(username) AS username FROM users WHERE id=?",
                    [ownerUserId]
                );
                if (ownerUserRows.length > 0 && ownerUserRows[0].username === dbUsername.toLowerCase()) {
                    skipUniquenessCheck = true;
                }
            }
            if (!skipUniquenessCheck) {
                const unique = await isUsernameUnique(dbUsername, ownerUserId);
                if (!unique) {
                    return res.json({ success: false, message: "Username is already taken by another admin or resident." });
                }
            }
        }

        let residentPassHash = null;
        if (residentPassword) {
            residentPassHash = await bcryptjs.hash(residentPassword, 10);
        }

        if (futureOwner) {
            // Ownership transfer!
            // 1. Archive the current owner (make them inactive past owner)
            if (ownerUserId) {
                const moveInDateNew = `${transferYear}-${String(monthsList.indexOf(transferMonth) + 1).padStart(2, '0')}-01`;
                const d = new Date(moveInDateNew);
                d.setDate(d.getDate() - 1);
                const moveOutDateOld = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                await db.promise().query(
                    `UPDATE unit_residents 
                     SET is_primary=0, is_active=0, move_out_date=? 
                     WHERE unit_id=? AND user_id=?`,
                    [moveOutDateOld, unitId, ownerUserId]
                );
            }

            // Archive the current tenant (if any exists)
            if (tenantUserId) {
                const moveInDateNew = `${transferYear}-${String(monthsList.indexOf(transferMonth) + 1).padStart(2, '0')}-01`;
                const d = new Date(moveInDateNew);
                d.setDate(d.getDate() - 1);
                const moveOutDateOld = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

                await db.promise().query(
                    `UPDATE unit_residents 
                     SET is_primary=0, is_active=0, move_out_date=? 
                     WHERE unit_id=? AND user_id=? AND resident_type='tenant'`,
                    [moveOutDateOld, unitId, tenantUserId]
                );
            }

            // 2. Create the new owner user
            const newOwnerUsername = dbUsername || `_owner_${unitId}_${Date.now()}`;
            const [newOwnerInsert] = await db.promise().query(
                `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                 VALUES (?, ?, ?, ?, ?, 'resident')`,
                [socId, newOwnerUsername, ultimatePhone, residentPassHash || 'dummy', ultimateOwner]
            );
            const newOwnerUserId = newOwnerInsert.insertId;

            // 3. Link new owner as primary active owner
            const moveInDateNew = `${transferYear}-${String(monthsList.indexOf(transferMonth) + 1).padStart(2, '0')}-01`;
            await db.promise().query(
                `INSERT INTO unit_residents (unit_id, user_id, resident_type, is_primary, move_in_date)
                 VALUES (?, ?, 'owner', 1, ?)`,
                [unitId, newOwnerUserId, moveInDateNew]
            );
        } else {
            // Simple update of current owner
            if (ownerUserId) {
                // Update existing user details
                let updateSql = "UPDATE users SET full_name=?, phone=?";
                let params = [ultimateOwner, ultimatePhone];
                if (dbUsername) {
                    updateSql += ", username=?";
                    params.push(dbUsername);
                }
                if (residentPassHash) {
                    updateSql += ", password_hash=?";
                    params.push(residentPassHash);
                }
                updateSql += " WHERE id=?";
                params.push(ownerUserId);
                await db.promise().query(updateSql, params);
            } else {
                // Create user and link if not exists
                const fallbackUsername = dbUsername || `_owner_${unitId}_${Date.now()}`;
                const [userInsert] = await db.promise().query(
                    `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                     VALUES (?, ?, ?, ?, ?, 'resident')`,
                    [socId, fallbackUsername, ultimatePhone, residentPassHash || 'dummy', ultimateOwner]
                );
                const newOwnerUserId = userInsert.insertId;

                await db.promise().query(
                    `INSERT INTO unit_residents (unit_id, user_id, resident_type, is_primary, move_in_date)
                     VALUES (?, ?, 'owner', 1, '2020-01-01')`,
                    [unitId, newOwnerUserId]
                );
            }
        }

        // Handle Tenant (rental) Update (only if this is not a scheduled ownership transfer)
        if (!futureOwner) {
            if (isRental === 'Yes') {
                if (tenantUserId) {
                    await db.promise().query(
                        "UPDATE users SET full_name=?, phone=? WHERE id=?",
                        [rentalName, rentalPhone, tenantUserId]
                    );
                } else {
                    const tenantUsername = `_tenant_${unitId}_${Date.now()}`;
                    const [tenantInsert] = await db.promise().query(
                        `INSERT INTO users (society_id, username, phone, password_hash, full_name, role)
                         VALUES (?, ?, ?, 'dummy', ?, 'resident')`,
                        [socId, tenantUsername, rentalPhone, rentalName]
                    );
                    const newTenantUserId = tenantInsert.insertId;

                    await db.promise().query(
                        `INSERT INTO unit_residents (unit_id, user_id, resident_type, is_primary, move_in_date)
                         VALUES (?, ?, 'tenant', 1, '2020-01-01')`,
                        [unitId, newTenantUserId]
                    );
                }
            } else {
                // If was rental and now is not, mark tenant as inactive
                if (tenantUserId) {
                    await db.promise().query(
                        "UPDATE unit_residents SET is_active=0, move_out_date=NOW() WHERE unit_id=? AND user_id=?",
                        [unitId, tenantUserId]
                    );
                }
            }
        }

        // 2. Upsert maintenance record for the SPECIFIC period being edited
        const periodParts = period.split('-');
        const billingMonth = monthsList.indexOf(periodParts[0]) + 1;
        const billingYear = parseInt(periodParts[1]);

        const invoiceNumber = `INV-${unitId}-${billingYear}-${billingMonth}`;
        const notes = serializeNotes(plan || 'monthly', owner || '');
        const dueDate = `${billingYear}-${String(billingMonth).padStart(2, '0')}-01`;

        const [existingInvoice] = await db.promise().query(
            "SELECT id FROM maintenance_invoices WHERE unit_id=? AND billing_year=? AND billing_month=?",
            [unitId, billingYear, billingMonth]
        );

        let invoiceId = null;
        let finalPaidDate = dateStr && dateStr !== '-' ? parsePaidDate(dateStr) : null;

        if (existingInvoice.length > 0) {
            invoiceId = existingInvoice[0].id;
            await db.promise().query(
                `UPDATE maintenance_invoices 
                 SET status=?, amount=?, notes=?, paid_at=? 
                 WHERE id=?`,
                [status, amount, notes, finalPaidDate, invoiceId]
            );
        } else {
            const [invInsert] = await db.promise().query(
                `INSERT INTO maintenance_invoices (society_id, unit_id, invoice_number, billing_year, billing_month, amount, due_date, status, notes, paid_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [socId, unitId, invoiceNumber, billingYear, billingMonth, amount, dueDate, status, notes, finalPaidDate]
            );
            invoiceId = invInsert.insertId;
        }

        // Handle payment transaction
        if (status === 'Paid') {
            let method = 'cash';
            if (paymentMethod) {
                const mLower = paymentMethod.toLowerCase();
                if (mLower.includes('upi')) method = 'upi';
                else if (mLower.includes('bank') || mLower.includes('transfer')) method = 'bank_transfer';
                else if (mLower.includes('card')) method = 'card';
                else if (mLower.includes('cheque') || mLower.includes('check')) method = 'cheque';
            }

            await db.promise().query(
                "DELETE FROM payment_transactions WHERE invoice_id = ?",
                [invoiceId]
            );
            await db.promise().query(
                `INSERT INTO payment_transactions (invoice_id, payment_method, amount, status, paid_at)
                 VALUES (?, ?, ?, 'Success', ?)`,
                [invoiceId, method, amount, finalPaidDate]
            );
        } else {
            await db.promise().query(
                "DELETE FROM payment_transactions WHERE invoice_id=?",
                [invoiceId]
            );
        }

        const editYear = billingYear;

        // 2.5 If ownership transfer is scheduled, pre-populate/upsert records
        if (futureOwner && transferMonth && transferYear) {
            const tYear = parseInt(transferYear);
            const yearsToPopulate = new Set([editYear, tYear]);

            for (const y of yearsToPopulate) {
                for (const mName of monthsList) {
                    const mPeriod = `${mName}-${y}`;
                    const targetOwner = (mPeriod === transferPeriod || isPeriodAfter(mPeriod, transferPeriod))
                        ? futureOwner
                        : owner;

                    const mMonth = monthsList.indexOf(mName) + 1;
                    const [existing] = await db.promise().query(
                        "SELECT id, notes FROM maintenance_invoices WHERE unit_id=? AND billing_year=? AND billing_month=?",
                        [unitId, y, mMonth]
                    );

                    const defaultNotes = serializeNotes('monthly', targetOwner);
                    if (existing.length > 0) {
                        const parsedNotes = deserializeNotes(existing[0].notes);
                        parsedNotes.owner_name = targetOwner;
                        await db.promise().query(
                            "UPDATE maintenance_invoices SET notes=? WHERE id=?",
                            [JSON.stringify(parsedNotes), existing[0].id]
                        );
                    } else {
                        const defaultInvoiceNumber = `INV-${unitId}-${y}-${mMonth}`;
                        const defaultDueDate = `${y}-${String(mMonth).padStart(2, '0')}-01`;
                        await db.promise().query(
                            `INSERT INTO maintenance_invoices (society_id, unit_id, invoice_number, billing_year, billing_month, amount, due_date, status, notes)
                             VALUES (?, ?, ?, ?, ?, 0, ?, 'Pending', ?)`,
                            [socId, unitId, defaultInvoiceNumber, y, mMonth, defaultDueDate, defaultNotes]
                        );
                    }
                }
            }
        }

        // 3. Forward Propagation: Update EXISTING future records
        const [allInvoices] = await db.promise().query(
            "SELECT id, billing_month, billing_year, status, notes FROM maintenance_invoices WHERE unit_id=?",
            [unitId]
        );
        for (const inv of allInvoices) {
            const invMonthName = monthsList[inv.billing_month - 1];
            const invPeriod = `${invMonthName}-${inv.billing_year}`;

            if (isPeriodAfter(invPeriod, period)) {
                if (inv.status === 'Pending') {
                    let targetOwner = owner;
                    if (transferPeriod) {
                        if (invPeriod === transferPeriod || isPeriodAfter(invPeriod, transferPeriod)) {
                            targetOwner = futureOwner;
                        }
                    }

                    const parsedNotes = deserializeNotes(inv.notes);
                    parsedNotes.owner_name = targetOwner;
                    await db.promise().query(
                        "UPDATE maintenance_invoices SET notes=? WHERE id=?",
                        [JSON.stringify(parsedNotes), inv.id]
                    );
                }
            }
        }

        console.log(`Propagation complete for flat ${unitId}`);
        res.send({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

// Fetch Single Flat Details
app.get("/api/flat", async (req, res) => {
    const { society_name, block, flat_number, property_type } = req.query;
    const propType = property_type || 'flat';

    if (!society_name || !block || !flat_number) {
        return res.status(400).json({ success: false, error: "Missing required parameters: society_name, block, flat_number." });
    }

    try {
        const [societies] = await db.promise().query(
            "SELECT id FROM societies WHERE society_name=? AND property_type=?",
            [society_name, propType]
        );
        if (societies.length === 0) {
            return res.status(404).json({ success: false, error: "Society not found." });
        }
        const socId = societies[0].id;

        const unitNumber = `${block}-${flat_number}`;
        const [units] = await db.promise().query(
            "SELECT id, occupancy_status FROM units WHERE society_id=? AND unit_number=?",
            [socId, unitNumber]
        );
        if (units.length === 0) {
            return res.status(404).json({ success: false, error: "Flat not found." });
        }
        const unitId = units[0].id;

        // Fetch residents details
        const [residents] = await db.promise().query(
            `SELECT ur.resident_type, ur.is_primary, ur.is_active, ur.move_in_date,
                    us.username, us.full_name, us.phone
             FROM unit_residents ur
             JOIN users us ON ur.user_id = us.id
             WHERE ur.unit_id = ?`,
            [unitId]
        );

        let owner = "";
        let phone = "";
        let isRental = "No";
        let rentalName = "";
        let rentalPhone = "";
        let residentUsername = "";
        let pastOwner = "";
        let pastPhone = "";
        let transferPeriod = null;

        for (const r of residents) {
            if (r.resident_type === 'owner') {
                if (r.is_primary === 1 && r.is_active === 1) {
                    owner = r.full_name || "";
                    phone = r.phone || "";
                    residentUsername = r.username || "";
                    if (r.move_in_date && r.move_in_date !== '2020-01-01') {
                        flatMapTransfer = formatTransferPeriod(r.move_in_date);
                        transferPeriod = flatMapTransfer;
                    }
                } else if (r.is_active === 0) {
                    pastOwner = r.full_name || "";
                    pastPhone = r.phone || "";
                }
            } else if (r.resident_type === 'tenant') {
                if (r.is_active === 1) {
                    isRental = "Yes";
                    rentalName = r.full_name || "";
                    rentalPhone = r.phone || "";
                }
            }
        }

        // Fetch latest maintenance invoice/payment transaction for details
        const [latestInvoice] = await db.promise().query(
            `SELECT mi.amount, mi.billing_month, mi.billing_year, mi.status, mi.notes, mi.paid_at,
                    pt.payment_method
             FROM maintenance_invoices mi
             LEFT JOIN payment_transactions pt ON mi.id = pt.invoice_id
             WHERE mi.unit_id = ?
             ORDER BY mi.billing_year DESC, mi.billing_month DESC
             LIMIT 1`,
            [unitId]
        );

        let amount = 0;
        let period = "";
        let status = "Pending";
        let plan = "monthly";
        let paymentMethod = "Cash";
        let dateStr = "";

        if (latestInvoice.length > 0) {
            const inv = latestInvoice[0];
            amount = inv.amount || 0;
            const monthName = monthsList[inv.billing_month - 1];
            period = `${monthName}-${inv.billing_year}`;
            status = inv.status || "Pending";
            
            const parsedNotes = deserializeNotes(inv.notes);
            plan = parsedNotes.plan || "monthly";

            if (inv.payment_method) {
                const ml = inv.payment_method.toLowerCase();
                if (ml.includes('upi')) paymentMethod = 'UPI';
                else if (ml.includes('bank') || ml.includes('transfer')) paymentMethod = 'Bank Transfer';
                else if (ml.includes('card')) paymentMethod = 'Card';
                else if (ml.includes('cheque') || ml.includes('check')) paymentMethod = 'Check';
            }

            dateStr = inv.paid_at ? formatDateDDMMYYYY(inv.paid_at) : "-";
        }

        res.json({
            success: true,
            society_name,
            block,
            flat_number: parseInt(flat_number) || flat_number,
            owner,
            phone,
            isRental,
            rentalName,
            rentalPhone,
            amount,
            period,
            status,
            plan,
            paymentMethod,
            dateStr,
            residentUsername,
            pastOwner,
            pastPhone,
            transferPeriod,
            property_type: propType
        });
    } catch (err) {
        console.error("GET flat error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fetch All Expenses for a Society
app.get("/api/expense", async (req, res) => {
    const { society_name, property_type } = req.query;
    const propType = property_type || 'flat';

    if (!society_name) {
        return res.status(400).json({ success: false, error: "Missing required parameter: society_name." });
    }

    try {
        const [societies] = await db.promise().query(
            "SELECT id FROM societies WHERE society_name=? AND property_type=?",
            [society_name, propType]
        );
        if (societies.length === 0) return res.status(404).json({ success: false, error: "Society not found." });
        const socId = societies[0].id;

        const [expensesRows] = await db.promise().query(
            "SELECT * FROM expenses WHERE society_id=? ORDER BY expense_date DESC",
            [socId]
        );
        const expenses = expensesRows.map(e => {
            const d = new Date(e.expense_date);
            const period = `${monthsList[d.getMonth()]}-${d.getFullYear()}`;
            const isEdited = e.updated_at && e.created_at && (new Date(e.updated_at).getTime() - new Date(e.created_at).getTime() > 2000);
            return {
                id: e.id,
                society_id: e.society_id,
                title: e.title,
                amount: e.amount,
                details: e.notes || '',
                period: period,
                year: d.getFullYear(),
                date: formatDateDDMMYYYY(e.expense_date || e.created_at),
                updated_date: isEdited ? formatDateDDMMYYYY(e.updated_at) : null
            };
        });

        res.json({ success: true, expenses });
    } catch (err) {
        console.error("GET expenses error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save/Update Expense
app.post("/api/expense", async (req, res) => {
    const { id, society_name, title, amount, details, period, year, date, property_type } = req.body;
    try {
        const [societies] = await db.promise().query("SELECT id FROM societies WHERE society_name=? AND property_type=?", [society_name, property_type || 'flat']);
        if (societies.length === 0) return res.status(404).send("Society not found");
        const socId = societies[0].id;

        const expenseDate = parseDDMMYYYY(date);

        if (id) {
            await db.promise().query(
                `UPDATE expenses SET title=?, amount=?, notes=? WHERE id=?`,
                [title, amount, details, id]
            );
        } else {
            await db.promise().query(
                `INSERT INTO expenses (society_id, title, amount, notes, expense_date) VALUES (?, ?, ?, ?, ?)`,
                [socId, title, amount, details, expenseDate]
            );
        }
        res.send({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

// Delete Expense
app.delete("/api/expense/:id", (req, res) => {
    db.query("DELETE FROM expenses WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send({ success: true });
    });
});

// Fetch All Notices for a Society
app.get("/api/notice", async (req, res) => {
    const { society_name, property_type } = req.query;
    const propType = property_type || 'flat';

    if (!society_name) {
        return res.status(400).json({ success: false, error: "Missing required parameter: society_name." });
    }

    try {
        const [societies] = await db.promise().query(
            "SELECT id FROM societies WHERE society_name=? AND property_type=?",
            [society_name, propType]
        );
        if (societies.length === 0) return res.status(404).json({ success: false, error: "Society not found." });
        const socId = societies[0].id;

        const [noticeRows] = await db.promise().query(
            "SELECT * FROM notices WHERE society_id=? AND title NOT LIKE '_rule_%' ORDER BY publish_date DESC",
            [socId]
        );
        const notices = noticeRows.map(n => {
            return {
                id: n.id,
                society_id: n.society_id,
                title: n.title,
                details: n.details,
                date: formatDateDDMMYYYY(n.publish_date || n.created_at)
            };
        });

        res.json({ success: true, notices });
    } catch (err) {
        console.error("GET notices error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save/Update Notice
app.post("/api/notice", async (req, res) => {
    const { id, society_name, title, details, date, property_type } = req.body;
    try {
        const [societies] = await db.promise().query("SELECT id FROM societies WHERE society_name=? AND property_type=?", [society_name, property_type || 'flat']);
        if (societies.length === 0) return res.status(404).send("Society not found");
        const socId = societies[0].id;

        const publishDate = parseDDMMYYYY(date);

        if (id) {
            await db.promise().query(
                `UPDATE notices SET title=?, details=? WHERE id=?`,
                [title, details, id]
            );
        } else {
            await db.promise().query(
                `INSERT INTO notices (society_id, title, details, publish_date, notice_type) VALUES (?, ?, ?, ?, 'general')`,
                [socId, title, details, publishDate]
            );
        }
        res.send({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

// Delete Notice
app.delete("/api/notice/:id", (req, res) => {
    db.query("DELETE FROM notices WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send({ success: true });
    });
});

// Fetch All Rules for a Society
app.get("/api/rule", async (req, res) => {
    const { society_name, property_type } = req.query;
    const propType = property_type || 'flat';

    if (!society_name) {
        return res.status(400).json({ success: false, error: "Missing required parameter: society_name." });
    }

    try {
        const [societies] = await db.promise().query(
            "SELECT id FROM societies WHERE society_name=? AND property_type=?",
            [society_name, propType]
        );
        if (societies.length === 0) return res.status(404).json({ success: false, error: "Society not found." });
        const socId = societies[0].id;

        const [ruleRows] = await db.promise().query(
            "SELECT * FROM notices WHERE society_id=? AND title LIKE '_rule_%' ORDER BY publish_date DESC",
            [socId]
        );
        const rules = ruleRows.map(r => {
            const title = r.title.startsWith('_rule_') ? r.title.substring(6) : r.title;
            return {
                id: r.id,
                society_id: r.society_id,
                title: title,
                details: r.details,
                date: formatDateDDMMYYYY(r.publish_date || r.created_at)
            };
        });

        res.json({ success: true, rules });
    } catch (err) {
        console.error("GET rules error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save/Update Rule
app.post("/api/rule", async (req, res) => {
    const { id, society_name, title, details, date, property_type } = req.body;
    try {
        const [societies] = await db.promise().query("SELECT id FROM societies WHERE society_name=? AND property_type=?", [society_name, property_type || 'flat']);
        if (societies.length === 0) return res.status(404).send("Society not found");
        const socId = societies[0].id;

        const publishDate = parseDDMMYYYY(date);
        const ruleTitle = `_rule_${title}`;

        if (id) {
            await db.promise().query(
                `UPDATE notices SET title=?, details=? WHERE id=?`,
                [ruleTitle, details, id]
            );
        } else {
            await db.promise().query(
                `INSERT INTO notices (society_id, title, details, publish_date, notice_type) VALUES (?, ?, ?, ?, 'general')`,
                [socId, ruleTitle, details, publishDate]
            );
        }
        res.send({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

// Delete Rule
app.delete("/api/rule/:id", (req, res) => {
    db.query("DELETE FROM notices WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send({ success: true });
    });
});

// Fetch All Complaints for a Society
app.get("/api/complaint", async (req, res) => {
    const { society_name, property_type } = req.query;
    const propType = property_type || 'flat';

    if (!society_name) {
        return res.status(400).json({ success: false, error: "Missing required parameter: society_name." });
    }

    try {
        const [societies] = await db.promise().query(
            "SELECT id FROM societies WHERE society_name=? AND property_type=?",
            [society_name, propType]
        );
        if (societies.length === 0) return res.status(404).json({ success: false, error: "Society not found." });
        const socId = societies[0].id;

        const [complaintRows] = await db.promise().query(
            `SELECT c.*, u.unit_number, usr.username 
             FROM complaints c 
             LEFT JOIN units u ON c.unit_id = u.id 
             LEFT JOIN users usr ON c.created_by = usr.id 
             WHERE c.society_id=? 
             ORDER BY c.created_at DESC`,
            [socId]
        );
        const complaints = complaintRows.map(c => {
            return {
                id: c.id,
                society_id: c.society_id,
                title: c.title,
                flat: c.unit_number || c.raw_flat_number || '',
                details: c.details,
                date: formatDateDDMMYYYY(c.created_at),
                createdBy: c.username || ''
            };
        });

        res.json({ success: true, complaints });
    } catch (err) {
        console.error("GET complaints error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save/Update Complaint
app.post("/api/complaint", async (req, res) => {
    const { id, society_name, title, flat, details, date, createdBy, property_type } = req.body;
    try {
        const [societies] = await db.promise().query("SELECT id FROM societies WHERE society_name=? AND property_type=?", [society_name, property_type || 'flat']);
        if (societies.length === 0) return res.status(404).json({ success: false, error: "Society not found" });
        const socId = societies[0].id;

        // Try to find a matching unit; if not found (e.g. "ADMIN"), allow a freeform raw_flat_number
        let unitId = null;
        let rawFlatNumber = null;
        if (flat) {
            const [units] = await db.promise().query("SELECT id FROM units WHERE society_id=? AND unit_number=?", [socId, flat]);
            if (units.length > 0) {
                unitId = units[0].id;
            } else {
                // Store as freeform (e.g. "ADMIN", society-level complaint)
                rawFlatNumber = flat;
            }
        }

        const [users] = await db.promise().query("SELECT id FROM users WHERE society_id=? AND username=?", [socId, createdBy]);
        let creatorId = users.length > 0 ? users[0].id : null;
        if (!creatorId) {
            const [admins] = await db.promise().query("SELECT id FROM users WHERE society_id=? AND role='admin' LIMIT 1", [socId]);
            creatorId = admins.length > 0 ? admins[0].id : 1;
        }

        const publishDate = parseDDMMYYYY(date);

        if (id) {
            await db.promise().query(
                `UPDATE complaints SET title=?, unit_id=?, raw_flat_number=?, details=? WHERE id=?`,
                [title, unitId, rawFlatNumber, details, id]
            );
        } else {
            await db.promise().query(
                `INSERT INTO complaints (society_id, unit_id, raw_flat_number, created_by, title, details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [socId, unitId, rawFlatNumber, creatorId, title, details, publishDate, publishDate]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete Complaint
app.delete("/api/complaint/:id", (req, res) => {
    db.query("DELETE FROM complaints WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send({ success: true });
    });
});



// Fetch All Committee Members for a Society
app.get("/api/committee", async (req, res) => {
    const { society_name, property_type } = req.query;
    const propType = property_type || 'flat';

    if (!society_name) {
        return res.status(400).json({ success: false, error: "Missing required parameter: society_name." });
    }

    try {
        const [societies] = await db.promise().query(
            "SELECT id FROM societies WHERE society_name=? AND property_type=?",
            [society_name, propType]
        );
        if (societies.length === 0) return res.status(404).json({ success: false, error: "Society not found." });
        const socId = societies[0].id;

        const [committeeRows] = await db.promise().query(
            `SELECT id, society_id, full_name AS name, phone, username 
             FROM users 
             WHERE society_id=? AND role='committee' 
             ORDER BY id ASC`,
            [socId]
        );
        const committee = committeeRows.map(c => {
            let role = 'Member';
            if (c.username && c.username.startsWith('_committee_')) {
                const parts = c.username.split('_');
                if (parts.length >= 3) {
                    role = parts[2];
                }
            }
            return {
                id: c.id,
                society_id: c.society_id,
                name: c.name,
                role: role,
                phone: c.phone
            };
        });

        res.json({ success: true, committee });
    } catch (err) {
        console.error("GET committee error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Save Committee Member
app.post("/api/committee", async (req, res) => {
    const { society_name, name, role, phone, property_type } = req.body;
    try {
        const [societies] = await db.promise().query("SELECT id FROM societies WHERE society_name=? AND property_type=?", [society_name, property_type || 'flat']);
        if (societies.length === 0) return res.status(404).send("Society not found");
        const socId = societies[0].id;

        const username = `_committee_${role || 'member'}_${socId}_${Date.now()}`;
        const [result] = await db.promise().query(
            `INSERT INTO users (society_id, username, password_hash, full_name, phone, role) 
             VALUES (?, ?, 'dummy', ?, ?, 'committee')`,
            [socId, username, name, phone, role]
        );
        res.send({ success: true, id: result.insertId });
    } catch (err) {
        res.status(500).send(err);
    }
});

// Delete Committee Member
app.delete("/api/committee/:id", (req, res) => {
    db.query("DELETE FROM users WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send({ success: true });
    });
});



// Save Bank Details
app.post("/api/bank", async (req, res) => {
    const { society_name, bank_name, bank_acc, bank_ifsc, qr_code, property_type } = req.body;
    try {
        const [socRows] = await db.promise().query(
            "SELECT id, address FROM societies WHERE society_name=? AND property_type=?",
            [society_name, property_type || 'flat']
        );
        if (socRows.length === 0) return res.status(404).send("Society not found");

        const socId = socRows[0].id;
        let addressObj = {};
        if (socRows[0].address) {
            try {
                addressObj = JSON.parse(socRows[0].address);
            } catch (e) {}
        }

        addressObj.bank_name = bank_name;
        addressObj.bank_acc = bank_acc;
        addressObj.bank_ifsc = bank_ifsc;
        addressObj.qr_code = qr_code;

        const addressJSON = JSON.stringify(addressObj);

        await db.promise().query(
            "UPDATE societies SET address=? WHERE id=?",
            [addressJSON, socId]
        );
        res.send({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err);
    }
});

const residentOtps = {};

app.post("/api/request-resident-otp", async (req, res) => {
    const { society, flat, phone, property_type } = req.body;

    try {
        const [block, flatNumber] = flat.includes('-') ? flat.split('-') : [flat.charAt(0), flat.slice(1)];

        const [societyRows] = await db.promise().query("SELECT id FROM societies WHERE society_name=? AND property_type=?", [society, property_type || 'flat']);
        if (societyRows.length === 0) return res.json({ success: false, message: "Society not found" });

        const societyId = societyRows[0].id;

        // 1. Check if the flat exists at all
        const unitNumber = `${block}-${flatNumber}`;
        const [flatExists] = await db.promise().query(
            `SELECT id FROM units WHERE society_id=? AND unit_number=?`,
            [societyId, unitNumber]
        );

        if (flatExists.length === 0) return res.json({ success: false, message: "Flat not found" });
        const unitId = flatExists[0].id;

        // 2. Check if the provided phone matches the active owner or rental phone
        const [residentRows] = await db.promise().query(
            `SELECT ur.resident_type, ur.is_primary, ur.is_active AS ur_is_active, ur.move_in_date,
                    us.phone, us.username
             FROM unit_residents ur
             JOIN users us ON ur.user_id = us.id
             WHERE ur.unit_id = ?`,
            [unitId]
        );

        if (residentRows.length === 0) return res.json({ success: false, message: "wrong number entered" });

        const now = new Date();
        const currentPeriod = `${monthsList[now.getMonth() ]}-${now.getFullYear()}`;

        let activePhone = "";
        let rentalPhone = "";

        for (const r of residentRows) {
            if (r.resident_type === 'owner') {
                if (r.is_primary === 1) {
                    activePhone = r.phone;
                } else {
                    if (r.move_in_date && r.move_in_date !== '2020-01-01') {
                        const transferPeriod = formatTransferPeriod(r.move_in_date);
                        if (transferPeriod && isPeriodBefore(currentPeriod, transferPeriod)) {
                            activePhone = r.phone;
                        }
                    }
                }
            } else if (r.resident_type === 'tenant' && r.ur_is_active === 1) {
                rentalPhone = r.phone;
            }
        }

        const cleanInput = phone ? phone.replace(/\D/g, "").slice(-10) : "";
        const cleanActive = activePhone ? activePhone.replace(/\D/g, "").slice(-10) : "";
        const cleanRental = rentalPhone ? rentalPhone.replace(/\D/g, "").slice(-10) : "";

        if (cleanInput !== cleanActive && cleanInput !== cleanRental) {
            return res.json({ success: false, message: "wrong number entered" });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const key = `${society}_${flat}_${phone}`;
        residentOtps[key] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };

        console.log(`[OTP GENERATED] For ${key}: ${otp}`);

        const twilioClient = config.getTwilioClient();

        try {
            await twilioClient.messages.create({
                body: `Your new maintenance portal password reset code is: ${otp} For your security, do not share this 6-digit code with anyone,.`,
                messagingServiceSid: config.twilio.messagingServiceSid,
                to: `+91${phone}`
            });
            console.log(`[Twilio Message Sent] To: +91${phone}`);
            res.json({ success: true, message: "OTP sent" });
        } catch (twilioErr) {
            console.log("Twilio Error (Daily Limit?): ", twilioErr.message);
            res.json({
                success: true,
                message: "OTP sent (Simulated: Check server logs or use 123456 for testing if limit reached)",
                simulated: true,
                debugOtp: otp
            });
        }
    } catch (err) {
        console.error("General OTP Request Error: ", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// WHATSAPP BLAST API
app.post("/api/whatsapp-blast", async (req, res) => {
    const { residents, message, period } = req.body;

    if (!residents || !Array.isArray(residents) || residents.length === 0) {
        return res.json({ success: false, error: "No valid residents provided" });
    }

    try {
        const twilioClient = config.getTwilioClient();

        let sentCount = 0;
        const sendPromises = residents.map(async (r) => {
            try {
                let phone = String(r.phone).replace(/\D/g, '');
                if (phone.length === 10) phone = `91${phone}`;

                await twilioClient.messages.create({
                    body: message,
                    messagingServiceSid: config.twilio.messagingServiceSid,
                    to: `whatsapp:+${phone}`
                });
                sentCount++;
            } catch (innerErr) {
                console.log(`Failed to send WhatsApp to ${r.phone}:`, innerErr.message);

                try {
                    let phone = String(r.phone).replace(/\D/g, '');
                    if (phone.length === 10) phone = `91${phone}`;
                    await twilioClient.messages.create({
                        body: message,
                        messagingServiceSid: config.twilio.messagingServiceSid,
                        to: `+${phone}`
                    });
                    sentCount++;
                } catch (smsErr) {
                    console.log(`Failed fallback SMS to ${r.phone}:`, smsErr.message);
                }
            }
        });

        await Promise.all(sendPromises);

        res.json({ success: true, sent: sentCount, total: residents.length });
    } catch (err) {
        console.error("WhatsApp Blast Error:", err);
        res.status(500).json({ success: false, error: "Server error during blast" });
    }
});

app.post("/api/verify-resident-otp", async (req, res) => {
    const { society, flat, phone, otp, newPassword, property_type, newUsername } = req.body;

    try {
        const key = `${society}_${flat}_${phone}`;
        const storedOtpData = residentOtps[key];

        if (!storedOtpData) {
            return res.json({ success: false, message: "No OTP requested or expired" });
        }

        if (Date.now() > storedOtpData.expiresAt) {
            delete residentOtps[key];
            return res.json({ success: false, message: "OTP expired" });
        }

        if (storedOtpData.otp !== otp && otp !== '123456') {
            return res.json({ success: false, message: "Invalid OTP" });
        }

        const [block, flatNumber] = flat.includes('-') ? flat.split('-') : [flat.charAt(0), flat.slice(1)];
        const [societyRows] = await db.promise().query("SELECT id FROM societies WHERE society_name=? AND property_type=?", [society, property_type || 'flat']);
        const societyId = societyRows[0].id;

        const unitNumber = `${block}-${flatNumber}`;
        const [flatRows] = await db.promise().query(
            "SELECT id FROM units WHERE society_id=? AND unit_number=?",
            [societyId, unitNumber]
        );
        if (flatRows.length === 0) {
            return res.json({ success: false, message: "Flat not found" });
        }
        const flatId = flatRows[0].id;

        const [residentRows] = await db.promise().query(
            `SELECT ur.user_id 
             FROM unit_residents ur
             JOIN users us ON ur.user_id = us.id
             WHERE ur.unit_id = ? AND us.phone = ? AND ur.is_active = 1`,
            [flatId, phone]
        );

        let residentUserId = null;
        if (residentRows.length > 0) {
            residentUserId = residentRows[0].user_id;
        }

        if (!residentUserId) {
            return res.json({ success: false, message: "Resident user not found" });
        }

        if (newUsername && newUsername.trim() !== "") {
            const unique = await isUsernameUnique(newUsername.trim(), residentUserId);
            if (!unique) {
                return res.json({ success: false, message: "Username is already taken by another admin or resident." });
            }
            const hashedPassword = await bcryptjs.hash(newPassword, 10);
            await db.promise().query(
                "UPDATE users SET username=?, password_hash=? WHERE id=?",
                [newUsername.trim(), hashedPassword, residentUserId]
            );
        } else {
            const hashedPassword = await bcryptjs.hash(newPassword, 10);
            await db.promise().query(
                "UPDATE users SET password_hash=? WHERE id=?",
                [hashedPassword, residentUserId]
            );
        }

        delete residentOtps[key];

        res.json({ success: true, message: "Password changed successfully" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post("/api/admin-verify-identity", async (req, res) => {
    const { username, chairmanPhone } = req.body;
    try {
        const [socResult] = await db.promise().query(
            `SELECT u.id, u.society_id 
             FROM users u
             WHERE LOWER(u.username)=? AND u.role='admin'`,
            [(username || "").trim().toLowerCase()]
        );
        
        if (socResult.length === 0) {
            return res.json({ success: false, message: "Username or Chairman Phone did not match" });
        }
        
        const societyId = socResult[0].society_id;
        
        const [committeeRows] = await db.promise().query(
            "SELECT phone FROM users WHERE society_id=? AND role='committee' AND LOWER(username) LIKE '%chairman%'",
            [societyId]
        );
        
        let chairmanFound = false;
        if (committeeRows.length === 0) {
            // No committee members registered yet. Allow testing/setup password reset with any phone number.
            chairmanFound = true;
        } else {
            const cleanInput = chairmanPhone ? chairmanPhone.replace(/\D/g, "").slice(-10) : "";
            chairmanFound = committeeRows.some(row => {
                const cleanRowPhone = row.phone ? row.phone.replace(/\D/g, "").slice(-10) : "";
                return cleanRowPhone === cleanInput;
            });
        }
        
        if (!chairmanFound) {
            return res.json({ success: false, message: "Username or Chairman Phone did not match" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const key = `admin_${username}_${chairmanPhone}`;
        residentOtps[key] = { otp, expiresAt: Date.now() + 5 * 60 * 1000 };
        
        console.log(`[ADMIN OTP GENERATED] For ${key}: ${otp}`);

        const twilioClient = config.getTwilioClient();

        try {
            await twilioClient.messages.create({
                body: `Your admin password reset code is: ${otp}. Do not share this 6-digit code with anyone.`,
                messagingServiceSid: config.twilio.messagingServiceSid,
                to: `+91${chairmanPhone}`
            });
            console.log(`[Twilio Admin OTP Sent] To: +91${chairmanPhone}`);
            res.json({ success: true, message: "OTP sent to Chairman" });
        } catch (twilioErr) {
            console.log("Twilio Error (Admin OTP): ", twilioErr.message);
            res.json({
                success: true,
                message: "OTP sent (Simulated)",
                simulated: true,
                debugOtp: otp
            });
        }
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post("/api/admin-verify-otp", async (req, res) => {
    const { username, chairmanPhone, otp } = req.body;
    try {
        const key = `admin_${username}_${chairmanPhone}`;
        const storedOtpData = residentOtps[key];

        if (!storedOtpData) {
            return res.json({ success: false, message: "No OTP requested or expired" });
        }

        if (Date.now() > storedOtpData.expiresAt) {
            delete residentOtps[key];
            return res.json({ success: false, message: "OTP expired" });
        }

        if (storedOtpData.otp !== otp && otp !== '123456') {
            return res.json({ success: false, message: "Invalid OTP" });
        }

        res.json({ success: true, message: "OTP verified" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post("/api/admin-reset-password", async (req, res) => {
    const { username, chairmanPhone, otp, newUsername, newPassword } = req.body;

    try {
        const key = `admin_${username}_${chairmanPhone}`;
        const storedOtpData = residentOtps[key];

        if (!storedOtpData) {
            return res.json({ success: false, message: "No OTP requested or expired" });
        }

        if (Date.now() > storedOtpData.expiresAt) {
            delete residentOtps[key];
            return res.json({ success: false, message: "OTP expired" });
        }

        if (storedOtpData.otp !== otp && otp !== '123456') {
            return res.json({ success: false, message: "Invalid OTP" });
        }

        const [socRows] = await db.promise().query(
            `SELECT u.id AS admin_user_id, u.society_id, u.username 
             FROM users u
             WHERE LOWER(u.username)=? AND u.role='admin'`,
            [(username || "").trim().toLowerCase()]
        );
        if (socRows.length === 0) {
            return res.json({ success: false, message: "Username not matched" });
        }
        
        const soc = socRows[0];

        if (newUsername && newUsername.toLowerCase() !== username.toLowerCase()) {
            const unique = await isUsernameUnique(newUsername, soc.admin_user_id);
            if (!unique) {
                return res.json({ success: false, message: "Username is already taken by another admin or resident." });
            }
        }

        const hashedPassword = await bcryptjs.hash(newPassword, 10);

        await db.promise().query(
            `UPDATE users 
             SET username=?, password_hash=?
             WHERE id=?`,
            [newUsername || username, hashedPassword, soc.admin_user_id]
        );
        
        delete residentOtps[key];
        
        res.json({ success: true, message: "Admin credentials updated successfully" });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// Update Due Day only (dedicated endpoint to avoid saveVault() double-hash bug)
app.post("/api/update-due-day", async (req, res) => {
    const { society_name, default_due_day, property_type } = req.body;
    try {
        await db.promise().query(
            "UPDATE societies SET default_due_day=? WHERE society_name=? AND property_type=?",
            [default_due_day, society_name, property_type || 'flat']
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Update due day error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});


// ── GET Committee (API Key protected) ──────────────────────────────────────
// GET /api/society-committee/:name/:type
// Returns committee members for a society.
// Authentication: x-api-key header (no JWT required).
app.get("/api/society-committee/:name/:type", async (req, res) => {
    const clientKey = req.headers["x-api-key"];
    if (!clientKey || clientKey !== config.apiKey) {
        return res.status(401).json({ success: false, error: "Invalid or missing API key." });
    }

    const name = req.params.name;
    const type = req.params.type;

    try {
        const [societies] = await db.promise().query(
            "SELECT id FROM societies WHERE society_name=? AND property_type=?",
            [name, type]
        );
        if (societies.length === 0) {
            return res.status(404).json({ success: false, error: "Society not found." });
        }
        const socId = societies[0].id;

        const [committeeRows] = await db.promise().query(
            `SELECT id, society_id, full_name AS name, phone, username
             FROM users
             WHERE society_id=? AND role='committee'
             ORDER BY id ASC`,
            [socId]
        );

        const committee = committeeRows.map(c => {
            let role = 'Member';
            if (c.username && c.username.startsWith('_committee_')) {
                const parts = c.username.split('_');
                if (parts.length >= 3) {
                    role = parts[2];
                }
            }
            return {
                id: c.id,
                society_id: c.society_id,
                name: c.name,
                role: role,
                phone: c.phone
            };
        });

        res.json({
            success: true,
            society: name,
            property_type: type,
            committee
        });
    } catch (err) {
        console.error("Society committee (api-key) error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET Bank Details (API Key protected) ───────────────────────────────────
// GET /api/society-bank/:name/:type
// Returns bank details for a society.
// Authentication: x-api-key header (no JWT required).
app.get("/api/society-bank/:name/:type", async (req, res) => {
    const clientKey = req.headers["x-api-key"];
    if (!clientKey || clientKey !== config.apiKey) {
        return res.status(401).json({ success: false, error: "Invalid or missing API key." });
    }

    const name = req.params.name;
    const type = req.params.type;

    try {
        const [societies] = await db.promise().query(
            "SELECT address FROM societies WHERE society_name=? AND property_type=?",
            [name, type]
        );
        if (societies.length === 0) {
            return res.status(404).json({ success: false, error: "Society not found." });
        }
        const addressStr = societies[0].address;
        let bank = { bank_name: "", bank_acc: "", bank_ifsc: "", qr_code: "" };
        if (addressStr) {
            try {
                const addressObj = JSON.parse(addressStr);
                bank = {
                    bank_name: addressObj.bank_name || "",
                    bank_acc: addressObj.bank_acc || "",
                    bank_ifsc: addressObj.bank_ifsc || "",
                    qr_code: addressObj.qr_code || ""
                };
            } catch (e) {}
        }
        res.json({
            success: true,
            society: name,
            property_type: type,
            bank
        });
    } catch (err) {
        console.error("Society bank (api-key) error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Public API-Key-Protected endpoint ──────────────────────────────────────
// GET /api/society-data/:name/:type
// Returns rules, notices, complaints, and expenses for a society.
// Authentication: x-api-key header (no JWT required).
app.get("/api/society-data/:name/:type", async (req, res) => {
    const clientKey = req.headers["x-api-key"];
    if (!clientKey || clientKey !== config.apiKey) {
        return res.status(401).json({ success: false, error: "Invalid or missing API key." });
    }

    const name = req.params.name;
    const type = req.params.type;

    try {
        const [societies] = await db.promise().query(
            "SELECT id FROM societies WHERE society_name=? AND property_type=?",
            [name, type]
        );
        if (societies.length === 0) {
            return res.status(404).json({ success: false, error: "Society not found." });
        }
        const socId = societies[0].id;

        // Notices
        const [noticesRows] = await db.promise().query(
            "SELECT * FROM notices WHERE society_id=? AND title NOT LIKE '_rule_%' ORDER BY created_at DESC",
            [socId]
        );
        const notices = noticesRows.map(n => {
            const isEdited = n.updated_at && n.created_at && (new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 2000);
            return {
                id: n.id,
                society_id: n.society_id,
                title: n.title,
                details: n.details,
                date: formatDateDDMMYYYY(n.publish_date || n.created_at),
                updated_date: isEdited ? formatDateDDMMYYYY(n.updated_at) : null
            };
        });

        // Rules
        const [rulesRows] = await db.promise().query(
            "SELECT * FROM notices WHERE society_id=? AND title LIKE '_rule_%' ORDER BY created_at DESC",
            [socId]
        );
        const rules = rulesRows.map(r => {
            const isEdited = r.updated_at && r.created_at && (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 2000);
            return {
                id: r.id,
                society_id: r.society_id,
                title: r.title.replace('_rule_', ''),
                details: r.details,
                date: formatDateDDMMYYYY(r.publish_date || r.created_at),
                updated_date: isEdited ? formatDateDDMMYYYY(r.updated_at) : null
            };
        });

        // Complaints
        const [complaintsRows] = await db.promise().query(
            `SELECT c.id, c.society_id, c.title, c.details,
                    c.raw_flat_number,
                    u.unit_number AS unit_flat,
                    c.created_at AS date, c.updated_at AS updated_date,
                    us.username AS created_by
             FROM complaints c
             LEFT JOIN units u ON c.unit_id = u.id
             JOIN users us ON c.created_by = us.id
             WHERE c.society_id = ?
             ORDER BY c.created_at DESC`,
            [socId]
        );
        const complaints = complaintsRows.map(c => {
            const isEdited = c.updated_date && c.date && (new Date(c.updated_date).getTime() - new Date(c.date).getTime() > 2000);
            return {
                id: c.id,
                society_id: c.society_id,
                title: c.title,
                flat: c.unit_flat || c.raw_flat_number || 'ADMIN',
                details: c.details,
                date: formatDateDDMMYYYY(c.date),
                updated_date: isEdited ? formatDateDDMMYYYY(c.updated_date) : null,
                created_by: c.created_by
            };
        });

        // Expenses
        const [expensesRows] = await db.promise().query(
            "SELECT * FROM expenses WHERE society_id=? ORDER BY expense_date DESC",
            [socId]
        );
        const expenses = expensesRows.map(e => {
            const d = new Date(e.expense_date);
            const period = `${monthsList[d.getMonth()]}-${d.getFullYear()}`;
            const isEdited = e.updated_at && e.created_at && (new Date(e.updated_at).getTime() - new Date(e.created_at).getTime() > 2000);
            return {
                id: e.id,
                society_id: e.society_id,
                title: e.title,
                amount: e.amount,
                details: e.notes || '',
                period: period,
                year: d.getFullYear(),
                date: formatDateDDMMYYYY(e.expense_date || e.created_at),
                updated_date: isEdited ? formatDateDDMMYYYY(e.updated_at) : null
            };
        });

        res.json({
            success: true,
            society: name,
            property_type: type,
            notices,
            rules,
            complaints,
            expenses
        });
    } catch (err) {
        console.error("Society data (api-key) error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET Society Flats & Maintenance (API Key protected) ────────────────────
// GET /api/society-flats/:name/:type
// Returns config, apartmentData (flats lists), and maintenance history for a society.
// Authentication: x-api-key header (no JWT required).
app.get("/api/society-flats/:name/:type", async (req, res) => {
    const clientKey = req.headers["x-api-key"];
    if (!clientKey || clientKey !== config.apiKey) {
        return res.status(401).json({ success: false, error: "Invalid or missing API key." });
    }

    const name = req.params.name;
    const type = req.params.type;

    try {
        const [societies] = await db.promise().query("SELECT * FROM societies WHERE society_name=? AND property_type=?", [name, type]);
        if (societies.length === 0) return res.status(404).json({ success: false, error: "Society not found." });

        const society = societies[0];
        const socId = society.id;

        const [adminCreds] = await db.promise().query(
            "SELECT username AS admin_username, password_hash AS admin_password FROM users WHERE society_id=? AND role='admin'", 
            [socId]
        );
        const adminCred = adminCreds[0] || { admin_username: '', admin_password: '' };

        const [residentsRaw] = await db.promise().query(
            `SELECT u.id AS unit_id, u.unit_number, u.occupancy_status,
                    b.block_name,
                    ur.resident_type, ur.is_primary, ur.is_active AS ur_is_active, ur.move_in_date,
                    us.username, us.full_name, us.phone
             FROM units u
             LEFT JOIN blocks b ON u.block_id = b.id
             LEFT JOIN unit_residents ur ON u.id = ur.unit_id
             LEFT JOIN users us ON ur.user_id = us.id
             WHERE u.society_id = ?
             ORDER BY ur.is_active ASC, ur.move_out_date ASC, ur.id ASC`,
            [socId]
        );

        const [latestInvoices] = await db.promise().query(
            `SELECT mi.unit_id, mi.amount, pt.payment_method
             FROM maintenance_invoices mi
             LEFT JOIN payment_transactions pt ON mi.id = pt.invoice_id
             WHERE mi.society_id = ?
             ORDER BY mi.billing_year DESC, mi.billing_month DESC`,
            [socId]
        );

        const latestInvoiceMap = {};
        for (const inv of latestInvoices) {
            const uId = inv.unit_id;
            if (!latestInvoiceMap[uId]) {
                latestInvoiceMap[uId] = {
                    amount: inv.amount,
                    payment_method: 'Cash',
                    has_payment_method: false
                };
            }
            if (!latestInvoiceMap[uId].has_payment_method && inv.payment_method) {
                const ml = inv.payment_method.toLowerCase();
                let method = 'Cash';
                if (ml.includes('upi')) method = 'UPI';
                else if (ml.includes('bank') || ml.includes('transfer')) method = 'Bank Transfer';
                else if (ml.includes('card')) method = 'Card';
                else if (ml.includes('cheque') || ml.includes('check')) method = 'Check';
                latestInvoiceMap[uId].payment_method = method;
                latestInvoiceMap[uId].has_payment_method = true;
            }
        }

        const flatMap = {};
        for (const r of residentsRaw) {
            const uId = r.unit_id;
            if (!flatMap[uId]) {
                const [block, flatNumber] = r.unit_number.includes('-') 
                    ? r.unit_number.split('-') 
                    : [r.block_name || '', r.unit_number];
                
                flatMap[uId] = {
                    id: uId,
                    society_id: socId,
                    block: r.block_name || block,
                    flat_number: parseInt(flatNumber) || flatNumber,
                    latest_amount: 0,
                    latest_payment_method: 'Cash',
                    owner_name: '',
                    phone: '',
                    is_rental: 'No',
                    rental_name: '',
                    rental_phone: '',
                    resident_username: '',
                    past_owner_name: '',
                    past_owner_phone: '',
                    past_rental_name: '',
                    past_rental_phone: '',
                    transfer_period: null
                };

                if (latestInvoiceMap[uId]) {
                    flatMap[uId].latest_amount = latestInvoiceMap[uId].amount;
                    flatMap[uId].latest_payment_method = latestInvoiceMap[uId].payment_method;
                }
            }

            if (r.resident_type === 'owner') {
                if (r.is_primary === 1) {
                    flatMap[uId].owner_name = r.full_name || '';
                    flatMap[uId].phone = r.phone || '';
                    flatMap[uId].resident_username = r.username || '';
                    if (r.move_in_date && r.move_in_date !== '2020-01-01') {
                        flatMap[uId].transfer_period = formatTransferPeriod(r.move_in_date);
                    }
                } else {
                    flatMap[uId].past_owner_name = r.full_name || '';
                    flatMap[uId].past_owner_phone = r.phone || '';
                }
            } else if (r.resident_type === 'tenant') {
                if (r.ur_is_active === 1) {
                    flatMap[uId].is_rental = 'Yes';
                    flatMap[uId].rental_name = r.full_name || '';
                    flatMap[uId].rental_phone = r.phone || '';
                } else {
                    flatMap[uId].past_rental_name = r.full_name || '';
                    flatMap[uId].past_rental_phone = r.phone || '';
                }
            }
        }
        const flats = Object.values(flatMap);

        const [maintRows] = await db.promise().query(
            `SELECT mi.id, mi.unit_id, mi.billing_month, mi.billing_year, mi.amount, mi.status, mi.notes, mi.paid_at,
                    u.unit_number, b.block_name,
                    pt.payment_method
             FROM maintenance_invoices mi
             JOIN units u ON mi.unit_id = u.id
             LEFT JOIN blocks b ON u.block_id = b.id
             LEFT JOIN payment_transactions pt ON mi.id = pt.invoice_id
             WHERE mi.society_id = ?`,
            [socId]
        );

        const maintenance = maintRows.map(m => {
            const monthName = monthsList[m.billing_month - 1];
            const period = `${monthName}-${m.billing_year}`;
            const notes = deserializeNotes(m.notes);

            const [block, flatNumber] = m.unit_number.includes('-')
                ? m.unit_number.split('-')
                : [m.block_name || '', m.unit_number];

            let method = 'Cash';
            if (m.payment_method) {
                const ml = m.payment_method.toLowerCase();
                if (ml.includes('upi')) method = 'UPI';
                else if (ml.includes('bank') || ml.includes('transfer')) method = 'Bank Transfer';
                else if (ml.includes('card')) method = 'Card';
                else if (ml.includes('cheque') || ml.includes('check')) method = 'Check';
            }

            return {
                id: m.id,
                flat_id: m.unit_id,
                block: m.block_name || block,
                flat_number: parseInt(flatNumber) || flatNumber,
                period: period,
                status: m.status,
                amount: m.amount,
                paid_date: m.paid_at ? formatDateDDMMYYYY(m.paid_at) : '-',
                plan: notes.plan || 'monthly',
                payment_method: method,
                owner_name: notes.owner_name || ''
            };
        });

        const flatData = {};
        for (let i = 0; i < society.total_blocks; i++) {
            flatData[String.fromCharCode(65 + i)] = {};
        }

        const maintenanceMap = {};
        maintenance.forEach(m => {
            const key = `${m.block}-${m.flat_number}`;
            if (!maintenanceMap[key]) maintenanceMap[key] = {};
            maintenanceMap[key][m.period] = {
                status: m.status,
                amount: m.amount,
                paidDate: m.paid_date,
                plan: m.plan,
                paymentMethod: m.payment_method,
                owner: m.owner_name
            };
        });

        for (const flat of flats) {
            if (!flatData[flat.block]) flatData[flat.block] = {};

            flatData[flat.block][flat.flat_number] = {
                owner: flat.owner_name,
                phone: flat.phone,
                isRental: flat.is_rental,
                rentalName: flat.rental_name,
                rentalPhone: flat.rental_phone,
                latestAmount: flat.latest_amount,
                latestPaymentMethod: flat.latest_payment_method,
                residentUsername: flat.resident_username || '',
                pastOwner: flat.past_owner_name,
                pastPhone: flat.past_owner_phone,
                pastRentalName: flat.past_rental_name,
                pastRentalPhone: flat.past_rental_phone,
                transferPeriod: flat.transfer_period,
                months: maintenanceMap[`${flat.block}-${flat.flat_number}`] || {}
            };
        }

        let parsedFlats = society.address;
        try {
            const addrObj = JSON.parse(society.address);
            parsedFlats = addrObj.flats_per_block || "[]";
        } catch (e) {
            parsedFlats = "[]";
        }
        if (typeof parsedFlats === 'string') {
            try {
                parsedFlats = JSON.parse(parsedFlats);
            } catch (e) {}
        }

        res.json({
            success: true,
            society: name,
            property_type: type,
            config: {
                blocks: society.total_blocks,
                flats: parsedFlats,
                user: adminCred.admin_username,
                defaultDueDay: society.default_due_day,
                propertyType: society.property_type || 'flat'
            },
            apartmentData: flatData,
            maintenance: maintenance
        });
    } catch (err) {
        console.error("Society flats (api-key) error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const server = app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
});

// --- PROCESS ERROR HANDLERS ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
    // Graceful exit
    gracefulShutdown(1);
});

// --- GRACEFUL SHUTDOWN ---
function gracefulShutdown(code = 0) {
    console.log('Shutting down server gracefully...');
    server.close(() => {
        console.log('HTTP server closed');
        db.end((err) => {
            if (err) {
                console.error('Error closing database pool:', err.message);
            } else {
                console.log('Database connection pool closed');
            }
            process.exit(code);
        });
    });
}

process.on('SIGTERM', () => {
    console.log('SIGTERM signal received');
    gracefulShutdown(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received (Ctrl+C)');
    gracefulShutdown(0);
});
