import { screen, waitFor } from '@testing-library/react';
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

const passwordInput = (label: RegExp) => screen.getByLabelText(label, { selector: 'input' });

describe('profile', () => {
  it('validates the new password on the client', async () => {
    const view = renderApp('/profile/password');
    await view.user.type(await screen.findByLabelText(/Joriy parol/, { selector: 'input' }), MOCK_PASSWORDS.farmer);
    await view.user.type(passwordInput(/^Yangi parol\*?$/), 'qisqa');
    await view.user.type(passwordInput(/takrorlang/), 'boshqa');
    await view.user.click(screen.getByRole('button', { name: 'Parolni almashtirish' }));
    expect(await screen.findByText('Parol kamida 8 ta belgidan iborat bo‘lsin')).toBeInTheDocument();
    expect(screen.getByText('Parollar mos emas')).toBeInTheDocument();
    expect(api.requests.some((request) => request.path === '/auth/password/change')).toBe(false);
  });

  it('maps a wrong current password to its field and keeps the user signed in', async () => {
    const view = renderApp('/profile/password');
    await view.user.type(await screen.findByLabelText(/Joriy parol/, { selector: 'input' }), 'Notogri123');
    await view.user.type(passwordInput(/^Yangi parol\*?$/), 'Yangi2026parol');
    await view.user.type(passwordInput(/takrorlang/), 'Yangi2026parol');
    await view.user.click(screen.getByRole('button', { name: 'Parolni almashtirish' }));
    expect(await screen.findByText('Joriy parol noto‘g‘ri')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/profile/password');
  });

  it('changes the password through the real endpoint', async () => {
    const view = renderApp('/profile/password');
    await view.user.type(await screen.findByLabelText(/Joriy parol/, { selector: 'input' }), MOCK_PASSWORDS.farmer);
    await view.user.type(passwordInput(/^Yangi parol\*?$/), 'Yangi2026parol');
    await view.user.type(passwordInput(/takrorlang/), 'Yangi2026parol');
    await view.user.click(screen.getByRole('button', { name: 'Parolni almashtirish' }));
    expect(await screen.findByText('Parol yangilandi')).toBeInTheDocument();
    const request = api.requests.find((candidate) => candidate.path === '/auth/password/change');
    expect(request?.body).toEqual({ currentPassword: MOCK_PASSWORDS.farmer, newPassword: 'Yangi2026parol' });
    expect(api.server.db.users.find((user) => user.phone === PHONES.farmer)?.password).toBe('Yangi2026parol');
  });

  it('is honest about email: no fake verification, just the unavailable state', async () => {
    renderApp('/profile/email');
    expect(await screen.findByText('Email qo‘shish va tasdiqlash hali backend’da mavjud emas')).toBeInTheDocument();
    expect(screen.getByText('Ulangan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kod yuborish/ })).not.toBeInTheDocument();
  });

  it('lists active sessions and marks the current device', async () => {
    renderApp('/profile/security');
    expect(await screen.findByText('Joriy qurilma')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Telefon + parol')).toBeInTheDocument());
    expect(screen.getAllByText('Tez orada')).toHaveLength(2);
  });
});
