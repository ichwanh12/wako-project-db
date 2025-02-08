const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let db;

// Database connection
async function initializeDatabase() {
    try {
        console.log('Connecting to database...');
        // Use Railway's MySQL URL if available, otherwise use local
        const dbUrl = process.env.MYSQL_URL || 'mysql://root:@localhost/wako_db';
        db = await mysql.createConnection(dbUrl);
        console.log('Connected to MySQL database');

        // Create tables if not exist
        await db.execute(`
            CREATE TABLE IF NOT EXISTS sequence_numbers (
                id VARCHAR(50) PRIMARY KEY,
                last_number INT NOT NULL DEFAULT 0
            )
        `);

        // Insert initial sequence if not exists
        await db.execute(`
            INSERT IGNORE INTO sequence_numbers (id, last_number) 
            VALUES ('po_number', 0), ('invoice_number', 0)
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                password VARCHAR(100) NOT NULL,
                email VARCHAR(100)
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchase_orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                po_number VARCHAR(50) NOT NULL UNIQUE,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                customer_name VARCHAR(100) NOT NULL,
                invoice_number VARCHAR(50) UNIQUE,
                invoice_date TIMESTAMP NULL
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS transaction_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                po_id INT NOT NULL,
                item_name VARCHAR(100) NOT NULL,
                unit_price DECIMAL(10, 2) NOT NULL,
                quantity INT NOT NULL,
                total_price DECIMAL(10, 2) NOT NULL,
                consignment_name VARCHAR(100),
                consignment_qty INT,
                consignment_price DECIMAL(10, 2),
                FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
            )
        `);

        console.log('Database tables created successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Login Route
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);

        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET);
        res.json({ token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Database error' });
    }
});

// Register Route
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        await db.query(
            'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
            [username, hashedPassword, email]
        );
        
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Username already exists' });
        }
        res.status(500).json({ message: 'Database error' });
    }
});

// Get next sequence number
async function getNextSequenceNumber(sequenceId) {
    try {
        await db.beginTransaction();
        
        const [rows] = await db.execute(
            'SELECT last_number FROM sequence_numbers WHERE id = ? FOR UPDATE',
            [sequenceId]
        );
        
        const nextNumber = rows[0].last_number + 1;
        
        await db.execute(
            'UPDATE sequence_numbers SET last_number = ? WHERE id = ?',
            [nextNumber, sequenceId]
        );
        
        await db.commit();
        return nextNumber.toString().padStart(4, '0');
    } catch (error) {
        await db.rollback();
        throw error;
    }
}

// Generate PO Number
async function generatePONumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const sequence = await getNextSequenceNumber('po_number');
    return `WK-${year}${month}${day}-${sequence}`;
}

// Generate Invoice Number
async function generateInvoiceNumber(poDate) {
    const date = new Date(poDate);
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const sequence = await getNextSequenceNumber('invoice_number');
    return `INV-${year}${month}-${sequence}`;
}

