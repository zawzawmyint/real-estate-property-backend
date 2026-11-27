import type { Transaction } from '../../infrastructure/database/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const propertyImportRepository = {
  lock(id: string, tx: Transaction) {
    return tx.$executeRaw`UPDATE PropertyImportReceipt SET id=id WHERE id=${id}`;
  },

  receipt(id: string, tx: Transaction) {
    return tx.propertyImportReceipt.findUnique({ where: { id } });
  },

  create(data: Prisma.PropertyUncheckedCreateInput, tx: Transaction) {
    return tx.property.create({
      data,
      select: {
        id: true,
        title: true,
        type: true,
        purpose: true,
        priceFils: true,
        city: true,
        community: true,
        bedrooms: true,
        bathrooms: true,
        areaHundredths: true,
        publishingState: true,
        availability: true,
        featured: true,
        isDemo: true,
        ownerName: true,
        ownerPhone: true,
        description: true,
      },
    });
  },

  saveReceipt(
    data: Prisma.PropertyImportReceiptUncheckedCreateInput,
    tx: Transaction,
  ) {
    return tx.propertyImportReceipt.create({ data });
  },
};
