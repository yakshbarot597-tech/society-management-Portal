const mysql = require('mysql2');
const config = require('../config');

const connection = mysql.createConnection({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database
});

connection.query('SELECT * FROM payment_transactions LIMIT 10', (err, results) => {
    if (err) {
        console.error("Error fetching transactions:", err);
    } else {
        console.log("Payment Transactions:", results);
    }
    connection.query('SELECT id, status, notes, paid_at FROM maintenance_invoices LIMIT 10', (err2, results2) => {
        if (err2) {
            console.error("Error fetching invoices:", err2);
        } else {
            console.log("Maintenance Invoices:", results2);
        }
        connection.end();
    });
});
