import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  console.log("=== Menghapus semua data transaksi & master data ===");
  await db.fixedAssetDepreciation.deleteMany();
  await db.fixedAsset.deleteMany();
  await db.purchaseReturnLine.deleteMany();
  await db.purchaseReturn.deleteMany();
  await db.purchasePayment.deleteMany();
  await db.purchaseInvoiceLine.deleteMany();
  await db.purchaseInvoice.deleteMany();
  await db.goodsReceiptLine.deleteMany();
  await db.goodsReceipt.deleteMany();
  await db.purchaseOrderLine.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.salesReturnLine.deleteMany();
  await db.salesReturn.deleteMany();
  await db.salesReceipt.deleteMany();
  await db.salesInvoiceLine.deleteMany();
  await db.salesInvoice.deleteMany();
  await db.deliveryLine.deleteMany();
  await db.delivery.deleteMany();
  await db.salesOrderLine.deleteMany();
  await db.salesOrder.deleteMany();
  await db.salesQuotationLine.deleteMany();
  await db.salesQuotation.deleteMany();
  await db.itemStock.deleteMany();
  await db.project.deleteMany();
  await db.item.deleteMany();
  await db.itemCategory.deleteMany();
  await db.customer.deleteMany();
  await db.supplier.deleteMany();
  await db.employee.deleteMany();
  await db.department.deleteMany();
  await db.warehouse.deleteMany();
  await db.journalLine.deleteMany();
  await db.journalEntry.deleteMany();
  await db.accountMapping.deleteMany();
  await db.account.deleteMany();
  console.log("=== Selesai, database bersih ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("RESET FAILED", err);
    process.exit(1);
  });
