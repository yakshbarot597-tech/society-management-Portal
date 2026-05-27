const mysql = require('mysql2');
const config = require('../config');

const db = mysql.createConnection({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database
}).promise();

async function run() {
    try {
        const [users] = await db.query("SELECT username, role, society_id FROM users WHERE role='admin' LIMIT 1");
        console.log("Admin User:", users);
        if (users.length > 0) {
            const [society] = await db.query("SELECT society_name, property_type FROM societies WHERE id = ?", [users[0].society_id]);
            console.log("Society:", society);
        }
    } catch (e) {
        console.error(e);
    } finally {
        db.end();
    }
}

run();
