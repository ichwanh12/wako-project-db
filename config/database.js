const mysql = require('mysql2/promise');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;

let db;

async function initializeDatabase() {
    try {
        // Parse connection URL
        const connectionConfig = {
            uri: dbUrl,
            ssl: {
                rejectUnauthorized: false // Required for Railway MySQL
            }
        };

        db = await mysql.createConnection(connectionConfig);
        console.log('Connected to MySQL database');

        // Check if tables exist
        const [tables] = await db.execute(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE()
        `);

        // Only create tables if they don't exist
        if (tables.length === 0) {
            await createDatabaseTables();
        } else {
            console.log('Database tables already exist, skipping creation');
        }

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}

async function createDatabaseTables() {
    try {
        console.log('Creating database tables...');

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

        // Create purchase orders table
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

// Initialize database
initializeDatabase();

module.exports = db;
