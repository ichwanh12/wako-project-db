// Check if token exists
if (!localStorage.getItem('token')) {
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
        }
    });
});

// Logout function
document.getElementById('logoutBtn').addEventListener('click', function() {
    localStorage.removeItem('token');
    window.location.href = '/';
});

// Generate PO Number
function generatePONumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(1000 + Math.random() * 9000); // 4 digit random number
    return `WK-${year}${month}${day}-${random}`;
}

// Calculate total price
function calculateTotal() {
    const unitPrice = parseFloat(document.getElementById('unitPrice').value) || 0;
    const quantity = parseInt(document.getElementById('quantity').value) || 0;
    const totalPrice = unitPrice * quantity;
    document.getElementById('totalPrice').value = totalPrice.toFixed(2);
}

// Add event listeners for price calculation
document.getElementById('unitPrice').addEventListener('input', calculateTotal);
document.getElementById('quantity').addEventListener('input', calculateTotal);

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount);
}

// Format date
function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Add tab change event listener
document.querySelectorAll('button[data-bs-toggle="tab"]').forEach(tab => {
    tab.addEventListener('shown.bs.tab', function (event) {
        if (event.target.id === 'list-tab') {
            loadTransactions();
        }
    });
});

// Load transactions
async function loadTransactions() {
    try {
        const response = await fetch('/api/transactions', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load transactions');
        }

        const transactions = await response.json();
        const tbody = document.getElementById('reportTableBody');
        
        // Check if tbody exists before manipulating it
        if (!tbody) {
            console.error('Transaction list table body not found');
            return;
        }

        tbody.innerHTML = '';

        transactions.forEach(t => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${t.po_number}</td>
                <td>${formatDate(t.date)}</td>
                <td>${t.customer_name}</td>
                <td>${t.item_name}</td>
                <td>${t.quantity}</td>
                <td>${formatCurrency(t.unit_price)}</td>
                <td>${formatCurrency(t.total_price)}</td>
                <td>
                    ${t.consignment_name ? `
                        ${t.consignment_name}<br>
                        Qty: ${t.consignment_qty}<br>
                        Price: ${formatCurrency(t.unit_price)}
                    ` : '-'}
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load transactions'
        });
    }
}

// Handle form submission
document.getElementById('transactionForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    try {
        // Get form values
        const customerName = document.getElementById('customerName').value;
        const itemName = document.getElementById('itemName').value;
        const unitPrice = parseFloat(document.getElementById('unitPrice').value);
        const quantity = parseInt(document.getElementById('quantity').value);
        const totalPrice = unitPrice * quantity;

        // Validate required fields
        if (!customerName || !itemName || !unitPrice || !quantity) {
            throw new Error('Please fill in all required fields');
        }

        // Validate numbers
        if (isNaN(unitPrice) || unitPrice <= 0) {
            throw new Error('Please enter a valid unit price');
        }
        if (isNaN(quantity) || quantity <= 0) {
            throw new Error('Please enter a valid quantity');
        }

        // Create form data
        const formData = {
            po_number: generatePONumber(),
            customer_name: customerName,
            item_name: itemName,
            unit_price: unitPrice,
            quantity: quantity,
            total_price: totalPrice
        };

        // Add consignment data if provided
        const consignmentName = document.getElementById('consignmentName').value;
        const consignmentQty = document.getElementById('consignmentQty').value;
        
        if (consignmentName && consignmentQty) {
            formData.consignment_name = consignmentName;
            formData.consignment_qty = parseInt(consignmentQty);
            formData.consignment_price = unitPrice;
        }

        console.log('Sending transaction data:', formData);

        const response = await fetch('/api/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(formData)
        });

        const responseData = await response.json();

        if (!response.ok) {
            throw new Error(responseData.error || 'Failed to save transaction');
        }

        Swal.fire({
            icon: 'success',
            title: 'Success!',
            text: 'Transaction saved successfully',
            showConfirmButton: false,
            timer: 1500
        });

        // Reset form
        e.target.reset();
        document.getElementById('totalPrice').value = '';
        
        // Switch to list tab and reload transactions
        const listTab = document.getElementById('list-tab');
        const tab = new bootstrap.Tab(listTab);
        tab.show();
    } catch (error) {
        console.error('Error:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save transaction'
        });
    }
});

// Initial load
document.getElementById('list-tab').click();
