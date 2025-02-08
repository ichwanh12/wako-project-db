const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');
const { generateInvoicePDF } = require('../utils/pdf');

// Generate sequence number
async function generateSequenceNumber(sequenceId, prefix) {
    const [result] = await db.execute(
        'UPDATE sequence_numbers SET last_number = last_number + 1 WHERE id = ?',
        [sequenceId]
    );
    
    const [rows] = await db.execute(
        'SELECT last_number FROM sequence_numbers WHERE id = ?',
        [sequenceId]
    );
    
    const number = rows[0].last_number;
    const paddedNumber = number.toString().padStart(4, '0');
    return `${prefix}${paddedNumber}`;
}

// Generate PO number
async function generatePONumber() {
    return generateSequenceNumber('po_number', 'PO');
}

// Generate invoice number
async function generateInvoiceNumber() {
    return generateSequenceNumber('invoice_number', 'INV');
}

// Get all transactions
router.get('/', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT 
                po.po_number,
                po.date,
                c.company_name,
                c.contact_name,
                c.phone,
                po.invoice_number,
                po.invoice_date,
                ti.item_name,
                ti.unit_price,
                ti.quantity,
                ti.total_price,
                ti.consignment_name,
                ti.consignment_qty
            FROM purchase_orders po
            JOIN customers c ON po.customer_id = c.id
            LEFT JOIN transaction_items ti ON po.id = ti.po_id
            ORDER BY po.date DESC, po.id DESC
        `);

        // Group items by PO number
        const transactions = {};
        rows.forEach(row => {
            if (!transactions[row.po_number]) {
                transactions[row.po_number] = {
                    po_number: row.po_number,
                    date: row.date,
                    company_name: row.company_name,
                    contact_name: row.contact_name,
                    phone: row.phone,
                    invoice_number: row.invoice_number,
                    invoice_date: row.invoice_date,
                    items: []
                };
            }

            if (row.item_name) {
                transactions[row.po_number].items.push({
                    item_name: row.item_name,
                    unit_price: row.unit_price,
                    quantity: row.quantity,
                    total_price: row.total_price,
                    consignment_name: row.consignment_name,
                    consignment_qty: row.consignment_qty
                });
            }
        });

        res.json(Object.values(transactions));
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Create new transaction
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { customer_id, items } = req.body;

        if (!customer_id) {
            return res.status(400).json({ error: 'Customer ID is required' });
        }

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'At least one item is required' });
        }

        await db.beginTransaction();

        // Generate PO number
        const po_number = await generatePONumber();

        // Insert purchase order
        const [poResult] = await db.execute(
            'INSERT INTO purchase_orders (po_number, customer_id) VALUES (?, ?)',
            [po_number, customer_id]
        );

        const po_id = poResult.insertId;

        // Insert items
        for (const item of items) {
            const total_price = item.quantity * item.unit_price;
            await db.execute(
                `INSERT INTO transaction_items 
                (po_id, item_name, unit_price, quantity, total_price, consignment_name, consignment_qty) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    po_id,
                    item.item_name,
                    item.unit_price,
                    item.quantity,
                    total_price,
                    item.consignment_name || null,
                    item.consignment_qty || null
                ]
            );
        }

        await db.commit();
        res.json({ po_number });
    } catch (error) {
        await db.rollback();
        console.error('Error creating transaction:', error);
        res.status(500).json({ error: 'Failed to create transaction' });
    }
});

// Generate invoice
router.post('/:poNumber/invoice', authenticateToken, async (req, res) => {
    try {
        const poNumber = req.params.poNumber;

        // Check if invoice already exists
        const [existing] = await db.execute(
            'SELECT invoice_number FROM purchase_orders WHERE po_number = ?',
            [poNumber]
        );

        if (existing[0].invoice_number) {
            return res.status(400).json({ error: 'Invoice already exists' });
        }

        // Generate invoice number
        const invoice_number = await generateInvoiceNumber();

        // Update purchase order with invoice details
        await db.execute(
            'UPDATE purchase_orders SET invoice_number = ?, invoice_date = CURRENT_TIMESTAMP WHERE po_number = ?',
            [invoice_number, poNumber]
        );

        res.json({ invoice_number });
    } catch (error) {
        console.error('Error generating invoice:', error);
        res.status(500).json({ error: 'Failed to generate invoice' });
    }
});

// Download invoice PDF
router.get('/:poNumber/invoice/download', authenticateToken, async (req, res) => {
    try {
        const poNumber = req.params.poNumber;

        // Get transaction data
        const [rows] = await db.execute(`
            SELECT 
                po.po_number,
                po.date,
                c.company_name,
                c.contact_name,
                c.phone,
                po.invoice_number,
                po.invoice_date,
                ti.item_name,
                ti.unit_price,
                ti.quantity,
                ti.total_price,
                ti.consignment_name,
                ti.consignment_qty
            FROM purchase_orders po
            JOIN customers c ON po.customer_id = c.id
            LEFT JOIN transaction_items ti ON po.id = ti.po_id
            WHERE po.po_number = ?
        `, [poNumber]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        if (!rows[0].invoice_number) {
            return res.status(400).json({ error: 'Invoice not generated yet' });
        }

        // Create transaction object
        const transaction = {
            po_number: rows[0].po_number,
            date: rows[0].date,
            company_name: rows[0].company_name,
            contact_name: rows[0].contact_name,
            phone: rows[0].phone,
            invoice_number: rows[0].invoice_number,
            invoice_date: rows[0].invoice_date,
            items: rows.map(row => ({
                item_name: row.item_name,
                unit_price: row.unit_price,
                quantity: row.quantity,
                total_price: row.total_price,
                consignment_name: row.consignment_name,
                consignment_qty: row.consignment_qty
            }))
        };

        // Generate PDF
        const pdf = await generateInvoicePDF(transaction);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${transaction.invoice_number}.pdf`);
        pdf.pipe(res);
        pdf.end();
    } catch (error) {
        console.error('Error generating invoice PDF:', error);
        res.status(500).json({ error: 'Failed to generate invoice PDF' });
    }
});

module.exports = router;
