// Check if token exists
if (!localStorage.getItem('token')) {
    window.location.href = '/';
}

// Logout function
document.getElementById('logoutBtn').addEventListener('click', function() {
    localStorage.removeItem('token');
    window.location.href = '/';
});

// Add tab change event listener
document.querySelectorAll('button[data-bs-toggle="tab"]').forEach(tab => {
    tab.addEventListener('shown.bs.tab', function (event) {
        if (event.target.id === 'list-tab') {
            loadTransactions();
        }
    });
});

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

// Calculate total price for an item row
function calculateItemTotal(itemRow) {
    const unitPrice = parseFloat(itemRow.querySelector('.item-unit-price').value) || 0;
    const quantity = parseInt(itemRow.querySelector('.item-quantity').value) || 0;
    const consignmentQty = parseInt(itemRow.querySelector('.item-consignment-qty').value) || 0;
    
    const regularTotal = unitPrice * quantity;
    const consignmentTotal = unitPrice * consignmentQty;
    const totalPrice = regularTotal + consignmentTotal;
    
    itemRow.querySelector('.item-total-price').value = totalPrice.toFixed(2);
    return totalPrice;
}

// Add new item row
function addItemRow() {
    const template = document.getElementById('itemRowTemplate');
    const itemRow = template.content.cloneNode(true);
    document.getElementById('itemsContainer').appendChild(itemRow);

    const newRow = document.getElementById('itemsContainer').lastElementChild;

    // Add event listeners for price calculation
    const inputs = newRow.querySelectorAll('.item-unit-price, .item-quantity, .item-consignment-qty');
    inputs.forEach(input => {
        input.addEventListener('input', () => calculateItemTotal(newRow));
    });

    // Add event listener for remove button
    newRow.querySelector('.remove-item').addEventListener('click', function() {
        if (document.getElementById('itemsContainer').children.length > 1) {
            newRow.remove();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'At least one item is required'
            });
        }
    });
}

// Add event listener for add item button
document.getElementById('addItemBtn').addEventListener('click', addItemRow);

// Download PDF function
async function downloadPDF(poNumber) {
    try {
        const response = await fetch(`/api/transactions/${poNumber}/invoice/download`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to download PDF');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${poNumber}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (error) {
        console.error('Error:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message
        });
    }
}

// Generate invoice
async function generateInvoice(poNumber) {
    try {
        // First generate invoice number
        const response = await fetch(`/api/transactions/${poNumber}/invoice`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to generate invoice');
        }

        const data = await response.json();
        
        // Then download PDF
        await downloadPDF(poNumber);

        Swal.fire({
            icon: 'success',
            title: 'Success!',
            text: `Invoice ${data.invoice_number} generated successfully`
        });

        loadTransactions();
    } catch (error) {
        console.error('Error:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message
        });
    }
}

// Load transactions
async function loadTransactions() {
    try {
        console.log('Loading transactions...');
        const response = await fetch('/api/transactions', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load transactions');
        }

        const transactions = await response.json();
        console.log('Transactions loaded:', transactions);
        
        const tbody = document.getElementById('transactionTableBody');
        if (!tbody) {
            console.error('Transaction table body not found');
            return;
        }

        tbody.innerHTML = '';

        if (!transactions || transactions.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="7" class="text-center">No transactions found</td>';
            tbody.appendChild(row);
            return;
        }

        transactions.forEach(t => {
            const row = document.createElement('tr');
            
            // Calculate total for all items
            const total = t.items.reduce((sum, item) => {
                return sum + parseFloat(item.total_price);
            }, 0);

            // Create items summary
            const itemsSummary = t.items.map(item => {
                let summary = `${item.item_name} (${item.quantity} × ${formatCurrency(item.unit_price)})`;
                if (item.consignment_name) {
                    summary += `<br>+ Titipan: ${item.consignment_name} (${item.consignment_qty} × ${formatCurrency(item.unit_price)})`;
                }
                return summary;
            }).join('<hr class="my-1">');

            row.innerHTML = `
                <td>${t.po_number}</td>
                <td>${formatDate(t.date)}</td>
                <td>${t.customer_name}</td>
                <td>${itemsSummary}</td>
                <td>${formatCurrency(total)}</td>
                <td>
                    ${t.invoice_number ? `
                        ${t.invoice_number}<br>
                        ${formatDate(t.invoice_date)}<br>
                        <button onclick="downloadPDF('${t.po_number}')" class="btn btn-sm btn-info">
                            <i class="fas fa-download"></i> Download PDF
                        </button>
                    ` : '-'}
                </td>
                <td>
                    ${!t.invoice_number ? `
                        <button class="btn btn-sm btn-primary generate-invoice" data-po="${t.po_number}">
                            <i class="fas fa-file-invoice"></i> Generate Invoice
                        </button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(row);

            // Add event listener for generate invoice button
            const invoiceBtn = row.querySelector('.generate-invoice');
            if (invoiceBtn) {
                invoiceBtn.addEventListener('click', () => generateInvoice(t.po_number));
            }
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
        const customerName = document.getElementById('customerName').value;
        if (!customerName) {
            throw new Error('Please enter customer name');
        }

        // Get all item rows
        const itemRows = document.getElementById('itemsContainer').children;
        if (itemRows.length === 0) {
            throw new Error('Please add at least one item');
        }

        // Collect items data
        const items = [];
        for (const row of itemRows) {
            const itemName = row.querySelector('.item-name').value;
            const unitPrice = parseFloat(row.querySelector('.item-unit-price').value);
            const quantity = parseInt(row.querySelector('.item-quantity').value);
            const consignmentName = row.querySelector('.item-consignment-name').value;
            const consignmentQty = row.querySelector('.item-consignment-qty').value;

            if (!itemName || !unitPrice || !quantity) {
                throw new Error('Please fill in all required fields for each item');
            }

            const item = {
                item_name: itemName,
                unit_price: unitPrice,
                quantity: quantity
            };

            if (consignmentName && consignmentQty) {
                item.consignment_name = consignmentName;
                item.consignment_qty = parseInt(consignmentQty);
            }

            items.push(item);
        }

        const formData = {
            customer_name: customerName,
            items: items
        };

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
        document.getElementById('itemsContainer').innerHTML = '';
        addItemRow(); // Add one empty item row
        
        // Switch to list tab and reload transactions
        const listTab = document.getElementById('list-tab');
        const tab = new bootstrap.Tab(listTab);
        tab.show();
        
        // Load transactions after successful save
        loadTransactions();
    } catch (error) {
        console.error('Error:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: error.message || 'Failed to save transaction'
        });
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    // Add first item row
    addItemRow();
    
    // Load transactions if list tab is active
    const listTab = document.getElementById('list-tab');
    if (listTab.classList.contains('active')) {
        loadTransactions();
    }
});
