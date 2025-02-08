const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const db = require('../config/database');

// Get all customers
router.get('/', authenticateToken, async (req, res) => {
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
router.post('/', authenticateToken, async (req, res) => {
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
router.put('/:id', authenticateToken, async (req, res) => {
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
router.delete('/:id', authenticateToken, async (req, res) => {
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

module.exports = router;
