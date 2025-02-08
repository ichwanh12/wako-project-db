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
                company_name VARCHAR(100),
                customer_name VARCHAR(100) NOT NULL,
                customer_phone VARCHAR(20),
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

        const { customer_name, company_name, customer_phone, items } = req.body;
        const po_number = await generatePONumber();

        // Insert purchase order
        const [poResult] = await db.execute(
            'INSERT INTO purchase_orders (po_number, company_name, customer_name, customer_phone) VALUES (?, ?, ?, ?)',
            [po_number, company_name, customer_name, customer_phone]
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
                po.company_name,
                po.customer_name,
                po.customer_phone,
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
                    company_name: row.company_name,
                    customer_name: row.customer_name,
                    customer_phone: row.customer_phone,
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
        .text('WAKO PRINTING', { align: 'right' })
        .moveDown(1);

    // Add invoice title
    doc.fontSize(16)
        .text('INVOICE', { align: 'center' })
        .moveDown(1);

    // Add customer and invoice details in two columns
    const leftColumn = 50;
    const rightColumn = 350;
    
    // Left column - Customer details
    doc.fontSize(10)
        .text('Customer:', leftColumn)
        .text(transaction.company_name || '', leftColumn + 10, doc.y)
        .text(`Contact: ${transaction.customer_name}`, leftColumn + 10, doc.y + 15)
        .text(`Phone: ${transaction.customer_phone || ''}`, leftColumn + 10, doc.y + 15);

    // Right column - Invoice details
    doc.fontSize(10)
        .text(`Nomor P.O: ${poNumber}`, rightColumn, 120)
        .text(`Tanggal: ${new Date(transaction.date).toLocaleDateString('id-ID')}`, rightColumn, doc.y + 15)
        .text('No Rek BCA: 6290346817', rightColumn, doc.y + 15)
        .text('a/n Eko prambudi', rightColumn, doc.y + 15)
        .moveDown(2);

    // Add table header
    const tableTop = doc.y + 30;
    doc.fontSize(10);

    // Draw table header
    doc.rect(50, tableTop - 5, 500, 20).fill('#f0f0f0').stroke('#000000');
    doc.fill('#000000')
        .text('NAMA BARANG / JASA', 60, tableTop)
        .text('KUANTITI', 280, tableTop)
        .text('HARGA SATUAN', 350, tableTop)
        .text('JUMLAH', 450, tableTop);

    let y = tableTop + 25;

    // Add items
    let grandTotal = 0;
    transaction.items.forEach((item, index) => {
        // Draw item row
        doc.text(item.item_name, 60, y)
            .text(item.quantity.toString(), 280, y)
            .text(formatCurrency(item.unit_price).split('Rp')[1], 350, y)
            .text(formatCurrency(item.quantity * item.unit_price).split('Rp')[1], 450, y);

        grandTotal += item.quantity * item.unit_price;
        y += 25;

        // Add consignment if exists
        if (item.consignment_name) {
            doc.text(`${item.consignment_name} (Titipan)`, 60, y)
                .text(item.consignment_qty.toString(), 280, y)
                .text(formatCurrency(item.unit_price).split('Rp')[1], 350, y)
                .text(formatCurrency(item.consignment_qty * item.unit_price).split('Rp')[1], 450, y);

            grandTotal += item.consignment_qty * item.unit_price;
            y += 25;
        }
    });

    // Draw total section
    y += 10;
    doc.fontSize(10)
        .text('TOTAL:', 350, y)
        .text(formatCurrency(grandTotal).split('Rp')[1], 450, y);

    // Add notes
    y += 40;
    doc.fontSize(9)
        .text('Keterangan:', 50, y)
        .text('* Pembayaran Tanda Jadi (DP) 0%', 50, y + 15)
        .text('* Batas pembayaran MAX 7 hari setelah Invoice terbit', 50, y + 30);

    // Add signature section
    y += 80;
    doc.fontSize(10)
        .text('Diterima dan Disetujui', 50, y)
        .text('Hormat kami,', 400, y)
        .moveDown(3)
        .text('_____________________', 50, doc.y)
        .text('Purchase dept', 400, doc.y)
        .text('Tanda tangan, Nama jelas & Cap perusahaan', 50, doc.y + 15);

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
                po.company_name,
                po.customer_name,
                po.customer_phone,
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
            company_name: rows[0].company_name,
            customer_name: rows[0].customer_name,
            customer_phone: rows[0].customer_phone,
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
