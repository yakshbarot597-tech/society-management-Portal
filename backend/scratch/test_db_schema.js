const mysql = require('mysql2');
const config = require('../config');

const connection = mysql.createConnection({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database
});

connection.query("SHOW COLUMNS FROM payment_transactions LIKE 'payment_method'", (err, results) => {
    if (err) {
        console.error("Error fetching column info:", err);
    } else {
        console.log("Column Info:", results);
    }
    connection.end();
});
