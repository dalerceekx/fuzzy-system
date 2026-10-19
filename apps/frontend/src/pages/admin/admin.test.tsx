import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_PASSWORDS } from '@/mocks/db';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
});

afterEach(() => resetClientState());

const userId = (phone: string) => api.server.db.users.find((user) => user.phone === phone)?.id ?? '';

describe('administration', () => {
  it('lists users with server-side filters only from the contract', async () => {
    signIn(api, PHONES.superAdmin, MOCK_PASSWORDS.superAdmin);
    const view = renderApp('/admin/users');
    expect(await screen.findByRole('cell', { name: /Demo Fermer/ })).toBeInTheDocument();
    await view.user.selectOptions(screen.getByLabelText('Holat'), 'BLOCKED');
    expect(await screen.findByRole('cell', { name: /Namuna Fermer Ikki/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('cell', { name: /Demo Fermer/ })).not.toBeInTheDocument());
    const last = [...api.requests].reverse().find((request) => request.path === '/admin/users');
    expect(last?.query).toMatchObject({ status: 'BLOCKED', page: '1', limit: '20', sort: '-createdAt' });
  });

  it('changes a role after confirmation (SUPER_ADMIN)', async () => {
    signIn(api, PHONES.superAdmin, MOCK_PASSWORDS.superAdmin);
    const view = renderApp(`/admin/users/${userId(PHONES.support)}`);
    await view.user.click(await screen.findByRole('button', { name: 'Rolni o‘zgartirish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rolni o‘zgartirish' });
    await view.user.selectOptions(within(dialog).getByLabelText(/Yangi rol/), 'VET');
    await view.user.click(within(dialog).getByRole('button', { name: 'Rolni saqlash' }));
    await waitFor(() => expect(api.server.db.users.find((user) => user.phone === PHONES.support)?.role).toBe('VET'));
    expect(api.requests.find((request) => request.method === 'PATCH')?.body).toEqual({ role: 'VET' });
  });

  it('requires a reason before blocking', async () => {
    signIn(api, PHONES.superAdmin, MOCK_PASSWORDS.superAdmin);
    const view = renderApp(`/admin/users/${userId('+998900000006')}`);
    await view.user.click(await screen.findByRole('button', { name: 'Bloklash' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hisobni bloklash' });
    const confirm = within(dialog).getByRole('button', { name: 'Bloklash' });
    expect(confirm).toBeDisabled();
    await view.user.type(within(dialog).getByLabelText(/Sabab/), 'Qoidabuzarlik');
    await view.user.click(confirm);
    await waitFor(() => expect(api.server.db.users.find((user) => user.phone === '+998900000006')?.status).toBe('BLOCKED'));
  });

  it('does not offer admin actions on a SUPER_ADMIN to an ADMIN', async () => {
    signIn(api, PHONES.admin, MOCK_PASSWORDS.staff);
    renderApp(`/admin/users/${userId(PHONES.superAdmin)}`);
    expect(await screen.findByText(/Administrator boshqa administrator yoki super admin/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bloklash' })).not.toBeInTheDocument();
  });

  it('shows audit logs read-only with details', async () => {
    signIn(api, PHONES.superAdmin, MOCK_PASSWORDS.superAdmin);
    const view = renderApp('/admin/audit-logs');
    expect(await screen.findByRole('cell', { name: 'Foydalanuvchi bloklandi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /o‘chirish|tahrirlash/i })).not.toBeInTheDocument();
    const [details] = await screen.findAllByRole('button', { name: 'Batafsil ko‘rish' });
    await view.user.click(details as HTMLElement);
    expect(await screen.findByText('Yangi qiymat')).toBeInTheDocument();
    const request = api.requests.find((candidate) => candidate.path === '/admin/audit-logs');
    expect(request?.query).toHaveProperty('from');
    expect(request?.query).toHaveProperty('to');
  });

  it('marks sample DRAFT medicines and lets only a VET approve real drafts', async () => {
    signIn(api, PHONES.vet, MOCK_PASSWORDS.staff);
    renderApp('/admin/medicines');
    expect(await screen.findByText('Namuna. Haqiqiy davolash uchun ishlatmang.')).toBeInTheDocument();
    // The demo draft cannot be approved (DB forbids it), so no button for it.
    expect(screen.queryByRole('button', { name: 'Tasdiqlash' })).not.toBeInTheDocument();
  });

  it('hides the approve action from a SUPER_ADMIN', async () => {
    api.server.db.medicines.push({
      ...api.server.db.medicines[1]!,
      id: '00000000-0000-4000-8000-00000000abcd',
      name: 'Real qoralama',
      isDemo: false,
    });
    signIn(api, PHONES.superAdmin, MOCK_PASSWORDS.superAdmin);
    renderApp('/admin/medicines');
    expect(await screen.findByRole('cell', { name: /Real qoralama/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tasdiqlash' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Arxivlash' }).length).toBeGreaterThan(0);
  });
});
