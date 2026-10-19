import { randomUUID } from 'node:crypto';
import {
  InventoryCategory,
  MedicineStatus,
  UserRole,
} from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import {
  createInventoryItem,
  createMedicine,
  createUser,
} from '../utils/factories.js';
import { createFarmer, ITEMS, type Farmer } from './inventory-helpers.js';

describe('Inventory items', () => {
  let testApp: TestApp;
  let farmer: Farmer;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['inventory'] });
    farmer = await createFarmer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const post = (body: object) =>
    testApp.http().post(ITEMS).set(farmer.auth.authHeader).send(body);

  describe('POST /inventory/items', () => {
    it('creates an item with zero stock and audits it', async () => {
      const res = await post({
        farmId: farmer.farm.id,
        name: '  Arpa yemi  ',
        category: 'FEED',
        unit: 'KG',
        batchNumber: 'B-1',
        expiresOn: '2027-03-31',
      }).expect(201);
      expect(res.body).toMatchObject({
        farmId: farmer.farm.id,
        name: 'Arpa yemi',
        category: 'FEED',
        unit: 'KG',
        quantity: '0.000',
        medicineId: null,
        batchNumber: 'B-1',
        expiresOn: '2027-03-31',
        openedAt: null,
        archivedAt: null,
      });
      const audit = await testApp.prisma.auditLog.findMany({
        where: { resourceId: res.body.id, action: 'inventory.item.created' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: farmer.user.id,
        actorRole: 'FARMER',
        resourceType: 'inventory_item',
      });
    });

    it('has no price or low-stock threshold unless given', async () => {
      const bare = await post({
        farmId: farmer.farm.id,
        name: 'Somon',
        category: 'FEED',
        unit: 'KG',
      }).expect(201);
      expect(bare.body).toMatchObject({ unitPrice: null, minQuantity: null });
      const priced = await post({
        farmId: farmer.farm.id,
        name: 'Kepak',
        category: 'FEED',
        unit: 'KG',
        unitPrice: '2800',
        minQuantity: '50.5',
      }).expect(201);
      expect(priced.body).toMatchObject({
        quantity: '0.000',
        unitPrice: '2800.00',
        minQuantity: '50.500',
      });
      // No initialQuantity: no stock movement.
      expect(
        await testApp.prisma.stockMovement.count({
          where: { itemId: priced.body.id },
        }),
      ).toBe(0);
    });

    it('records initialQuantity as a priced IN movement in the same transaction', async () => {
      const res = await post({
        farmId: farmer.farm.id,
        name: 'Makkajo‘xori',
        category: 'FEED',
        unit: 'KG',
        unitPrice: '3500',
        initialQuantity: '500',
      }).expect(201);
      expect(res.body).toMatchObject({
        quantity: '500.000',
        unitPrice: '3500.00',
      });
      const movements = await testApp.prisma.stockMovement.findMany({
        where: { itemId: res.body.id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: 'IN',
        reason: 'Boshlang‘ich qoldiq',
        currency: 'UZS',
        actorId: farmer.user.id,
        rationIssueId: null,
      });
      expect(movements[0].quantity.toFixed(3)).toBe('500.000');
      expect(movements[0].balanceAfter.toFixed(3)).toBe('500.000');
      expect(movements[0].unitCost?.toFixed(2)).toBe('3500.00');
      const audits = await testApp.prisma.auditLog.findMany({
        where: {
          OR: [
            { resourceId: res.body.id, action: 'inventory.item.created' },
            { resourceId: movements[0].id, action: 'inventory.stock.in' },
          ],
        },
      });
      expect(audits.map((a) => a.action).sort()).toEqual([
        'inventory.item.created',
        'inventory.stock.in',
      ]);
    });

    it('records an unpriced initial stock without unit cost', async () => {
      const res = await post({
        farmId: farmer.farm.id,
        name: 'Beda',
        category: 'FEED',
        unit: 'KG',
        initialQuantity: '0.001',
      }).expect(201);
      expect(res.body).toMatchObject({ quantity: '0.001', unitPrice: null });
      const [movement] = await testApp.prisma.stockMovement.findMany({
        where: { itemId: res.body.id },
      });
      expect(movement).toMatchObject({ unitCost: null, currency: null });
    });

    it.each([
      { initialQuantity: '0' },
      { initialQuantity: 5 },
      { initialQuantity: '1.0001' },
      { unitPrice: '-1' },
      { unitPrice: '1.001' },
      { unitPrice: 3500 },
      { minQuantity: '-1' },
      { minQuantity: null },
    ])('validates %o (400), creating nothing', async (patch) => {
      const name = `Narx ${randomUUID()}`;
      await post({
        farmId: farmer.farm.id,
        name,
        category: 'FEED',
        unit: 'KG',
        ...patch,
      }).expect(400);
      expect(
        await testApp.prisma.inventoryItem.count({ where: { name } }),
      ).toBe(0);
    });

    it('rejects a client-supplied quantity', async () => {
      const res = await post({
        farmId: farmer.farm.id,
        name: 'Yem',
        category: 'FEED',
        unit: 'KG',
        quantity: '1000',
      }).expect(400);
      expect(res.body.message).toEqual(['Ruxsat etilmagan maydon yuborildi']);
    });

    it('links an APPROVED medicine to a MEDICINE item', async () => {
      const medicine = await createMedicine(testApp.prisma, {
        status: MedicineStatus.APPROVED,
      });
      const res = await post({
        farmId: farmer.farm.id,
        name: 'Antibiotik',
        category: 'MEDICINE',
        unit: 'ML',
        medicineId: medicine.id,
        useWithinDaysAfterOpening: 28,
      }).expect(201);
      expect(res.body).toMatchObject({
        medicineId: medicine.id,
        useWithinDaysAfterOpening: 28,
      });
    });

    it.each([MedicineStatus.DRAFT, MedicineStatus.ARCHIVED])(
      'refuses a %s medicine (422 MEDICINE_NOT_APPROVED)',
      async (status) => {
        const medicine = await createMedicine(testApp.prisma, { status });
        const name = `Dori ${randomUUID()}`;
        const res = await post({
          farmId: farmer.farm.id,
          name,
          category: 'MEDICINE',
          unit: 'ML',
          medicineId: medicine.id,
        }).expect(422);
        expect(res.body.code).toBe('MEDICINE_NOT_APPROVED');
        expect(
          await testApp.prisma.inventoryItem.count({ where: { name } }),
        ).toBe(0);
      },
    );

    it('answers an unknown medicine exactly like an unapproved one', async () => {
      const res = await post({
        farmId: farmer.farm.id,
        name: 'Dori',
        category: 'MEDICINE',
        unit: 'ML',
        medicineId: randomUUID(),
      }).expect(422);
      expect(res.body.code).toBe('MEDICINE_NOT_APPROVED');
    });

    it('allows a medicine only on MEDICINE items', async () => {
      const medicine = await createMedicine(testApp.prisma, {
        status: MedicineStatus.APPROVED,
      });
      const res = await post({
        farmId: farmer.farm.id,
        name: 'Yem',
        category: 'FEED',
        unit: 'KG',
        medicineId: medicine.id,
      }).expect(400);
      expect(res.body.code).toBe('MEDICINE_CATEGORY_REQUIRED');
    });

    it('404s for an archived farm', async () => {
      const other = await createFarmer(testApp);
      await testApp.prisma.farm.update({
        where: { id: other.farm.id },
        data: { archivedAt: new Date() },
      });
      await testApp
        .http()
        .post(ITEMS)
        .set(other.auth.authHeader)
        .send({
          farmId: other.farm.id,
          name: 'Yem',
          category: 'FEED',
          unit: 'KG',
        })
        .expect(404);
    });

    it('cannot add an item to a farm being archived concurrently', async () => {
      const other = await createFarmer(testApp);
      const name = `Race ${randomUUID()}`;
      let pending: Promise<{ status: number; body: { code?: string } }>;
      let itemsSeenByArchiver = -1;
      // Plays FarmsService.archive: lock the farm, check it is empty, archive.
      await testApp.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM farms WHERE id = ${other.farm.id}::uuid FOR UPDATE`;
          pending = testApp
            .http()
            .post(ITEMS)
            .set(other.auth.authHeader)
            .send({ farmId: other.farm.id, name, category: 'FEED', unit: 'KG' })
            .then((r) => r);
          await new Promise((r) => setTimeout(r, 500));
          itemsSeenByArchiver = await tx.inventoryItem.count({
            where: { farmId: other.farm.id, archivedAt: null },
          });
          await tx.farm.update({
            where: { id: other.farm.id },
            data: { archivedAt: new Date() },
          });
        },
        { timeout: 10_000 },
      );
      const res = await pending!;
      expect(itemsSeenByArchiver).toBe(0);
      expect(res.status).toBe(404);
      expect(
        await testApp.prisma.inventoryItem.count({ where: { name } }),
      ).toBe(0);
    });

    it.each([
      { expiresOn: '2026-02-30' },
      { expiresOn: null },
      { useWithinDaysAfterOpening: 0 },
      { name: 'x'.repeat(121) },
      { unit: 'TON' },
      { farmId: 'not-a-uuid' },
    ])('validates %o', async (patch) => {
      await post({
        farmId: farmer.farm.id,
        name: 'Yem',
        category: 'FEED',
        unit: 'KG',
        ...patch,
      }).expect(400);
    });
  });

  describe('roles', () => {
    it.each([UserRole.VET, UserRole.SUPPORT])(
      '%s cannot use inventory routes (403)',
      async (role) => {
        const { user } = await createUser(testApp.prisma, { role });
        const auth = await loginAs(testApp, user);
        await testApp.http().get(ITEMS).set(auth.authHeader).expect(403);
      },
    );

    it('anonymous callers get 401', async () => {
      await testApp.http().get(ITEMS).expect(401);
    });
  });

  describe('GET /inventory/items', () => {
    let owner: Farmer;
    let secondFarmId: string;

    beforeAll(async () => {
      owner = await createFarmer(testApp);
      secondFarmId = (
        await testApp.prisma.farm.create({
          data: { ownerId: owner.user.id, name: 'Ikkinchi ferma' },
        })
      ).id;
      await createInventoryItem(testApp.prisma, {
        farmId: owner.farm.id,
        name: 'B yem',
        expiresOn: new Date('2027-01-01'),
      });
      await createInventoryItem(testApp.prisma, {
        farmId: owner.farm.id,
        name: 'A dori',
        category: InventoryCategory.OTHER,
        expiresOn: new Date('2026-12-01'),
      });
      await createInventoryItem(testApp.prisma, {
        farmId: secondFarmId,
        name: 'C uskuna',
        category: InventoryCategory.EQUIPMENT,
      });
      const archived = await createInventoryItem(testApp.prisma, {
        farmId: owner.farm.id,
        name: 'D arxiv',
      });
      await testApp.prisma.inventoryItem.update({
        where: { id: archived.id },
        data: { archivedAt: new Date() },
      });
    });

    const list = (query: Record<string, string | undefined>) =>
      testApp.http().get(ITEMS).query(query).set(owner.auth.authHeader);

    it('paginates own non-archived items', async () => {
      const res = await list({ limit: '2', sort: 'name' }).expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 2, total: 3 });
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
        'A dori',
        'B yem',
      ]);
      const page2 = await list({ limit: '2', page: '2', sort: 'name' }).expect(
        200,
      );
      expect(page2.body.items.map((i: { name: string }) => i.name)).toEqual([
        'C uskuna',
      ]);
    });

    it('filters by farm, category and archived state', async () => {
      const byFarm = await list({ farmId: secondFarmId }).expect(200);
      expect(byFarm.body.items.map((i: { name: string }) => i.name)).toEqual([
        'C uskuna',
      ]);
      const byCategory = await list({ category: 'OTHER' }).expect(200);
      expect(byCategory.body.total).toBe(1);
      const all = await list({ includeArchived: 'true' }).expect(200);
      expect(all.body.total).toBe(4);
    });

    it('sorts by expiry with undated items last', async () => {
      const res = await list({ sort: 'expiresOn' }).expect(200);
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
        'A dori',
        'B yem',
        'C uskuna',
      ]);
    });

    it.each([
      { limit: '101' },
      { page: '0' },
      { sort: 'quantity' },
      { sort: 'farm.ownerId' },
      { includeArchived: 'yes' },
      { farmId: 'x' },
      { category: 'X' },
    ])('rejects query %o', async (query) => {
      await list(query).expect(400);
    });
  });

  describe('GET/PATCH/open/archive', () => {
    it('reads one item', async () => {
      const item = await createInventoryItem(testApp.prisma, {
        farmId: farmer.farm.id,
        quantity: '12.5',
      });
      const res = await testApp
        .http()
        .get(`${ITEMS}/${item.id}`)
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(res.body).toMatchObject({ id: item.id, quantity: '12.500' });
      await testApp
        .http()
        .get(`${ITEMS}/not-a-uuid`)
        .set(farmer.auth.authHeader)
        .expect(400);
    });

    it('updates metadata only and never quantity', async () => {
      const item = await createInventoryItem(testApp.prisma, {
        farmId: farmer.farm.id,
        quantity: '3',
        batchNumber: 'OLD',
      });
      const res = await testApp
        .http()
        .patch(`${ITEMS}/${item.id}`)
        .set(farmer.auth.authHeader)
        .send({ name: 'Yangi nom', batchNumber: null, expiresOn: '2028-01-01' })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Yangi nom',
        batchNumber: null,
        expiresOn: '2028-01-01',
        quantity: '3.000',
      });
      for (const body of [{ quantity: '100' }, { farmId: farmer.farm.id }]) {
        await testApp
          .http()
          .patch(`${ITEMS}/${item.id}`)
          .set(farmer.auth.authHeader)
          .send(body)
          .expect(400);
      }
      const stored = await testApp.prisma.inventoryItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(stored.quantity.toFixed(3)).toBe('3.000');
    });

    it('sets and clears the price and the low-stock threshold', async () => {
      const item = await createInventoryItem(testApp.prisma, {
        farmId: farmer.farm.id,
        quantity: '7',
      });
      const url = `${ITEMS}/${item.id}`;
      const set = await testApp
        .http()
        .patch(url)
        .set(farmer.auth.authHeader)
        .send({ unitPrice: '1999.9', minQuantity: '10' })
        .expect(200);
      expect(set.body).toMatchObject({
        unitPrice: '1999.90',
        minQuantity: '10.000',
        quantity: '7.000',
      });
      const kept = await testApp
        .http()
        .patch(url)
        .set(farmer.auth.authHeader)
        .send({ name: 'Faqat nom' })
        .expect(200);
      expect(kept.body).toMatchObject({
        unitPrice: '1999.90',
        minQuantity: '10.000',
      });
      const cleared = await testApp
        .http()
        .patch(url)
        .set(farmer.auth.authHeader)
        .send({ unitPrice: null, minQuantity: null })
        .expect(200);
      expect(cleared.body).toMatchObject({
        unitPrice: null,
        minQuantity: null,
      });
      for (const body of [
        { unitPrice: '-5' },
        { minQuantity: 3 },
        { initialQuantity: '5' },
      ]) {
        await testApp
          .http()
          .patch(url)
          .set(farmer.auth.authHeader)
          .send(body)
          .expect(400);
      }
    });

    describe('MEDICINE shelf life', () => {
      const medicineItem = (
        expiresOn: string | null,
        useWithinDaysAfterOpening: number | null,
      ) =>
        createInventoryItem(testApp.prisma, {
          farmId: farmer.farm.id,
          category: InventoryCategory.MEDICINE,
          unit: 'ML',
          expiresOn: expiresOn ? new Date(`${expiresOn}T00:00:00Z`) : null,
          useWithinDaysAfterOpening,
          openedAt: new Date(),
        });
      const patch = (id: string, body: object) =>
        testApp
          .http()
          .patch(`${ITEMS}/${id}`)
          .set(farmer.auth.authHeader)
          .send(body);

      it.each([
        { expiresOn: null },
        { expiresOn: '2027-01-02' },
        { useWithinDaysAfterOpening: null },
        { useWithinDaysAfterOpening: 31 },
        { name: 'ok', expiresOn: '2026-12-01', useWithinDaysAfterOpening: 60 },
      ])('refuses to clear or extend: %o', async (body) => {
        const item = await medicineItem('2027-01-01', 30);
        const res = await patch(item.id, body).expect(409);
        expect(res.body.code).toBe('MEDICINE_SHELF_LIFE_LOCKED');
        const stored = await testApp.prisma.inventoryItem.findUniqueOrThrow({
          where: { id: item.id },
        });
        expect(stored).toMatchObject({
          name: item.name,
          expiresOn: item.expiresOn,
          useWithinDaysAfterOpening: 30,
        });
      });

      it('allows tightening, keeping, or setting missing values', async () => {
        const item = await medicineItem('2027-01-01', 30);
        const res = await patch(item.id, {
          expiresOn: '2026-12-31',
          useWithinDaysAfterOpening: 30,
        }).expect(200);
        expect(res.body).toMatchObject({
          expiresOn: '2026-12-31',
          useWithinDaysAfterOpening: 30,
        });
        const bare = await medicineItem(null, null);
        await patch(bare.id, {
          expiresOn: '2027-06-01',
          useWithinDaysAfterOpening: 14,
        }).expect(200);
      });
    });

    it('opens an item once', async () => {
      const item = await createInventoryItem(testApp.prisma, {
        farmId: farmer.farm.id,
      });
      const first = await testApp
        .http()
        .post(`${ITEMS}/${item.id}/open`)
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(first.body.openedAt).toEqual(expect.any(String));
      const second = await testApp
        .http()
        .post(`${ITEMS}/${item.id}/open`)
        .set(farmer.auth.authHeader)
        .expect(409);
      expect(second.body.code).toBe('ALREADY_OPENED');
      const stored = await testApp.prisma.inventoryItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(stored.openedAt?.toISOString()).toBe(first.body.openedAt);
    });

    it('archives with an audit row; archived items are read-only', async () => {
      const item = await createInventoryItem(testApp.prisma, {
        farmId: farmer.farm.id,
        quantity: '2',
      });
      const res = await testApp
        .http()
        .post(`${ITEMS}/${item.id}/archive`)
        .set(farmer.auth.authHeader)
        .expect(200);
      expect(res.body.archivedAt).toEqual(expect.any(String));
      const audit = await testApp.prisma.auditLog.findMany({
        where: { resourceId: item.id, action: 'inventory.item.archived' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: farmer.user.id,
        oldValue: { archivedAt: null },
        newValue: { quantity: '2.000' },
      });

      for (const [method, path, body] of [
        ['post', 'archive', undefined],
        ['post', 'open', undefined],
        ['patch', '', { name: 'X' }],
      ] as const) {
        const url = path
          ? `${ITEMS}/${item.id}/${path}`
          : `${ITEMS}/${item.id}`;
        const r = await testApp
          .http()
          [method](url)
          .set(farmer.auth.authHeader)
          .send(body);
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('INVENTORY_ITEM_ARCHIVED');
      }
      // Still readable (history).
      await testApp
        .http()
        .get(`${ITEMS}/${item.id}`)
        .set(farmer.auth.authHeader)
        .expect(200);
    });
  });
});
