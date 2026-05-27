const jwt = require('jsonwebtoken');
const config = require('../config');
const mysql = require('mysql2');

const tokenPayload = { username: 'Yaksh', role: 'admin', society_id: 1 };
const token = jwt.sign(tokenPayload, config.jwtSecret, { expiresIn: '24h' });

const flatData = {
    society_name: 'Park Avenue test',
    block: 'A',
    flat_number: '5',
    owner: 'CHAMPAKLAL',
    phone: '9876543210',
    isRental: 'No',
    rentalName: '',
    rentalPhone: '',
    amount: '2000.00',
    period: 'May-2026',
    status: 'Paid',
    plan: 'monthly',
    paymentMethod: 'Bank Transfer',
    dateStr: '25-05-2026',
    property_type: 'flat'
};

async function run() {
    try {
        console.log("Sending POST /api/flat request...");
        const response = await fetch('http://localhost:5000/api/flat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(flatData)
        });
        const data = await response.json();
        console.log("API Response:", data);

        // Connect to database to inspect
        const db = mysql.createConnection({
            host: config.db.host,
            user: config.db.user,
            password: config.db.password,
            database: config.db.database
        }).promise();

        const [txs] = await db.query(
            `SELECT mi.id, mi.status, pt.payment_method 
             FROM maintenance_invoices mi
             LEFT JOIN payment_transactions pt ON mi.id = pt.invoice_id
             WHERE mi.unit_id = 13 AND mi.billing_month = 5 AND mi.billing_year = 2026`
        );
        console.log("Resulting Database Records for Unit 13 (A-5), May-2026:", txs);
        db.end();
    } catch (e) {
        console.error("Error during test:", e);
    }
}

run();
