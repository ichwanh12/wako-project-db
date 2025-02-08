const mysql = require('mysql2/promise');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL;
console.log('Attempting to connect to database...');
console.log('Database URL format:', dbUrl ? 'URL is set' : 'URL is missing');

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

        console.log('Connecting to MySQL with SSL...');
        db = await mysql.createConnection(connectionConfig);
        console.log('Successfully connected to MySQL database');

        // Test the connection
        const [result] = await db.execute('SELECT 1 + 1 as test');
        console.log('Database connection test result:', result[0].test === 2 ? 'SUCCESS' : 'FAILED');

        // Check if tables exist
        const [tables] = await db.execute(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE()
        `);
        console.log('Existing tables:', tables.map(t => t.table_name).join(', ') || 'No tables found');

        // Only create tables if they don't exist
        if (tables.length === 0) {
            console.log('No tables found, creating new tables...');
            await createDatabaseTables();
        } else {
            console.log('Database tables already exist, skipping creation');
        }

        console.log('Database initialization completed successfully');
    } catch (error) {
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            errno: error.errno,
            sqlState: error.sqlState,
            sqlMessage: error.sqlMessage
        });
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
        console.log('Created customers table');

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
        console.log('Created purchase_orders table');

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
        console.log('Created transaction_items table');

        // Create sequence numbers table
        await db.execute(`
            CREATE TABLE IF NOT EXISTS sequence_numbers (
                id VARCHAR(50) PRIMARY KEY,
                last_number INT NOT NULL DEFAULT 0
            )
        `);
        console.log('Created sequence_numbers table');

        // Insert initial sequence if not exists
        await db.execute(`
            INSERT IGNORE INTO sequence_numbers (id, last_number) 
            VALUES ('po_number', 0), ('invoice_number', 0)
        `);
        console.log('Initialized sequence numbers');

        console.log('All database tables created successfully');
    } catch (error) {
        console.error('Error creating database tables:', {
            message: error.message,
            code: error.code,
            errno: error.errno,
            sqlState: error.sqlState,
            sqlMessage: error.sqlMessage
        });
        throw error;
    }
}

// Initialize database
initializeDatabase();

module.exports = db;
