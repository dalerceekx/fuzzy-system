import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS, type MockRation } from '@/mocks/db';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import type { AnimalType } from './api/rations.api';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => resetClientState());

const item = (name: string) => api.server.db.items.find((candidate) => candidate.name === name);
const posts = (suffix: string) => api.requests.filter((request) => request.method === 'POST' && request.path.endsWith(suffix));
const stamp = '2026-10-10T09:00:00.000Z';

/** A saved bull ration: 10 head × 30 days, 8 kg barley + 5 kg hay per head per day. */
function seedRation(): MockRation {
  const db = api.server.db;
  const farmId = db.farms[0]?.id ?? '';
  const type: AnimalType = {
    id: crypto.randomUUID(),
    farmId,
    name: 'Buqa',
    profile: 'BULL',
    species: 'CATTLE',
    sex: 'MALE',
    isDefault: true,
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  db.rationAnimalTypes.push(type);
  const ration: MockRation = {
    id: crypto.randomUUID(),
    farmId,
    animalTypeId: type.id,
    name: 'Semirtirish',
    animalCount: 10,
    averageWeightKg: '450.00',
    ageMonths: 18,
    purpose: 'FATTENING',
    physiologicalState: null,
    milkYieldLiters: null,
    days: 30,
    notes: null,
    items: [
      { inventoryItemId: item('Arpa')?.id ?? '', dailyPerAnimal: '8.000', position: 0 },
      { inventoryItemId: item('Pichan')?.id ?? '', dailyPerAnimal: '5.000', position: 1 },
    ],
    archivedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  db.rations.push(ration);
  return ration;
}

const resultRow = (name: RegExp) => within(screen.getByRole('table', { name: 'Ratsion natijalari' })).getByRole('row', { name });
/** The header link (an empty type also shows one in its empty state). */
const newRationLink = async () => (await screen.findAllByRole('link', { name: 'Yangi ratsion' }))[0] as HTMLElement;

describe('feed calculator — animal categories', () => {
  it('shows Buqa, Sigir, Qo‘chqor, Qo‘y with herd counts and creates them only once', async () => {
    const view = renderApp('/feed-calculator');
    const list = await screen.findByRole('region', { name: 'Hayvon turlari' });
    const cards = await within(list).findAllByRole('link');
    expect(cards.map((card) => card.querySelector('.text-lg')?.textContent)).toEqual(['Buqa', 'Sigir', 'Qo‘chqor', 'Qo‘y']);
    // Herd: 3 cows, 1 bull, 2 ewes, 1 ram in the seed.
    expect(within(cards[1] as HTMLElement).getByText('Fermada: 3 bosh')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Yangi hayvon turi' })).toBeInTheDocument();

    view.unmount();
    renderApp('/feed-calculator');
    await screen.findAllByRole('link', { name: /Buqa/ });
    expect(api.server.db.rationAnimalTypes.filter((type) => type.isDefault)).toHaveLength(4);
  });

  it('adds a custom animal type', async () => {
    const view = renderApp('/feed-calculator');
    await view.user.click(await screen.findByRole('button', { name: 'Yangi hayvon turi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yangi hayvon turi' });
    await view.user.type(within(dialog).getByLabelText(/Nomi/), 'Echki');
    await view.user.click(within(dialog).getByRole('button', { name: 'Qo‘shish' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Echki' })).toBeInTheDocument();
    expect(posts('/rations/animal-types')[0]?.body).toEqual({
      farmId: api.server.db.farms[0]?.id,
      name: 'Echki',
      species: 'GOAT',
      profile: 'OTHER',
    });
  });

  it('asks each category for its own parameters (milk yield for cows only)', async () => {
    const view = renderApp('/feed-calculator');
    await view.user.click(await screen.findByRole('link', { name: /Sigir/ }));
    await view.user.click(await newRationLink());
    expect(await screen.findByLabelText(/Sut mahsuldorligi/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bo‘g‘oz' })).toBeInTheDocument();

    await view.router.navigate('/feed-calculator');
    await view.user.click(await screen.findByRole('link', { name: /Buqa/ }));
    await view.user.click(await newRationLink());
    expect(await screen.findByLabelText(/O‘rtacha vazni/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Sut mahsuldorligi/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Fiziologik holati/)).not.toBeInTheDocument();
  });
});

describe('feed calculator — rations', () => {
  it('builds a ration from warehouse feeds, calculates it live and saves it without touching stock', async () => {
    const view = renderApp('/feed-calculator');
    await view.user.click(await screen.findByRole('link', { name: /Buqa/ }));
    await view.user.click(await newRationLink());

    await view.user.type(await screen.findByLabelText(/Ratsion nomi/), 'Qishki semirtirish');
    await view.user.type(screen.getByLabelText(/Hayvonlar soni/), '10');
    await screen.findByRole('option', { name: /Arpa/ });
    await view.user.selectOptions(screen.getByLabelText('1-yem'), item('Arpa')?.id ?? '');
    await view.user.type(screen.getAllByLabelText(/Bir boshga, kuniga/)[0] as HTMLElement, '8');
    await view.user.click(screen.getByRole('button', { name: 'Yem qo‘shish' }));
    // A feed already in the ration is not offered twice.
    expect(within(screen.getByLabelText('2-yem')).queryByRole('option', { name: /Arpa/ })).not.toBeInTheDocument();
    await view.user.selectOptions(screen.getByLabelText('2-yem'), item('Pichan')?.id ?? '');
    await view.user.type(screen.getAllByLabelText(/Bir boshga, kuniga/)[1] as HTMLElement, '5');

    // 10 × (8 + 5) kg a day, 30 days; 80 × 3 400 + 50 × 1 500 so‘m a day.
    expect(resultRow(/^Kunlik yem sarfi/)).toHaveTextContent('130 kg');
    expect(resultRow(/^30 kunlik yem sarfi/)).toHaveTextContent('3 900 kg');
    expect(resultRow(/^Kunlik xarajat/)).toHaveTextContent('347 000 so‘m');
    expect(resultRow(/^Umumiy xarajat/)).toHaveTextContent('10 410 000 so‘m');
    // Barley: 2 400 kg needed, 1 250 kg in stock.
    expect(resultRow(/^Ombor holati/)).toHaveTextContent('Yetarli emas');
    expect(screen.getByText('1 150 kg yetishmaydi')).toBeInTheDocument();

    await view.user.click(screen.getByRole('button', { name: 'Ratsionni saqlash' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ratsion natijalari' })).toBeInTheDocument();
    const [create] = posts('/rations');
    expect(create?.body).toEqual({
      farmId: api.server.db.farms[0]?.id,
      animalTypeId: api.server.db.rationAnimalTypes.find((type) => type.profile === 'BULL')?.id,
      name: 'Qishki semirtirish',
      animalCount: 10,
      purpose: 'FATTENING',
      days: 30,
      items: [
        { inventoryItemId: item('Arpa')?.id, dailyPerAnimal: '8' },
        { inventoryItemId: item('Pichan')?.id, dailyPerAnimal: '5' },
      ],
    });
    // Calculating and saving never change the warehouse.
    expect(posts('/movements')).toHaveLength(0);
    expect(item('Arpa')?.quantity).toBe('1250.000');
  });

  it('issues the real consumption from the warehouse, all or nothing', async () => {
    const ration = seedRation();
    const view = renderApp(`/feed-calculator/rations/${ration.id}`);
    await view.user.click(await screen.findByRole('button', { name: 'Sarfni ombordan chiqarish' }));
    let dialog = await screen.findByRole('dialog', { name: 'Sarfni ombordan chiqarish' });
    // 30 days need 2 400 kg of barley: the whole issue is refused before the API.
    await view.user.click(within(dialog).getByRole('button', { name: '30 kun' }));
    expect(within(dialog).getByText('Omborda yetarli yem yo‘q')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Ombordan chiqarish' })).toBeDisabled();

    await view.user.click(within(dialog).getByRole('button', { name: '1 kun' }));
    await view.user.click(within(dialog).getByRole('button', { name: 'Ombordan chiqarish' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const [issue] = posts('/issue');
    expect(issue?.path).toBe(`/rations/${ration.id}/issue`);
    expect(issue?.body).toEqual({ days: 1 });
    expect(issue?.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(item('Arpa')?.quantity).toBe('1170.000');
    expect(item('Pichan')?.quantity).toBe('3350.000');
    const history = await screen.findByRole('list', { name: 'Sarf tarixi' });
    expect(await within(history).findByText(/1 kunlik · 10 bosh/)).toBeInTheDocument();
    expect(within(history).getByText(/Arpa: −80 kg/)).toBeInTheDocument();

    // Stock changed on another device: the server refuses and names the feed.
    const arpa = item('Arpa');
    if (arpa) arpa.quantity = '10.000';
    await view.user.click(screen.getByRole('button', { name: 'Sarfni ombordan chiqarish' }));
    dialog = await screen.findByRole('dialog', { name: 'Sarfni ombordan chiqarish' });
    await view.user.click(within(dialog).getByRole('button', { name: 'Ombordan chiqarish' }));
    expect(await within(dialog).findByText('Ombordagi qoldiq o‘zgargan')).toBeInTheDocument();
    expect(within(dialog).getByText(/Arpa: kerak 80 kg, bor 10 kg/)).toBeInTheDocument();
    expect(item('Pichan')?.quantity).toBe('3350.000');
  });

  it('reuses saved rations: edit, copy and delete', async () => {
    const ration = seedRation();
    const view = renderApp(`/feed-calculator/types/${ration.animalTypeId}`);
    const list = await screen.findByRole('list', { name: 'Buqa ratsionlari' });
    expect(within(list).getByRole('link', { name: 'Semirtirish' })).toBeInTheDocument();

    await view.user.click(within(list).getByRole('button', { name: 'Nusxalash' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ratsion natijalari' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Semirtirish (nusxa)' })).toBeInTheDocument();

    await view.user.click(screen.getByRole('link', { name: 'Ratsionni tahrirlash' }));
    const count = await screen.findByLabelText(/Hayvonlar soni/);
    expect(count).toHaveValue('10');
    await view.user.clear(count);
    await view.user.type(count, '12');
    expect(resultRow(/^Kunlik yem sarfi/)).toHaveTextContent('156 kg');
    await view.user.click(screen.getByRole('button', { name: 'Ratsionni saqlash' }));
    await screen.findByRole('heading', { level: 1, name: 'Ratsion natijalari' });
    const patch = api.requests.find((request) => request.method === 'PATCH');
    expect(patch?.body).toMatchObject({ animalCount: 12, averageWeightKg: '450', ageMonths: 18 });

    await view.user.click(await screen.findByRole('button', { name: 'O‘chirish' }));
    const confirm = await screen.findByRole('dialog', { name: '“Semirtirish (nusxa)” ratsionini o‘chirish' });
    await view.user.click(within(confirm).getByRole('button', { name: 'O‘chirish' }));
    // The list refetches after the delete: only the original remains.
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Buqa ratsionlari' })).getAllByRole('listitem')).toHaveLength(1),
    );
    expect(api.server.db.rations.find((saved) => saved.name === 'Semirtirish (nusxa)')?.archivedAt).not.toBeNull();
  });
});

describe('dashboard — today’s ration', () => {
  it('shows whether today’s ration was given and confirms it from its slide', async () => {
    seedRation();
    const view = renderApp('/dashboard');
    const card = await screen.findByRole('region', { name: 'Bugungi ratsion' });
    const slides = await within(card).findByRole('list', { name: 'Bugungi ratsionlar' });
    expect(within(slides).getByText('Hali berilmagan')).toBeInTheDocument();
    expect(within(card).getByText(/0 \/ 1 ta ratsion berildi/)).toBeInTheDocument();

    await view.user.click(within(slides).getByRole('button', { name: 'Berildi — tasdiqlash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bugungi ratsion berildimi?' });
    // One day only: no day picker in the confirmation.
    expect(within(dialog).queryByLabelText(/Necha kunlik sarf/)).not.toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Ha, berildi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(posts('/issue')[0]?.body).toEqual({ days: 1 });
    expect(item('Arpa')?.quantity).toBe('1170.000');
    expect(await within(card).findByText(/Bugun berildi/)).toBeInTheDocument();
    expect(within(card).getByText(/1 \/ 1 ta ratsion berildi/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Berildi — tasdiqlash' })).not.toBeInTheDocument();
  });
});
