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
        const paymentMethod = 'Bank Transfer';
        let method = 'cash';
        if (paymentMethod) {
            const mLower = paymentMethod.toLowerCase();
            if (mLower.includes('upi')) method = 'upi';
            else if (mLower.includes('bank') || mLower.includes('transfer')) method = 'bank_transfer';
            else if (mLower.includes('card')) method = 'card';
            else if (mLower.includes('cheque') || mLower.includes('check')) method = 'cheque';
        }
        console.log("Input:", paymentMethod);
        console.log("Mapped internal method name:", method);

        // Let's query one of the existing invoice ids to see if we can do a mock update/insert
        const [invoices] = await db.query("SELECT id FROM maintenance_invoices LIMIT 1");
        if (invoices.length > 0) {
            const invoiceId = invoices[0].id;
            console.log("Mocking for invoice ID:", invoiceId);
            await db.query("DELETE FROM payment_transactions WHERE invoice_id = ?", [invoiceId]);
            await db.query(
                `INSERT INTO payment_transactions (invoice_id, payment_method, amount, status, paid_at)
                 VALUES (?, ?, ?, 'Success', ?)`,
                [invoiceId, method, 100, new Date()]
            );
            console.log("Successfully inserted transaction!");
            const [txs] = await db.query("SELECT * FROM payment_transactions WHERE invoice_id = ?", [invoiceId]);
            console.log("Saved payment transaction:", txs);
        }
    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        db.end();
    }
}

run();
