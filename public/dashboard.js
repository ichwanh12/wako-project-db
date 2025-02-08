// Check if user is logged in
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/';
}

// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        const page = this.dataset.page;
        
        // Update active state
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        
        // Show/hide pages
        if (page === 'input') {
            document.getElementById('inputPage').style.display = 'block';
            document.getElementById('reportPage').style.display = 'none';
        } else if (page === 'report') {
            document.getElementById('inputPage').style.display = 'none';
            document.getElementById('reportPage').style.display = 'block';
            loadTransactions();
        }
    });
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', function() {
    localStorage.removeItem('token');
    window.location.href = '/';
});

// Transaction Form Submit
document.getElementById('transactionForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = {
        customer_name: document.getElementById('customerName').value,
        item_name: document.getElementById('itemName').value,
        price: parseFloat(document.getElementById('price').value),
        quantity: parseInt(document.getElementById('quantity').value),
        unit_price: parseFloat(document.getElementById('unitPrice').value),
        total_price: parseFloat(document.getElementById('price').value) * parseInt(document.getElementById('quantity').value),
        consignment_name: document.getElementById('consignmentName').value,
        consignment_qty: document.getElementById('consignmentQty').value ? parseInt(document.getElementById('consignmentQty').value) : null,
        consignment_price: document.getElementById('consignmentPrice').value ? parseFloat(document.getElementById('consignmentPrice').value) : null
    };

    try {
        const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (response.ok) {
            alert('Data berhasil disimpan!');
            document.getElementById('transactionForm').reset();
        } else {
            alert(data.message || 'Gagal menyimpan data');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Terjadi kesalahan saat menyimpan data');
    }
});

// Load Transactions for Report
async function loadTransactions() {
    try {
        const response = await fetch('/api/transactions', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const transactions = await response.json();

        const tableBody = document.getElementById('reportTableBody');
        tableBody.innerHTML = '';

        transactions.forEach(t => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${new Date(t.date).toLocaleDateString()}</td>
                <td>${t.customer_name}</td>
                <td>${t.item_name}</td>
                <td>${t.price}</td>
                <td>${t.quantity}</td>
                <td>${t.unit_price}</td>
                <td>${t.total_price}</td>
                <td>${t.consignment_name || '-'}</td>
                <td>${t.consignment_qty || '-'}</td>
                <td>${t.consignment_price || '-'}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error:', error);
        alert('Gagal memuat data transaksi');
    }
}
