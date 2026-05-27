const mysql = require("../pg-adapter");
const config = require("../config");
const fs = require("fs");
const path = require("path");

const db = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database
});

const loadSchemaFromFile = async () => {
    const schemaPath = path.join(__dirname, "..", "..", "database", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");
    try {
        await db.promise().query(sql);
    } catch (err) {
        // If it's a relation/trigger/function already exists error, ignore it
        if (!err.message.includes('already exists') && !err.message.includes('already a relation')) {
            console.error("Error executing schema SQL:", err.message);
            throw err;
        }
    }
};

async function test() {
    try {
        console.log("Testing PG Adapter...");
        
        // 1. Check tables (should compile and return something)
        const [tablesBefore] = await db.promise().query("SHOW TABLES");
        console.log("SHOW TABLES before schema import:", tablesBefore.map(r => Object.values(r)[0]));

        // 2. Load schema
        console.log("Loading schema from file...");
        await loadSchemaFromFile();
        console.log("Schema loaded successfully!");

        // 3. Show tables after schema import
        const [tablesAfter] = await db.promise().query("SHOW TABLES");
        console.log("SHOW TABLES after schema import:", tablesAfter.map(r => Object.values(r)[0]));

        // 4. Test insert
        console.log("Testing Insert...");
        const [insertResult] = await db.promise().query(
            "INSERT INTO societies (society_name, property_type, total_blocks) VALUES (?, ?, ?)",
            ["Test PG Society " + Date.now(), "mixed", 5]
        );
        console.log("Insert result OkPacket:", insertResult);
        const societyId = insertResult.insertId;
        console.log("Retrieved society ID:", societyId);

        // 5. Test Select with placeholder
        console.log("Testing Select...");
        const [rows] = await db.promise().query(
            "SELECT * FROM societies WHERE id = ?",
            [societyId]
        );
        console.log("Select result rows:", rows);

        // 6. Test callback interface
        console.log("Testing Callback style query...");
        db.query("DELETE FROM societies WHERE id = ?", [societyId], (err, result) => {
            if (err) {
                console.error("Callback delete failed:", err);
                process.exit(1);
            }
            console.log("Callback delete result OkPacket:", result);
            console.log("All tests passed successfully!");
            db.end(() => {
                console.log("DB Pool closed.");
                process.exit(0);
            });
        });

    } catch (err) {
        console.error("Test failed:", err);
        process.exit(1);
    }
}

test();
