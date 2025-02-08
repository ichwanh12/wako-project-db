const PDFDocument = require('pdfkit');

function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

async function generateInvoicePDF(transaction) {
    const doc = new PDFDocument({ margin: 50 });

    // Define columns
    const leftEdge = 50;
    const rightEdge = 550;
    const contentWidth = rightEdge - leftEdge;
    const col1 = leftEdge;
    const col2 = leftEdge + contentWidth * 0.3;
    const col3 = leftEdge + contentWidth * 0.6;
    const col4 = leftEdge + contentWidth * 0.8;

    // Header
    doc.fontSize(16)
        .text('WAKO PRINTING', { align: 'center' })
        .moveDown(0.5);

    // Company details
    doc.fontSize(10)
        .text('Jl. Raya Janti No.3, Banguntapan', { align: 'center' })
        .text('Bantul, Yogyakarta', { align: 'center' })
        .text('Phone: 0857-2900-1405', { align: 'center' })
        .moveDown(1);

    // Customer and Invoice details in two columns
    const detailsY = doc.y;

    // Left column - Customer details
    doc.text('Customer:', col1)
        .text(transaction.company_name || '', { indent: 10 })
        .text(`Contact: ${transaction.contact_name}`, { indent: 10 })
        .text(`Phone: ${transaction.phone || ''}`, { indent: 10 });

    // Right column - Invoice details
    doc.y = detailsY;
    doc.text('Invoice:', col3)
        .text(`Number: ${transaction.invoice_number}`, { indent: 10 })
        .text(`Date: ${formatDate(transaction.invoice_date)}`, { indent: 10 })
        .text(`PO Number: ${transaction.po_number}`, { indent: 10 });

    // Move to items section
    doc.moveDown(2);

    // Items table header
    doc.font('Helvetica-Bold');
    doc.text('Item', col1, doc.y, { width: col2 - col1 - 10 })
        .text('Qty', col2, doc.y, { width: col3 - col2 - 10 })
        .text('Price', col3, doc.y, { width: col4 - col3 - 10 })
        .text('Total', col4, doc.y);

    // Underline
    doc.moveTo(col1, doc.y + 5)
        .lineTo(rightEdge, doc.y + 5)
        .stroke();

    // Reset font
    doc.font('Helvetica');
    doc.moveDown(0.5);

    // Table rows
    let total = 0;
    transaction.items.forEach(item => {
        const itemTotal = item.quantity * item.unit_price;
        doc.text(item.item_name, col1, doc.y, { width: col2 - col1 - 10 })
            .text(item.quantity.toString(), col2, doc.y, { width: col3 - col2 - 10 })
            .text(formatCurrency(item.unit_price), col3, doc.y, { width: col4 - col3 - 10 })
            .text(formatCurrency(itemTotal), col4, doc.y);
        total += itemTotal;
        doc.moveDown(0.5);
    });

    // Total line
    doc.moveTo(col1, doc.y + 5)
        .lineTo(rightEdge, doc.y + 5)
        .stroke();
    doc.moveDown(0.5);

    // Total amount
    doc.font('Helvetica-Bold')
        .text('Total:', col3, doc.y)
        .text(formatCurrency(total), col4, doc.y);

    // Payment details
    doc.moveDown(2)
        .font('Helvetica')
        .text('Payment Details:', col1)
        .text('Bank: BCA', { indent: 10 })
        .text('Account: 6290346817', { indent: 10 })
        .text('Name: Eko prambudi', { indent: 10 });

    // Signature
    doc.moveDown(2)
        .text('Hormat Kami,', col3)
        .moveDown(3)
        .text('WAKO PRINTING', col3);

    return doc;
}

module.exports = {
    generateInvoicePDF,
    formatCurrency,
    formatDate
};
