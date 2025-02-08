const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
    
    // Railway provides these environment variables
    const config = {
      host: process.env.MYSQL_HOST || 'mysql.railway.internal',
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'railway',
      port: parseInt(process.env.MYSQL_PORT || '3306')
    };
    
    console.log('Database config:', {
      ...config,
      password: '********' // Hide password in logs
    });

    if (!config.password) {
      throw new Error('Database password not found in environment variables');
    }

    db = await mysql.createConnection(config);
    console.log('Connected to MySQL database');
    
    // Create tables if they don't exist
    const createTables = `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        customer_name VARCHAR(255) NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        quantity INT NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        consignment_name VARCHAR(255),
        consignment_qty INT,
        consignment_price DECIMAL(10,2),
        user_id INT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `;

    await db.query(createTables);
    console.log('Database tables created/verified');
  } catch (error) {
    console.error('Database connection error:', error);
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

// Create Transaction
app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const {
      customer_name,
      item_name,
      price,
      quantity,
      unit_price,
      total_price,
      consignment_name,
      consignment_qty,
      consignment_price
    } = req.body;

    const [result] = await db.query(
      `INSERT INTO transactions 
      (customer_name, item_name, price, quantity, unit_price, total_price, 
       consignment_name, consignment_qty, consignment_price, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customer_name, item_name, price, quantity, unit_price, total_price,
       consignment_name, consignment_qty, consignment_price, req.user.id]
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Transaction creation error:', error);
    res.status(500).json({ message: 'Database error' });
  }
});

// Get Transactions
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const [transactions] = await db.query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC',
      [req.user.id]
    );
    res.json(transactions);
  } catch (error) {
    console.error('Transaction fetch error:', error);
    res.status(500).json({ message: 'Database error' });
  }
});

const PORT = process.env.PORT || 3000;

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});
