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
        // Find a paid invoice
        const [invoices] = await db.query("SELECT id, society_id FROM maintenance_invoices WHERE status = 'Paid' LIMIT 1");
        if (invoices.length === 0) {
            console.log("No paid invoices found to test.");
            db.end();
            return;
        }
        const invoiceId = invoices[0].id;
        const socId = invoices[0].society_id;

        // Set payment transaction to 'bank_transfer'
        await db.query("DELETE FROM payment_transactions WHERE invoice_id = ?", [invoiceId]);
        await db.query(
            `INSERT INTO payment_transactions (invoice_id, payment_method, amount, status, paid_at)
             VALUES (?, 'bank_transfer', 1500, 'Success', NOW())`,
            [invoiceId]
        );

        // Fetch using the exact backend query in server.js
        const [maintRows] = await db.query(
            `SELECT mi.id, mi.unit_id, mi.billing_month, mi.billing_year, mi.amount, mi.status, mi.notes, mi.paid_at,
                     u.unit_number, b.block_name,
                     pt.payment_method
              FROM maintenance_invoices mi
              JOIN units u ON mi.unit_id = u.id
              LEFT JOIN blocks b ON u.block_id = b.id
              LEFT JOIN payment_transactions pt ON mi.id = pt.invoice_id
              WHERE mi.id = ?`,
            [invoiceId]
        );

        const m = maintRows[0];
        const monthsList = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthName = monthsList[m.billing_month - 1];
        const period = `${monthName}-${m.billing_year}`;

        let method = 'Cash';
        if (m.payment_method) {
            const ml = m.payment_method.toLowerCase();
            if (ml.includes('upi')) method = 'UPI';
            else if (ml.includes('bank') || ml.includes('transfer')) method = 'Bank Transfer';
            else if (ml.includes('card')) method = 'Card';
            else if (ml.includes('cheque') || ml.includes('check')) method = 'Check';
        }

        const mappedM = {
            id: m.id,
            flat_id: m.unit_id,
            period: period,
            status: m.status,
            amount: m.amount,
            payment_method: method
        };

        console.log("Original row from database:", m);
        console.log("Mapped maintenance item:", mappedM);

        const maintenanceMap = {};
        const key = 'test-flat';
        maintenanceMap[key] = {};
        maintenanceMap[key][mappedM.period] = {
            status: mappedM.status,
            amount: mappedM.amount,
            paymentMethod: mappedM.payment_method
        };

        console.log("Value inside maintenanceMap:", maintenanceMap[key][mappedM.period]);
    } catch (e) {
        console.error(e);
    } finally {
        db.end();
    }
}

run();
