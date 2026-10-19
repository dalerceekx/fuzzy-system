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

const lastRequest = (method: string, pathPrefix: string) =>
  [...api.requests].reverse().find((request) => request.method === method && request.path.startsWith(pathPrefix));

describe('animals', () => {
  it('lists every animal of the farm and filters locally by search and species', async () => {
    const view = renderApp('/animals');
    expect(await screen.findByText('12 ta hayvon')).toBeInTheDocument();
    await view.user.type(screen.getByLabelText('Qidirish'), 'oqqiz');
    await waitFor(() => expect(screen.getByText('1 ta hayvon')).toBeInTheDocument());
    expect(screen.getByRole('cell', { name: /UZ-001/ })).toBeInTheDocument();
    await view.user.clear(screen.getByLabelText('Qidirish'));
    await view.user.selectOptions(screen.getByLabelText('Hayvon turi'), 'SHEEP');
    await waitFor(() => expect(screen.getByText('4 ta hayvon')).toBeInTheDocument());
    // Filters are applied client-side over the full list — no unknown query params.
    for (const request of api.requests.filter((candidate) => candidate.path === '/animals')) {
      expect(Object.keys(request.query).sort()).toEqual(expect.arrayContaining(['farmId', 'limit', 'page']));
      expect(request.query).not.toHaveProperty('q');
    }
  });

  it('creates an animal with backend-compatible fields (decimal as string, no empty fields)', async () => {
    const view = renderApp('/animals?new=1');
    const dialog = await screen.findByRole('dialog', { name: 'Hayvon qo‘shish' });
    await view.user.selectOptions(within(dialog).getByLabelText(/Hayvon turi/), 'GOAT');
    await view.user.type(within(dialog).getByLabelText(/Birka raqami/), 'UZ-777');
    await view.user.type(within(dialog).getByLabelText(/Vazni/), '35,5');
    await view.user.click(within(dialog).getByRole('button', { name: 'Saqlash' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const request = lastRequest('POST', '/animals');
    expect(request?.body).toEqual({
      farmId: api.server.db.farms[0]?.id,
      species: 'GOAT',
      sex: 'FEMALE',
      tagNumber: 'UZ-777',
      weightKg: '35.5',
    });
    expect(await screen.findByText('UZ-777 raqamli hayvon qo‘shildi')).toBeInTheDocument();
  });

  it('validates input and maps a duplicate tag to the field', async () => {
    const view = renderApp('/animals?new=1');
    const dialog = await screen.findByRole('dialog', { name: 'Hayvon qo‘shish' });
    await view.user.type(within(dialog).getByLabelText(/Vazni/), '6000');
    await view.user.click(within(dialog).getByRole('button', { name: 'Saqlash' }));
    expect(await within(dialog).findByText('Birka raqamini kiriting')).toBeInTheDocument();
    expect(within(dialog).getByText('Qiymat 5000 dan oshmasin')).toBeInTheDocument();
    expect(lastRequest('POST', '/animals')).toBeUndefined();

    await view.user.type(within(dialog).getByLabelText(/Birka raqami/), 'UZ-001');
    await view.user.clear(within(dialog).getByLabelText(/Vazni/));
    await view.user.click(within(dialog).getByRole('button', { name: 'Saqlash' }));
    expect(await within(dialog).findByText('Bu birka raqami fermada allaqachon bor')).toBeInTheDocument();
  });

  it('edits with a PATCH that never carries farmId', async () => {
    const animal = api.server.db.animals[0];
    const view = renderApp(`/animals/${animal?.id ?? ''}`);
    await view.user.click(await screen.findByRole('button', { name: 'Tahrirlash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hayvonni tahrirlash' });
    const name = within(dialog).getByLabelText(/Laqabi/);
    await view.user.clear(name);
    await view.user.type(name, 'Oqbosh');
    await view.user.click(within(dialog).getByRole('button', { name: 'Saqlash' }));
    await waitFor(() => expect(lastRequest('PATCH', '/animals/')).toBeDefined());
    expect(lastRequest('PATCH', '/animals/')?.body).toEqual({ name: 'Oqbosh' });
  });

  it('archives with a confirmation and a reason (no delete)', async () => {
    const animal = api.server.db.animals[1];
    const view = renderApp(`/animals/${animal?.id ?? ''}`);
    await view.user.click(await screen.findByRole('button', { name: 'Arxivlash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hayvonni arxivlash' });
    await view.user.selectOptions(within(dialog).getByLabelText(/Sabab/), 'Sotildi');
    await view.user.type(within(dialog).getByLabelText(/Izoh/), 'Bozorda');
    await view.user.click(within(dialog).getByRole('button', { name: 'Arxivlash' }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/animals'));
    expect(lastRequest('POST', `/animals/${animal?.id ?? ''}/archive`)?.body).toEqual({ reason: 'Sotildi: Bozorda' });
    expect(api.requests.some((request) => request.method === 'DELETE')).toBe(false);
  });
});
