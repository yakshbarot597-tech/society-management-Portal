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
        const [counts] = await db.query(
            "SELECT payment_method, COUNT(*) as count FROM payment_transactions GROUP BY payment_method"
        );
        console.log("Transaction counts by payment method:", counts);
    } catch (e) {
        console.error(e);
    } finally {
        db.end();
    }
}

run();
