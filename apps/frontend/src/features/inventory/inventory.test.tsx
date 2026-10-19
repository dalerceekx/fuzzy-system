import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
  signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
});

afterEach(() => resetClientState());

const arpa = () => api.server.db.items.find((item) => item.name === 'Arpa');
const movementPosts = () => api.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/movements'));

async function openItemDialog(view: ReturnType<typeof renderApp>, action: 'Xarid' | 'Sarflash') {
  await view.user.click(await screen.findByRole('button', { name: action }));
  return screen.findByRole('dialog');
}

describe('feed inventory', () => {
  it('shows feed items with server balances and last purchase prices', async () => {
    renderApp('/feed');
    const row = (await screen.findByRole('cell', { name: 'Arpa' })).closest('tr');
    expect(row).not.toBeNull();
    // 2000 − 450 − 300 + 500 − 500 = 1250 kg; last priced intake 3 400 so‘m.
    expect(within(row as HTMLElement).getByText('1 250 kg')).toBeInTheDocument();
    expect(await within(row as HTMLElement).findByText('3 400 so‘m/kg')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('4 250 000 so‘m')).toBeInTheDocument();
  });

  it('records a purchase with an Idempotency-Key, decimal strings and UZS', async () => {
    const view = renderApp(`/feed/${arpa()?.id ?? ''}`);
    const dialog = await openItemDialog(view, 'Xarid');
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '250,5');
    // The current price is suggested and can be changed.
    expect(within(dialog).getByLabelText(/narxi/)).toHaveValue('3400');
    await view.user.clear(within(dialog).getByLabelText(/narxi/));
    await view.user.type(within(dialog).getByLabelText(/narxi/), '3500');
    expect(within(dialog).getByText('876 750 so‘m')).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Xaridni saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const [request] = movementPosts();
    expect(request?.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(request?.body).toEqual({ type: 'IN', quantity: '250.5', unitCost: '3500', currency: 'UZS' });
    // The balance shown afterwards comes from the server.
    expect((await screen.findAllByText('1 500,5 kg')).length).toBeGreaterThan(0);
  });

  it('blocks consumption above the balance before calling the API', async () => {
    const view = renderApp(`/feed/${arpa()?.id ?? ''}`);
    const dialog = await openItemDialog(view, 'Sarflash');
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '5000');
    expect(within(dialog).getByText('Bu miqdor ombordagi qoldiqdan ko‘p.')).toBeInTheDocument();
    await view.user.click(within(dialog).getByRole('button', { name: 'Chiqimni saqlash' }));
    expect(await within(dialog).findByText('Omborda faqat 1 250 kg bor')).toBeInTheDocument();
    expect(movementPosts()).toHaveLength(0);
  });

  it('shows the server INSUFFICIENT_STOCK answer when stock changed meanwhile', async () => {
    const view = renderApp(`/feed/${arpa()?.id ?? ''}`);
    const dialog = await openItemDialog(view, 'Sarflash');
    // Another device consumed most of the stock after the page loaded.
    const item = arpa();
    if (item) item.quantity = '100.000';
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '200');
    await view.user.click(within(dialog).getByRole('button', { name: 'Chiqimni saqlash' }));
    expect(await within(dialog).findByText('Omborda yetarli emas: 100 kg bor')).toBeInTheDocument();
    expect(movementPosts()[0]?.status).toBe(409);
  });

  it('reuses the same Idempotency-Key when the same submission is retried', async () => {
    const view = renderApp(`/feed/${arpa()?.id ?? ''}`);
    const dialog = await openItemDialog(view, 'Sarflash');
    const item = arpa();
    if (item) item.quantity = '10.000';
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '20');
    await view.user.click(within(dialog).getByRole('button', { name: 'Chiqimni saqlash' }));
    await within(dialog).findByText(/Omborda yetarli emas/);
    await view.user.clear(within(dialog).getByLabelText(/Miqdor/));
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '5');
    await view.user.click(within(dialog).getByRole('button', { name: 'Chiqimni saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const keys = movementPosts().map((request) => request.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('feed warehouse management', () => {
  const itemPosts = () => api.requests.filter((request) => request.method === 'POST' && request.path === '/inventory/items');

  it('shows the warehouse value and warns about feeds below their minimum', async () => {
    renderApp('/feed');
    const stats = await screen.findByRole('region', { name: 'Yem ombori ko‘rsatkichlari' });
    // 1 250 × 3 400 + 3 400 × 1 500 + 600 × 2 500 + 120 × 4 800.
    expect(await within(stats).findByText('11 426 000 so‘m')).toBeInTheDocument();
    expect(screen.getByText('1 ta yem kam qoldi')).toBeInTheDocument();
    expect(screen.getByText(/^Omuxta yem:/, { selector: 'li' })).toHaveTextContent('Omuxta yem: 120 kg (minimal 200 kg)');
    const row = screen.getByRole('cell', { name: 'Omuxta yem' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('Kam qoldi')).toBeInTheDocument();
  });

  it('adds a feed with its quantity and price per kg in one step', async () => {
    const view = renderApp('/feed?new=1');
    const dialog = await screen.findByRole('dialog', { name: 'Yangi yem' });
    await view.user.type(within(dialog).getByLabelText(/Nomi/), 'Makkajo‘xori');
    await view.user.type(within(dialog).getByLabelText(/Boshlang‘ich miqdor/), '500');
    await view.user.type(within(dialog).getByLabelText(/1 kg narxi/), '3500');
    await view.user.type(within(dialog).getByLabelText(/Minimal qoldiq/), '100');
    await view.user.click(within(dialog).getByRole('button', { name: 'Saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(itemPosts()[0]?.body).toEqual({
      farmId: api.server.db.farms[0]?.id,
      category: 'FEED',
      name: 'Makkajo‘xori',
      unit: 'KG',
      unitPrice: '3500',
      minQuantity: '100',
      initialQuantity: '500',
    });
    const row = (await screen.findByRole('cell', { name: 'Makkajo‘xori' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('500 kg')).toBeInTheDocument();
    expect(within(row).getByText('3 500 so‘m/kg')).toBeInTheDocument();
    expect(within(row).getByText('1 750 000 so‘m')).toBeInTheDocument();
  });

  it('edits the price and minimum; a feed at its minimum is flagged', async () => {
    const view = renderApp('/feed');
    await view.user.click(await screen.findByRole('button', { name: 'Arpa: tahrirlash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Arpa: tahrirlash' });
    expect(within(dialog).getByLabelText(/1 kg narxi/)).toHaveValue('3400');
    await view.user.clear(within(dialog).getByLabelText(/1 kg narxi/));
    await view.user.type(within(dialog).getByLabelText(/1 kg narxi/), '3600');
    await view.user.type(within(dialog).getByLabelText(/Minimal qoldiq/), '1250');
    await view.user.click(within(dialog).getByRole('button', { name: 'Saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const patch = api.requests.find((request) => request.method === 'PATCH');
    expect(patch?.body).toEqual({ name: 'Arpa', unitPrice: '3600', minQuantity: '1250' });
    expect(await screen.findByText('2 ta yem kam qoldi')).toBeInTheDocument();
    const row = screen.getByRole('cell', { name: 'Arpa' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('3 600 so‘m/kg')).toBeInTheDocument();
    expect(within(row).getByText('Kam qoldi')).toBeInTheDocument();
  });

  it('changes the quantity only through an inventory adjustment', async () => {
    const view = renderApp('/feed');
    await view.user.click(await screen.findByRole('button', { name: 'Kepak: tahrirlash' }));
    const edit = await screen.findByRole('dialog', { name: 'Kepak: tahrirlash' });
    await view.user.click(within(edit).getByRole('button', { name: 'Miqdorni tuzatish' }));
    const dialog = await screen.findByRole('dialog', { name: /Inventarizatsiya tuzatishi: Kepak/ });
    expect(dialog).toBeInTheDocument();
  });

  it('deletes (archives) a feed only after confirmation', async () => {
    const view = renderApp('/feed');
    await view.user.click(await screen.findByRole('button', { name: 'Kepak: o‘chirish' }));
    const confirm = await screen.findByRole('dialog', { name: '“Kepak”ni o‘chirish' });
    expect(api.requests.some((request) => request.path.endsWith('/archive'))).toBe(false);
    await view.user.click(within(confirm).getByRole('button', { name: 'O‘chirish' }));
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'Kepak' })).not.toBeInTheDocument());
    expect(api.server.db.items.find((item) => item.name === 'Kepak')?.archivedAt).not.toBeNull();
  });
});
