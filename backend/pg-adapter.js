const { Pool, Client } = require('pg');

// Adjust pg types to align with mysql2 expectations:
// 1. Parse NUMERIC / DECIMAL as float instead of string
const pg = require('pg');
pg.types.setTypeParser(1700, function(val) {
    return val === null ? null : parseFloat(val);
});
// 2. Parse BIGINT (int8) as integer (since JS numbers support up to 9 quadrillion)
pg.types.setTypeParser(20, function(val) {
    return val === null ? null : parseInt(val, 10);
});

/**
 * Translates MySQL queries to PostgreSQL.
 * - Converts ? placeholders to $1, $2, ...
 * - Converts backticks to double quotes.
 * - Overrides MySQL SHOW TABLES and metadata queries.
 * - Converts RENAME TABLE to ALTER TABLE ... RENAME TO.
 * - Appends RETURNING id to INSERT statements to fetch generated primary keys.
 */
function convertQuery(sql, params = []) {
    let cleanSql = sql;

    // 1. SHOW TABLES
    if (/^\s*show\s+tables/i.test(cleanSql)) {
        return {
            pgSql: "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';",
            pgParams: []
        };
    }

    // 2. DATABASE() to 'public' schema comparison (e.g. INFORMATION_SCHEMA.COLUMNS queries)
    cleanSql = cleanSql.replace(/TABLE_SCHEMA\s*=\s*DATABASE\(\)/gi, "TABLE_SCHEMA = 'public'");

    // 3. RENAME TABLE old_table TO new_table
    if (/^\s*rename\s+table\s+/i.test(cleanSql)) {
        cleanSql = cleanSql.replace(/^\s*rename\s+table\s+(\w+)\s+to\s+(\w+)/i, "ALTER TABLE $1 RENAME TO $2");
    }

    // 4. Convert backticks and ? placeholders
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let finalSql = '';
    let paramCount = 0;

    for (let i = 0; i < cleanSql.length; i++) {
        const char = cleanSql[i];
        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            finalSql += char;
        } else if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            finalSql += char;
        } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
            finalSql += '"';
        } else if (char === '?' && !inSingleQuote && !inDoubleQuote) {
            paramCount++;
            finalSql += `$${paramCount}`;
        } else {
            finalSql += char;
        }
    }

    // 5. Append RETURNING id to INSERT statements
    const isInsert = /^\s*insert\s+into/i.test(finalSql);
    if (isInsert && !/returning/i.test(finalSql)) {
        let trimmed = finalSql.trim();
        if (trimmed.endsWith(';')) {
            finalSql = trimmed.slice(0, -1) + ' RETURNING id;';
        } else {
            finalSql = trimmed + ' RETURNING id';
        }
    }

    return {
        pgSql: finalSql,
        pgParams: params
    };
}

class PgConnectionWrapper {
    constructor(client) {
        this.client = client;
    }

    query(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        const { pgSql, pgParams } = convertQuery(sql, params);

        this.client.query(pgSql, pgParams, (err, res) => {
            if (err) {
                if (callback) callback(err);
                return;
            }

            const isWrite = ['INSERT', 'UPDATE', 'DELETE'].includes(res.command);
            if (isWrite) {
                let insertId = 0;
                if (res.command === 'INSERT' && res.rows && res.rows[0]) {
                    insertId = parseInt(res.rows[0].id) || 0;
                }
                const okPacket = {
                    affectedRows: res.rowCount,
                    insertId: insertId,
                    warningStatus: 0
                };
                if (callback) callback(null, okPacket, res.fields);
            } else {
                if (callback) callback(null, res.rows, res.fields);
            }
        });
    }

    release() {
        if (typeof this.client.release === 'function') {
            this.client.release();
        }
    }
}

class PgPoolWrapper {
    constructor(config) {
        this.config = {
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            max: config.connectionLimit || 10,
            ssl: config.ssl
        };
        this.pool = null;
        this.ensured = false;
        this.ensuringPromise = null;
    }

