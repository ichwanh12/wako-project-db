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
    return new Date(date).toLocaleDateString('id-ID');
}

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

module.exports = {
    generateInvoicePDF,
    formatCurrency,
    formatDate
};
