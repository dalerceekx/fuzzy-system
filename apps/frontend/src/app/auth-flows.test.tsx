import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_MFA_CODE, MOCK_PASSWORDS } from '@/mocks/db';
import { PHONES, renderApp, resetClientState, setupMockApi, signIn, type TestApi } from '@/test/render';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
});

afterEach(() => resetClientState());

async function fillLogin(view: ReturnType<typeof renderApp>, phone: string, password: string) {
  await view.user.type(await screen.findByLabelText(/Telefon raqami/), phone);
  await view.user.type(screen.getByLabelText(/^Parol/, { selector: 'input' }), password);
  await view.user.click(screen.getByRole('button', { name: 'Kirish' }));
}

describe('authentication', () => {
  it('sends anonymous visitors of protected pages to the login page', async () => {
    const view = renderApp('/animals');
    expect(await screen.findByRole('heading', { name: 'Xush kelibsiz!' })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/login');
  });

  it('logs a farmer in with phone + password and opens the farmer dashboard', async () => {
    const view = renderApp('/login');
    await fillLogin(view, '+998 90 000 00 02', MOCK_PASSWORDS.farmer);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bosh sahifa' })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/dashboard');
    // Phone was normalized before it reached the API.
    const login = api.requests.find((request) => request.path === '/auth/login');
    expect(login?.body).toEqual({ phone: PHONES.farmer, password: MOCK_PASSWORDS.farmer });
  });

  it('returns the farmer to the page they originally asked for', async () => {
    const view = renderApp('/feed-calculator');
    await fillLogin(view, PHONES.farmer, MOCK_PASSWORDS.farmer);
    expect(await screen.findByRole('heading', { level: 1, name: 'Yem hisoblagich' })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/feed-calculator');
  });

  it('shows the backend message for wrong credentials and stays on the login page', async () => {
    const view = renderApp('/login');
    await fillLogin(view, PHONES.farmer, 'NotThePassword1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Telefon yoki parol noto‘g‘ri');
    expect(view.router.state.location.pathname).toBe('/login');
  });

  it('validates the form before calling the API', async () => {
    const view = renderApp('/login');
    await view.user.type(await screen.findByLabelText(/Telefon raqami/), '12345');
    await view.user.click(screen.getByRole('button', { name: 'Kirish' }));
    expect(await screen.findByText('Raqamni +998 90 123 45 67 ko‘rinishida kiriting')).toBeInTheDocument();
    expect(screen.getByText('Parolni kiriting')).toBeInTheDocument();
    expect(api.requests.some((request) => request.path === '/auth/login')).toBe(false);
  });

  it('enrols a first-time SUPER_ADMIN in TOTP before the admin area opens', async () => {
    const view = renderApp('/login');
    await fillLogin(view, PHONES.superAdmin, MOCK_PASSWORDS.superAdmin);
    expect(await screen.findByRole('heading', { name: 'Ikki bosqichli himoyani yoqing' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Authenticator uchun QR kod' })).toBeInTheDocument();
    await view.user.type(screen.getByLabelText(/Tasdiqlash kodi/), MOCK_MFA_CODE);
    await view.user.click(screen.getByRole('button', { name: 'Yoqish va kirish' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Boshqaruv paneli' })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/admin');
    // The setup endpoint ran exactly once (each call would rotate the secret).
    expect(api.requests.filter((request) => request.path === '/auth/mfa/setup')).toHaveLength(1);
  });

  it('asks an enrolled ADMIN for the TOTP code and rejects a wrong one', async () => {
    const view = renderApp('/login');
    await fillLogin(view, PHONES.admin, MOCK_PASSWORDS.staff);
    expect(await screen.findByRole('heading', { name: 'Ikki bosqichli tasdiqlash' })).toBeInTheDocument();
    await view.user.type(screen.getByLabelText(/Tasdiqlash kodi/), '000000');
    await view.user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kod noto‘g‘ri');
    await view.user.clear(screen.getByLabelText(/Tasdiqlash kodi/));
    await view.user.type(screen.getByLabelText(/Tasdiqlash kodi/), MOCK_MFA_CODE);
    await view.user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Boshqaruv paneli' })).toBeInTheDocument();
  });

  it('reports blocked accounts', async () => {
    const view = renderApp('/login');
    await fillLogin(view, '+998900000007', MOCK_PASSWORDS.staff);
    expect(await screen.findByRole('alert')).toHaveTextContent('Akkaunt bloklangan');
  });

  it('does not show demo account shortcuts unless enabled', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Xush kelibsiz!' });
    expect(screen.queryByText(/Demo akkauntlar/)).not.toBeInTheDocument();
  });
});

describe('session restore, logout and role routing', () => {
  it('restores the session after a reload via the refresh cookie', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    renderApp('/animals');
    expect(await screen.findByRole('heading', { level: 1, name: 'Hayvonlar' })).toBeInTheDocument();
  });

  it('blocks a farmer from the admin area', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { name: 'Ruxsat yo‘q' })).toBeInTheDocument();
    expect(api.requests.some((request) => request.path === '/admin/users')).toBe(false);
  });

  it('blocks staff from farmer pages and sends "/" to the role home', async () => {
    signIn(api, PHONES.support, MOCK_PASSWORDS.staff);
    const view = renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Boshqaruv paneli' })).toBeInTheDocument();
    await view.router.navigate('/feed');
    expect(await screen.findByRole('heading', { name: 'Ruxsat yo‘q' })).toBeInTheDocument();
  });

  it('keeps SUPPORT out of audit logs', async () => {
    signIn(api, PHONES.support, MOCK_PASSWORDS.staff);
    renderApp('/admin/audit-logs');
    expect(await screen.findByRole('heading', { name: 'Ruxsat yo‘q' })).toBeInTheDocument();
  });

  it('logs out through the profile menu and revokes the server session', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/dashboard');
    const trigger = await screen.findByRole('button', { name: /Profil: Demo Fermer/ });
    await view.user.click(trigger);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Profilim' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Email qo‘shish' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Parolni almashtirish' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Kirish usullari' })).toBeInTheDocument();
    await view.user.click(within(menu).getByRole('menuitem', { name: 'Chiqish' }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/login'));
    expect(api.server.db.sessions.every((session) => session.revoked)).toBe(true);
  });

  it('does not send the next person to the previous user’s last page after logout', async () => {
    signIn(api, PHONES.farmer, MOCK_PASSWORDS.farmer);
    const view = renderApp('/profile/security');
    await view.user.click(await screen.findByRole('button', { name: /Profil: Demo Fermer/ }));
    await view.user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Chiqish' }));
    await screen.findByRole('heading', { name: 'Xush kelibsiz!' });
    await fillLogin(view, PHONES.admin, MOCK_PASSWORDS.staff);
    await view.user.type(await screen.findByLabelText(/Tasdiqlash kodi/), MOCK_MFA_CODE);
    await view.user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Boshqaruv paneli' })).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/admin');
  });
});