    async ensureDatabase() {
        if (this.ensured) return;
        if (this.ensuringPromise) return this.ensuringPromise;

        this.ensuringPromise = (async () => {
            const connectionString = process.env.DATABASE_URL;

            if (connectionString) {
                // Production environment (Render, etc.) - connect using connection string directly
                console.log("[PG Adapter] Connecting via DATABASE_URL connection string...");
                const pgConfig = {
                    connectionString: connectionString,
                    max: this.config.max,
                    ssl: {
                        rejectUnauthorized: false
                    }
                };
                this.pool = new Pool(pgConfig);
                this.ensured = true;
            } else {
                // Local development setup - check/create database
                const clientConfig = { ...this.config, database: 'postgres' };
                const client = new Client(clientConfig);
                try {
                    await client.connect();
                    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [this.config.database]);
                    if (res.rowCount === 0) {
                        console.log(`[PG Adapter] Database "${this.config.database}" does not exist. Creating...`);
                        const dbNameEscaped = '"' + this.config.database.replace(/"/g, '""') + '"';
                        await client.query(`CREATE DATABASE ${dbNameEscaped}`);
                        console.log(`[PG Adapter] Database "${this.config.database}" created successfully.`);
                    }
                } catch (err) {
                    console.warn(`[PG Adapter] Database exist check warning: ${err.message}`);
                } finally {
                    try {
                        await client.end();
                    } catch (e) {}
                }

                // Create actual connection pool
                this.pool = new Pool(this.config);
                this.ensured = true;
            }

            // Register pool event listeners for both local and production
            this.pool.on("connect", () => {
                console.log("PostgreSQL connected successfully");
            });
            this.pool.on("error", (err) => {
                console.error("PostgreSQL pool error:", err.message);
            });
        })();

        return this.ensuringPromise;
    }

    getConnection(callback) {
        this.ensureDatabase().then(() => {
            this.pool.connect((err, client, release) => {
                if (err) {
                    callback(err);
                    return;
                }
                client.release = release;
                callback(null, new PgConnectionWrapper(client));
            });
        }).catch(err => {
            callback(err);
        });
    }

    query(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }

        this.ensureDatabase().then(() => {
            const { pgSql, pgParams } = convertQuery(sql, params);
            this.pool.query(pgSql, pgParams, (err, res) => {
                if (err) {
                    if (callback) callback(err);
                    return;
                }

                const isWrite = ['INSERT', 'UPDATE', 'DELETE'].includes(res.command);
                if (isWrite) {
                    let insertId = 0;
                    if (res.command === 'INSERT' && res.rows && res.rows[0]) {
                        insertId = parseInt(res.rows[0].id) || 0;
                    }
                    const okPacket = {
                        affectedRows: res.rowCount,
                        insertId: insertId,
                        warningStatus: 0
                    };
                    if (callback) callback(null, okPacket, res.fields);
                } else {
                    if (callback) callback(null, res.rows, res.fields);
                }
            });
        }).catch(err => {
            if (callback) callback(err);
        });
    }

    end(callback) {
        if (this.pool) {
            this.pool.end(callback);
        } else if (callback) {
            callback();
        }
    }

    promise() {
        const self = this;
        return {
            query: async (sql, params = []) => {
                await self.ensureDatabase();
                const { pgSql, pgParams } = convertQuery(sql, params);
                try {
                    const res = await self.pool.query(pgSql, pgParams);
                    const isWrite = ['INSERT', 'UPDATE', 'DELETE'].includes(res.command);
                    if (isWrite) {
                        let insertId = 0;
                        if (res.command === 'INSERT' && res.rows && res.rows[0]) {
                            insertId = parseInt(res.rows[0].id) || 0;
                        }
                        const okPacket = {
                            affectedRows: res.rowCount,
                            insertId: insertId,
                            warningStatus: 0
                        };
                        return [okPacket, res.fields];
                    }
                    return [res.rows, res.fields];
                } catch (err) {
                    console.error("[PG Adapter] SQL Error executing query:", sql, "->", err.message);
                    throw err;
                }
            },
            getConnection: async () => {
                await self.ensureDatabase();
                const client = await self.pool.connect();
                return {
                    query: async (sql, params = []) => {
                        const { pgSql, pgParams } = convertQuery(sql, params);
                        const res = await client.query(pgSql, pgParams);
                        const isWrite = ['INSERT', 'UPDATE', 'DELETE'].includes(res.command);
                        if (isWrite) {
                            let insertId = 0;
                            if (res.command === 'INSERT' && res.rows && res.rows[0]) {
                                insertId = parseInt(res.rows[0].id) || 0;
                            }
                            const okPacket = {
                                affectedRows: res.rowCount,
                                insertId: insertId,
                                warningStatus: 0
                            };
                            return [okPacket, res.fields];
                        }
                        return [res.rows, res.fields];
                    },
                    release: () => {
                        client.release();
                    }
                };
            }
        };
    }
}

module.exports = {
    createPool: function(config) {
        return new PgPoolWrapper(config);
    }
};
