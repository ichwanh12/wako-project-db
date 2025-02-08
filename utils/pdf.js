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

    // Header
    doc.fontSize(16)
        .text('WAKO PRINTING', { align: 'center' })
        .moveDown(0.5);

    // Company details (right aligned)
    doc.fontSize(10)
        .text('Jl. Raya Janti No.3, Banguntapan', { align: 'center' })
        .text('Bantul, Yogyakarta', { align: 'center' })
        .text('Phone: 0857-2900-1405', { align: 'center' })
        .moveDown(2);

    // Left column - Customer details
    const leftColumn = 50;
    doc.fontSize(10)
        .text('Customer:', leftColumn)
        .text(transaction.company_name || '', leftColumn + 10, doc.y)
        .text(`Contact: ${transaction.contact_name}`, leftColumn + 10, doc.y + 15)
        .text(`Phone: ${transaction.phone || ''}`, leftColumn + 10, doc.y + 15)
        .moveDown(1);

    // Right column - Invoice details
    const rightColumn = 300;
    doc.text('Invoice:', rightColumn)
        .text(`Number: ${transaction.invoice_number}`, rightColumn + 10, doc.y)
        .text(`Date: ${formatDate(transaction.invoice_date)}`, rightColumn + 10, doc.y + 15)
        .text(`PO Number: ${transaction.po_number}`, rightColumn + 10, doc.y + 15)
        .moveDown(2);

    // Items table
    const tableTop = doc.y;
    const itemX = leftColumn;
    const qtyX = 300;
    const priceX = 400;
    const totalX = 500;

    // Table headers
    doc.font('Helvetica-Bold')
        .text('Item', itemX)
        .text('Qty', qtyX)
        .text('Price', priceX)
        .text('Total', totalX)
        .moveDown(0.5);

    // Underline
    doc.moveTo(itemX, doc.y)
        .lineTo(totalX + 50, doc.y)
        .stroke();

    // Reset font
    doc.font('Helvetica');

    // Table rows
    let y = doc.y + 10;
    let total = 0;

    transaction.items.forEach(item => {
        // Only show regular items in invoice, skip consignment
        doc.text(item.item_name, itemX, y)
            .text(item.quantity.toString(), qtyX, y)
            .text(formatCurrency(item.unit_price), priceX, y)
            .text(formatCurrency(item.quantity * item.unit_price), totalX, y);

        total += item.quantity * item.unit_price;
        y += 20;
    });

    // Total line
    doc.moveTo(itemX, y + 10)
        .lineTo(totalX + 50, y + 10)
        .stroke();

    // Total amount
    doc.font('Helvetica-Bold')
        .text('Total:', totalX - 50, y + 20)
        .text(formatCurrency(total), totalX, y + 20);

    // Bank account details
    doc.moveDown(4)
        .font('Helvetica')
        .text('Payment Details:', leftColumn)
        .text('Bank: BCA', leftColumn + 10, doc.y)
        .text('Account: 6290346817', leftColumn + 10, doc.y + 15)
        .text('Name: Eko prambudi', leftColumn + 10, doc.y + 15);

    // Signature
    doc.moveDown(4)
        .text('Hormat Kami,', rightColumn)
        .moveDown(3)
        .text('WAKO PRINTING', rightColumn);

    return doc;
}

module.exports = {
    generateInvoicePDF,
    formatCurrency,
    formatDate
};
