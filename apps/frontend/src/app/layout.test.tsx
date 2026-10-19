import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { http } from '@/shared/api/client';
import { todayInTashkent } from '@/shared/lib/dates';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';
import { setViewportWidth } from '@/test/viewport';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
});

afterEach(() => resetClientState());

const tabBar = () => screen.findByRole('navigation', { name: 'Asosiy menyu' });
/** A sheet tab by its label; the low-stock badge may add ", N ta yem kam qoldi" to the name. */
const sheetButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}(, .*)?$`) });
/** Visible sheet (closed sheets are aria-hidden and inert). */
const sheet = (name: string) => screen.queryByRole('navigation', { name });
const tabLabels = (nav: HTMLElement) => [...nav.querySelectorAll('.tab-label')].map((label) => label.textContent);

describe('dashboard layout', () => {
  it('renders the farmer dashboard from API data with honest gaps', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    renderApp('/dashboard');
    const stats = await screen.findByRole('region', { name: 'Asosiy ko‘rsatkichlar' });
    expect(await within(stats).findByText('12')).toBeInTheDocument();
    // No groups API: a gap label instead of a fake zero.
    const groups = within(stats).getByText('Hayvon guruhlari').closest('a');
    expect(within(groups as HTMLElement).getByText('Tez orada')).toBeInTheDocument();
    expect(within(groups as HTMLElement).getByText('—')).toBeInTheDocument();
    const quickActions = screen.getByRole('region', { name: 'Tezkor amallar' });
    for (const action of ['Hayvon qo‘shish', 'Yem qo‘shish', 'Yem hisoblash', 'Xarajat kiritish']) {
      expect(within(quickActions).getByRole('link', { name: new RegExp(action) })).toBeInTheDocument();
    }
  });

  it('turns a 404 list endpoint into an "not deployed yet" state, not fake data', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const adapter = http.defaults.adapter;
    // Simulate a backend where the inventory module is not deployed yet.
    const original = api.server.handle.bind(api.server);
    api.server.handle = (request) =>
      request.path.startsWith('/inventory')
        ? { status: 404, body: { statusCode: 404, code: 'NOT_FOUND', message: 'Topilmadi', requestId: 'r' } }
        : original(request);
    renderApp('/feed');
    expect((await screen.findAllByText('Bu bo‘lim backend’da hali ishga tushirilmagan')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('cell', { name: 'Arpa' })).not.toBeInTheDocument();
    http.defaults.adapter = adapter;
  });
});

describe('tab bar', () => {
  it('shows Ombor · Bosh sahifa · Dorixona · Boshqa and no expenses tab', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    renderApp('/dashboard');
    const nav = await tabBar();
    expect(tabLabels(nav)).toEqual(['Ombor', 'Bosh sahifa', 'Dorixona', 'Boshqa']);
    expect(within(nav).getByRole('link', { name: 'Bosh sahifa' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Xarajatlar' })).not.toBeInTheDocument();
    expect(sheet('Ombor')).not.toBeInTheDocument();
  });

  it('marks the tab that owns the page', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/feed');
    await tabBar();
    expect(sheetButton('Ombor')).toHaveAttribute('aria-current', 'true');
    expect(sheetButton('Boshqa')).not.toHaveAttribute('aria-current');

    await view.router.navigate('/animals');
    await waitFor(() => expect(sheetButton('Boshqa')).toHaveAttribute('aria-current', 'true'));
    expect(sheetButton('Ombor')).not.toHaveAttribute('aria-current');

    await view.router.navigate('/feed-calculator');
    await waitFor(() => expect(sheetButton('Ombor')).toHaveAttribute('aria-current', 'true'));

    await view.router.navigate('/medicines');
    await waitFor(() => expect(sheetButton('Dorixona')).toHaveAttribute('aria-current', 'true'));
  });

  it('opens Dorixona after Bosh sahifa: Dori ombori and Molim kasal', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/dashboard');
    await tabBar();
    await view.user.click(sheetButton('Dorixona'));
    const pharmacy = sheet('Dorixona') as HTMLElement;
    expect(pharmacy).toHaveClass('center');
    expect(
      within(pharmacy)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Dori ombori', 'Molim kasal']);

    await view.user.click(within(pharmacy).getByRole('link', { name: 'Molim kasal' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Molim kasal' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Kasalliklar' })).toBeInTheDocument();
    expect(sheetButton('Dorixona')).toHaveAttribute('aria-current', 'true');
  });

  it('opens one sheet at a time and closes it with the same button, Escape, the shade or Bosh sahifa', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/dashboard');
    await tabBar();

    await view.user.click(sheetButton('Ombor'));
    expect(sheetButton('Ombor')).toHaveAttribute('aria-expanded', 'true');
    const ombor = sheet('Ombor') as HTMLElement;
    expect(
      within(ombor)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Yem ombori', 'Yem hisoblagich']);
    expect(ombor).toHaveClass('left');

    // Switching sheets: Ombor closes, Boshqa opens.
    await view.user.click(sheetButton('Boshqa'));
    expect(sheetButton('Ombor')).toHaveAttribute('aria-expanded', 'false');
    expect(sheet('Ombor')).not.toBeInTheDocument();
    const more = sheet('Boshqa') as HTMLElement;
    expect(
      within(more)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Hayvonlar', 'Guruhlar', 'Hisobot', 'Fermalarim', 'Profil va sozlamalar']);
    expect(within(more).queryByRole('link', { name: 'Yem hisoblagich' })).not.toBeInTheDocument();

    await view.user.click(sheetButton('Boshqa'));
    expect(sheet('Boshqa')).not.toBeInTheDocument();

    await view.user.click(sheetButton('Ombor'));
    await view.user.keyboard('{Escape}');
    expect(sheet('Ombor')).not.toBeInTheDocument();
    expect(sheetButton('Ombor')).toHaveFocus();

    await view.user.click(sheetButton('Ombor'));
    fireEvent.click(document.querySelector('.more-shade') as HTMLElement);
    expect(sheet('Ombor')).not.toBeInTheDocument();

    // Already on the dashboard: the home tab still closes the sheet.
    await view.user.click(sheetButton('Boshqa'));
    await view.user.click(screen.getByRole('link', { name: 'Bosh sahifa' }));
    expect(sheet('Boshqa')).not.toBeInTheDocument();
  });

  it('works the same on phones: a sheet row navigates and the sheet closes', async () => {
    setViewportWidth(390);
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/animals');
    expect(await screen.findByRole('list', { name: 'Hayvonlar ro‘yxati' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await view.user.click(sheetButton('Ombor'));
    await view.user.click(within(sheet('Ombor') as HTMLElement).getByRole('link', { name: 'Yem hisoblagich' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Yem hisoblagich' })).toBeInTheDocument();
    expect(sheet('Ombor')).not.toBeInTheDocument();
    expect(sheetButton('Ombor')).toHaveAttribute('aria-current', 'true');
  });

  it('counts low feeds (at/below their minimum or empty) on the Ombor tab', async () => {
    // Seed: Omuxta yem 120 kg with a 200 kg minimum; Kepak runs out here.
    const kepak = api.server.db.items.find((item) => item.name === 'Kepak');
    if (kepak) kepak.quantity = '0.000';
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    renderApp('/animals');
    await tabBar();
    expect(await screen.findByRole('button', { name: 'Ombor, 2 ta yem kam qoldi' })).toBeInTheDocument();
  });

  it('gives staff their own sheets around the role home', async () => {
    signIn(api, PHONES.support, MOCK_PASSWORDS.staff);
    const view = renderApp('/admin');
    const nav = await tabBar();
    expect(tabLabels(nav)).toEqual(['Boshqaruv', 'Bosh sahifa', 'Boshqa']);
    await view.user.click(sheetButton('Boshqaruv'));
    expect(
      within(sheet('Boshqaruv') as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Foydalanuvchilar', 'Rollar']);
  });
});

describe('expenses panel on the dashboard', () => {
  it('replaces the old /expenses page', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/expenses');
    expect(await screen.findByRole('heading', { level: 2, name: 'Xarajatlar' })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/dashboard');
    expect(view.router.state.location.hash).toBe('#xarajatlar');
  });

  it('filters purchases by month and category and shows three totals', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/dashboard');
    const panel = await screen.findByRole('region', { name: 'Xarajatlar' });
    expect(within(panel).getByLabelText('Oy')).toHaveValue(todayInTashkent().slice(0, 7));

    await view.user.click(within(panel).getByRole('button', { name: 'Barcha davr' }));
    expect(within(panel).getByLabelText('Oy')).toHaveValue('');
    const stats = within(panel).getByRole('region', { name: 'Xarajatlar ko‘rsatkichlari' });
    // Seed purchases: 6.4M + 1.7M + 7.5M + 1.5M + 4.8M of feed, 60 000 medicine, 150 000 equipment.
    expect(await within(stats).findByText('22 110 000 so‘m')).toBeInTheDocument();
    expect(within(stats).getByText('21 900 000 so‘m')).toBeInTheDocument();
    expect(within(stats).getByText('7')).toBeInTheDocument();
    // Every row comes from the warehouse and is read-only.
    expect(within(panel).getAllByText('Ombordan')).toHaveLength(7);

    await view.user.selectOptions(within(panel).getByLabelText('Toifa'), 'MEDICINE');
    expect(within(stats).getByText('60 000 so‘m')).toBeInTheDocument();
    expect(within(stats).getByText('0 so‘m')).toBeInTheDocument();
    expect(within(panel).getAllByText('Ombordan')).toHaveLength(1);
  });

  it('adds an expense as a priced stock purchase', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/dashboard');
    const panel = await screen.findByRole('region', { name: 'Xarajatlar' });
    await view.user.click(within(panel).getByRole('button', { name: 'Barcha davr' }));
    await view.user.click(within(panel).getByRole('button', { name: 'Xarajat qo‘shish' }));

    const picker = await screen.findByRole('dialog', { name: 'Xarajat qo‘shish' });
    await view.user.selectOptions(await within(picker).findByLabelText('Nima sotib olindi?'), 'Kepak');
    await view.user.click(within(picker).getByRole('button', { name: 'Davom etish' }));

    const dialog = await screen.findByRole('dialog', { name: 'Xarid qilish: Kepak' });
    await view.user.type(within(dialog).getByLabelText(/Miqdor/), '100');
    // The price starts from the item's current price (2 500); the farmer changes it.
    expect(within(dialog).getByLabelText(/narxi/)).toHaveValue('2500');
    await view.user.clear(within(dialog).getByLabelText(/narxi/));
    await view.user.type(within(dialog).getByLabelText(/narxi/), '2600');
    await view.user.click(within(dialog).getByRole('button', { name: 'Xaridni saqlash' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = api.requests.find((request) => request.method === 'POST' && request.path.endsWith('/movements'));
    expect(post?.body).toEqual({ type: 'IN', quantity: '100', unitCost: '2600', currency: 'UZS' });
    const stats = within(panel).getByRole('region', { name: 'Xarajatlar ko‘rsatkichlari' });
    expect(await within(stats).findByText('22 370 000 so‘m')).toBeInTheDocument();
  });
});