// Create new transaction
app.post('/api/transactions', authenticateToken, async (req, res) => {
    try {
        await db.beginTransaction();

        const { customer_name, items } = req.body;
        const po_number = await generatePONumber();

        // Insert purchase order
        const [poResult] = await db.execute(
            'INSERT INTO purchase_orders (po_number, customer_name) VALUES (?, ?)',
            [po_number, customer_name]
        );

        const po_id = poResult.insertId;

        // Insert items
        for (const item of items) {
            await db.execute(
                `INSERT INTO transaction_items 
                (po_id, item_name, unit_price, quantity, total_price, consignment_name, consignment_qty, consignment_price)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    po_id,
                    item.item_name,
                    item.unit_price,
                    item.quantity,
                    item.total_price || (item.unit_price * item.quantity),
                    item.consignment_name || null,
                    item.consignment_qty || null,
                    item.consignment_price || null
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

// Get all transactions
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT 
                po.po_number,
                po.date,
                po.customer_name,
                po.invoice_number,
                po.invoice_date,
                ti.item_name,
                ti.unit_price,
                ti.quantity,
                ti.total_price,
                ti.consignment_name,
                ti.consignment_qty,
                ti.consignment_price
            FROM purchase_orders po
            LEFT JOIN transaction_items ti ON po.id = ti.po_id
            ORDER BY po.date DESC, po.id DESC
        `);

        // Group items by PO
        const transactions = rows.reduce((acc, row) => {
            if (!acc[row.po_number]) {
                acc[row.po_number] = {
                    po_number: row.po_number,
                    date: row.date,
                    customer_name: row.customer_name,
                    invoice_number: row.invoice_number,
                    invoice_date: row.invoice_date,
                    items: []
                };
            }

            acc[row.po_number].items.push({
                item_name: row.item_name,
                unit_price: row.unit_price,
                quantity: row.quantity,
                total_price: row.total_price,
                consignment_name: row.consignment_name,
                consignment_qty: row.consignment_qty,
                consignment_price: row.consignment_price
            });

            return acc;
        }, {});

        res.json(Object.values(transactions));
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Generate invoice route
app.post('/api/transactions/:poNumber/invoice', authenticateToken, async (req, res) => {
    try {
        await db.beginTransaction();
        
        const { poNumber } = req.params;
        
        // Get PO data
        const [rows] = await db.execute(
            'SELECT date FROM purchase_orders WHERE po_number = ?',
            [poNumber]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        // Generate invoice number
        const invoiceNumber = await generateInvoiceNumber(rows[0].date);
        
        // Update PO with invoice number
        await db.execute(
            `UPDATE purchase_orders 
             SET invoice_number = ?, invoice_date = CURRENT_TIMESTAMP
             WHERE po_number = ?`,
            [invoiceNumber, poNumber]
        );
        
        await db.commit();
        res.json({ invoice_number: invoiceNumber });
    } catch (error) {
        await db.rollback();
        console.error('Error generating invoice:', error);
        res.status(500).json({ error: 'Failed to generate invoice' });
    }
});

// Generate invoice PDF
async function generateInvoicePDF(res, poNumber, invoiceNumber, transaction) {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 50
    });

    // Pipe the PDF to the response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoiceNumber}.pdf`);
    doc.pipe(res);

    // Add company logo and header
    doc.fontSize(20)
        .text('WAKO PROJECT', { align: 'center' })
        .fontSize(12)
        .text('Jl. Example Street No. 123', { align: 'center' })
        .text('Phone: (123) 456-7890', { align: 'center' })
        .moveDown(2);

    // Add invoice details
    doc.fontSize(14)
        .text('INVOICE', { align: 'center' })
        .moveDown()
        .fontSize(10)
        .text(`Invoice Number: ${invoiceNumber}`)
        .text(`PO Number: ${poNumber}`)
        .text(`Date: ${new Date().toLocaleDateString('id-ID')}`)
        .text(`Customer: ${transaction.customer_name}`)
        .moveDown();

    // Add table header
    const tableTop = doc.y;
    const itemX = 50;
    const qtyX = 300;
    const priceX = 400;
    const totalX = 500;

    doc.fontSize(10)
        .text('Item', itemX, tableTop)
        .text('Qty', qtyX, tableTop)
        .text('Price', priceX, tableTop)
        .text('Total', totalX, tableTop)
        .moveDown();

    let y = doc.y;

    // Add horizontal line
    doc.moveTo(50, y)
        .lineTo(550, y)
        .stroke();

    y += 10;

    // Add items
    let grandTotal = 0;
    transaction.items.forEach(item => {
        const itemTotal = item.quantity * item.unit_price;
        grandTotal += itemTotal;

        doc.text(item.item_name, itemX, y)
            .text(item.quantity.toString(), qtyX, y)
            .text(formatCurrency(item.unit_price), priceX, y)
            .text(formatCurrency(itemTotal), totalX, y);

        // Add consignment if exists
        if (item.consignment_name) {
            y += 20;
            const consignmentTotal = item.consignment_qty * item.unit_price;
            grandTotal += consignmentTotal;

            doc.text(`${item.consignment_name} (Titipan)`, itemX, y)
                .text(item.consignment_qty.toString(), qtyX, y)
                .text(formatCurrency(item.unit_price), priceX, y)
                .text(formatCurrency(consignmentTotal), totalX, y);
        }

        y += 30;
    });

    // Add horizontal line
    doc.moveTo(50, y)
        .lineTo(550, y)
        .stroke();

    y += 10;

    // Add grand total
    doc.fontSize(12)
        .text('Grand Total:', 400, y)
        .text(formatCurrency(grandTotal), totalX, y);

    // Add footer
    doc.fontSize(10)
        .moveDown(4)
        .text('Thank you for your business!', { align: 'center' });

    // Finalize the PDF
    doc.end();
}

// Format currency for PDF
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR'
    }).format(amount);
}

// Generate invoice route
app.get('/api/transactions/:poNumber/invoice/download', authenticateToken, async (req, res) => {
    try {
        const { poNumber } = req.params;

        // Get transaction data
        const [rows] = await db.execute(`
            SELECT 
                po.po_number,
                po.date,
                po.customer_name,
                po.invoice_number,
                po.invoice_date,
                ti.item_name,
                ti.unit_price,
                ti.quantity,
                ti.total_price,
                ti.consignment_name,
                ti.consignment_qty,
                ti.consignment_price
            FROM purchase_orders po
            LEFT JOIN transaction_items ti ON po.id = ti.po_id
            WHERE po.po_number = ?
        `, [poNumber]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        // Group items
        const transaction = {
            po_number: rows[0].po_number,
            date: rows[0].date,
            customer_name: rows[0].customer_name,
            invoice_number: rows[0].invoice_number,
            invoice_date: rows[0].invoice_date,
            items: rows.map(row => ({
                item_name: row.item_name,
                unit_price: row.unit_price,
                quantity: row.quantity,
                total_price: row.total_price,
                consignment_name: row.consignment_name,
                consignment_qty: row.consignment_qty,
                consignment_price: row.consignment_price
            }))
        };

        // Generate invoice number if not exists
        if (!transaction.invoice_number) {
            transaction.invoice_number = await generateInvoiceNumber(transaction.date);
            
            // Save invoice number
            await db.execute(
                `UPDATE purchase_orders 
                 SET invoice_number = ?, invoice_date = CURRENT_TIMESTAMP
                 WHERE po_number = ?`,
                [transaction.invoice_number, poNumber]
            );
        }

        // Generate PDF
        await generateInvoicePDF(res, poNumber, transaction.invoice_number, transaction);
    } catch (error) {
        console.error('Error generating invoice PDF:', error);
        res.status(500).json({ error: 'Failed to generate invoice PDF' });
    }
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;

// Start server with proper error handling
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    initializeDatabase();
}).on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
