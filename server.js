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

        // Create database tables
        await createDatabaseTables();

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}

// Create database tables
async function createDatabaseTables() {
    try {
        console.log('Creating database tables...');

        // Drop existing tables in correct order
        await db.execute('DROP TABLE IF EXISTS transaction_items');
        await db.execute('DROP TABLE IF EXISTS purchase_orders');
        await db.execute('DROP TABLE IF EXISTS customers');

        // Create customers table
        await db.execute(`
            CREATE TABLE IF NOT EXISTS customers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company_name VARCHAR(100),
                contact_name VARCHAR(100) NOT NULL,
                phone VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create purchase orders table with customer_id foreign key
        await db.execute(`
            CREATE TABLE IF NOT EXISTS purchase_orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                po_number VARCHAR(50) NOT NULL UNIQUE,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                customer_id INT,
                invoice_number VARCHAR(50) UNIQUE,
                invoice_date TIMESTAMP NULL,
                FOREIGN KEY (customer_id) REFERENCES customers(id)
            )
        `);

        // Create transaction items table
        await db.execute(`
            CREATE TABLE IF NOT EXISTS transaction_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                po_id INT,
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

        // Create sequence numbers table
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

        console.log('Database tables created successfully');
    } catch (error) {
        console.error('Error creating database tables:', error);
        throw error;
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

// Get all transactions
app.get('/api/transactions', authenticateToken, async (req, res) => {
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
                ti.consignment_qty,
                ti.consignment_price
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
                    consignment_qty: row.consignment_qty,
                    consignment_price: row.consignment_price
                });
            }
        });

        res.json(Object.values(transactions));
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// Get transaction by PO number
app.get('/api/transactions/:poNumber', authenticateToken, async (req, res) => {
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
                ti.consignment_qty,
                ti.consignment_price
            FROM purchase_orders po
            JOIN customers c ON po.customer_id = c.id
            LEFT JOIN transaction_items ti ON po.id = ti.po_id
            WHERE po.po_number = ?
        `, [req.params.poNumber]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
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
                consignment_qty: row.consignment_qty,
                consignment_price: row.consignment_price
            }))
        };

        res.json(transaction);
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({ error: 'Failed to fetch transaction' });
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
async function generateInvoicePDF(transaction) {
    const doc = new PDFDocument({ margin: 50 });

    // Header
    const leftColumn = 50;
    const rightColumn = 400;

    doc.fontSize(20)
        .text('WAKO PRINTING', { align: 'right' })
        .moveDown(1);

    // Company details
    doc.fontSize(10)
        .text('Jl. Raya Janti No.3, Banguntapan', rightColumn, doc.y)
        .text('Bantul, Yogyakarta', rightColumn, doc.y + 15)
        .text('Phone: 0857-2900-1405', rightColumn, doc.y + 15)
        .moveDown(2);

    // Left column - Customer details
    doc.fontSize(10)
        .text('Customer:', leftColumn)
        .text(transaction.company_name || '', leftColumn + 10, doc.y)
        .text(`Contact: ${transaction.contact_name}`, leftColumn + 10, doc.y + 15)
        .text(`Phone: ${transaction.phone || ''}`, leftColumn + 10, doc.y + 15);

    // Right column - Invoice details
    doc.fontSize(10)
        .text('Invoice:', rightColumn)
        .text(`Number: ${transaction.invoice_number}`, rightColumn + 10, doc.y)
        .text(`Date: ${formatDate(transaction.invoice_date)}`, rightColumn + 10, doc.y + 15)
        .text(`PO Number: ${transaction.po_number}`, rightColumn + 10, doc.y + 15)
        .moveDown(2);

    // Items table
    const tableTop = doc.y + 30;
    const itemX = leftColumn;
    const qtyX = 300;
    const priceX = 400;
    const totalX = 500;

    // Table headers
    doc.fontSize(10)
        .text('Item', itemX)
        .text('Qty', qtyX)
        .text('Price', priceX)
        .text('Total', totalX);

    // Underline
    doc.moveTo(itemX, doc.y + 5)
        .lineTo(totalX + 50, doc.y + 5)
        .stroke();

    // Table rows
    let y = doc.y + 15;
    let total = 0;

    transaction.items.forEach(item => {
        // Regular item
        doc.fontSize(10)
            .text(item.item_name, itemX, y)
            .text(item.quantity.toString(), qtyX, y)
            .text(formatCurrency(item.unit_price), priceX, y)
            .text(formatCurrency(item.total_price), totalX, y);

        total += parseFloat(item.total_price);
        y += 20;

        // Consignment item if exists
        if (item.consignment_name && item.consignment_qty > 0) {
            doc.fontSize(10)
                .text(`+ ${item.consignment_name}`, itemX + 20, y)
                .text(item.consignment_qty.toString(), qtyX, y)
                .text(formatCurrency(item.unit_price), priceX, y)
                .text(formatCurrency(item.consignment_qty * item.unit_price), totalX, y);

            total += item.consignment_qty * item.unit_price;
            y += 20;
        }
    });

    // Total
    doc.moveTo(itemX, y)
        .lineTo(totalX + 50, y)
        .stroke();

    doc.fontSize(12)
        .text('Total:', totalX - 50, y + 10)
        .text(formatCurrency(total), totalX, y + 10);

    // Bank account details
    doc.moveDown(4)
        .fontSize(10)
        .text('Payment Details:', leftColumn)
        .text('Bank: BCA', leftColumn + 10, doc.y)
        .text('Account: 6290346817', leftColumn + 10, doc.y + 15)
        .text('Name: Eko prambudi', leftColumn + 10, doc.y + 15);

    // Signature
    doc.moveDown(4)
        .fontSize(10)
        .text('Hormat Kami,', rightColumn)
        .moveDown(3)
        .text('WAKO PRINTING', rightColumn);

    return doc;
}

// Format currency for PDF
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR'
    }).format(amount);
}

// Format date for PDF
function formatDate(date) {
    return new Date(date).toLocaleDateString('id-ID');
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
                ti.consignment_qty,
                ti.consignment_price
            FROM purchase_orders po
            JOIN customers c ON po.customer_id = c.id
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

// Get all customers
app.get('/api/customers', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT * FROM customers 
            ORDER BY company_name, contact_name
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

// Add new customer
app.post('/api/customers', authenticateToken, async (req, res) => {
    try {
        const { company_name, contact_name, phone } = req.body;
        
        if (!contact_name) {
            return res.status(400).json({ error: 'Contact name is required' });
        }

        const [result] = await db.execute(
            'INSERT INTO customers (company_name, contact_name, phone) VALUES (?, ?, ?)',
            [company_name, contact_name, phone]
        );

        res.json({ 
            id: result.insertId,
            company_name,
            contact_name,
            phone
        });
    } catch (error) {
        console.error('Error adding customer:', error);
        res.status(500).json({ error: 'Failed to add customer' });
    }
});

// Update customer
app.put('/api/customers/:id', authenticateToken, async (req, res) => {
    try {
        const { company_name, contact_name, phone } = req.body;
        const customerId = req.params.id;
        
        if (!contact_name) {
            return res.status(400).json({ error: 'Contact name is required' });
        }

        await db.execute(
            'UPDATE customers SET company_name = ?, contact_name = ?, phone = ? WHERE id = ?',
            [company_name, contact_name, phone, customerId]
        );

        res.json({ 
            id: customerId,
            company_name,
            contact_name,
            phone
        });
    } catch (error) {
        console.error('Error updating customer:', error);
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// Delete customer
app.delete('/api/customers/:id', authenticateToken, async (req, res) => {
    try {
        const customerId = req.params.id;
        
        // Check if customer has any transactions
        const [transactions] = await db.execute(
            'SELECT COUNT(*) as count FROM purchase_orders WHERE customer_id = ?',
            [customerId]
        );

        if (transactions[0].count > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete customer with existing transactions' 
            });
        }

        await db.execute('DELETE FROM customers WHERE id = ?', [customerId]);
        res.json({ message: 'Customer deleted successfully' });
    } catch (error) {
        console.error('Error deleting customer:', error);
        res.status(500).json({ error: 'Failed to delete customer' });
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
