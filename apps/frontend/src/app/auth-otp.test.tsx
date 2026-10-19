import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '@/features/auth/api/auth.api';
import type { VerificationState } from '@/features/auth/components/RegisterForm';
import { VerifyPhoneForm } from '@/features/auth/components/VerifyPhoneForm';
import { ApiError, NETWORK_ERROR_MESSAGE } from '@/shared/api/errors';
import { PHONES, renderApp, resetClientState, setupMockApi, type TestApi } from '@/test/render';

let api: TestApi;

beforeEach(() => {
  resetClientState();
  api = setupMockApi();
});

afterEach(() => {
  vi.useRealTimers();
  resetClientState();
});

function renderVerification(overrides: Partial<VerificationState> = {}) {
  const verification: VerificationState = {
    verificationId: crypto.randomUUID(),
    phone: '+998901234567',
    expiresIn: 300,
    resendAfter: 0,
    receivedAt: Date.now(),
    ...overrides,
  };
  const router = createMemoryRouter(
    [
      { path: '/register/verify', element: <VerifyPhoneForm verification={verification} /> },
      { path: '/login', element: <p>Kirish sahifasi</p> },
    ],
    { initialEntries: [{ pathname: '/register/verify', state: verification }] },
  );
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router, verification, user: userEvent.setup() };
}

describe('registration OTP integration', () => {
  it('validates and normalizes the phone, rejects a wrong code, then completes registration without an auth bypass', async () => {
    const view = renderApp('/register');
    await view.user.type(await screen.findByLabelText(/Ism va familiya/), 'Test Fermer');
    await view.user.type(screen.getByLabelText(/Telefon raqami/), '12345');
    await view.user.type(screen.getByLabelText(/^Parol/, { selector: 'input[name="password"]' }), 'SafePassword78');
    await view.user.type(screen.getByLabelText(/Parolni takrorlang/, { selector: 'input' }), 'SafePassword78');
    await view.user.click(screen.getByRole('button', { name: 'Ro‘yxatdan o‘tish' }));
    expect(await screen.findByText('Raqamni +998 90 123 45 67 ko‘rinishida kiriting')).toBeInTheDocument();
    expect(api.requests.some((request) => request.path === '/auth/otp/send')).toBe(false);

    await view.user.clear(screen.getByLabelText(/Telefon raqami/));
    await view.user.type(screen.getByLabelText(/Telefon raqami/), '90 123-45-67');
    await view.user.click(screen.getByRole('button', { name: 'Ro‘yxatdan o‘tish' }));
    await screen.findByRole('heading', { name: 'Telefonni tasdiqlang' });
    expect(api.requests.find((request) => request.path === '/auth/otp/send')?.body).toEqual({
      fullName: 'Test Fermer',
      phone: '+998901234567',
      password: 'SafePassword78',
    });
    expect(screen.getByRole('button', { name: /Kodni qayta yuborish \(60\)/ })).toBeDisabled();
    const code = screen.getByLabelText(/Tasdiqlash kodi/);
    expect(code).toHaveAttribute('maxlength', '6');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    const refreshes = api.requests.filter((request) => request.path === '/auth/refresh').length;
    await view.user.type(code, '000000');
    await view.user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kod noto‘g‘ri yoki muddati o‘tgan');
    expect(api.requests.filter((request) => request.path === '/auth/refresh')).toHaveLength(refreshes);
    expect(api.server.db.users.find((user) => user.phone === '+998901234567')?.status).toBe('PENDING_VERIFICATION');

    await view.user.clear(code);
    const issued = api.server.db.otps.find((otp) => otp.phone === '+998901234567');
    expect(issued).toBeDefined();
    await view.user.type(code, issued!.code);
    await view.user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    expect(await screen.findByText('Telefon raqami tasdiqlandi. Endi tizimga kirishingiz mumkin.')).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe('/login');
    expect(api.server.db.users.find((user) => user.phone === '+998901234567')?.status).toBe('ACTIVE');
    expect(api.server.db.sessions).toHaveLength(0);
    expect(api.requests.some((request) => request.path === '/auth/otp/verify')).toBe(true);
  });

  it('preserves password recovery through the shared OTP controls', async () => {
    const view = renderApp('/forgot-password');
    await view.user.type(await screen.findByLabelText(/Telefon raqami/), PHONES.farmer);
    await view.user.click(screen.getByRole('button', { name: 'Kod yuborish' }));
    await screen.findByRole('heading', { name: 'Yangi parol' });
    const code = api.server.db.otps.find((otp) => otp.phone === PHONES.farmer)?.code;
    expect(code).toBeDefined();
    await view.user.type(screen.getByLabelText(/SMS kodi/), code!);
    await view.user.type(screen.getByLabelText(/^Yangi parol/, { selector: 'input[name="newPassword"]' }), 'NewPassword78');
    await view.user.type(screen.getByLabelText(/Yangi parolni takrorlang/, { selector: 'input' }), 'NewPassword78');
    await view.user.click(screen.getByRole('button', { name: 'Parolni yangilash' }));
    expect(await screen.findByText('Parol yangilandi. Yangi parol bilan kiring.')).toBeInTheDocument();
    expect(api.server.db.users.find((user) => user.phone === PHONES.farmer)?.password).toBe('NewPassword78');
  });
});

describe('OTP deadlines and failure states', () => {
  it('rejects a restored expired challenge and persists the replacement deadlines on resend', async () => {
    const nextId = crypto.randomUUID();
    const resend = vi
      .spyOn(authApi, 'resendOtp')
      .mockResolvedValue({ verificationId: nextId, expiresIn: 120, resendAfter: 7, message: 'So‘rov qabul qilindi' });
    const view = renderVerification({ receivedAt: Date.now() - 310_000, resendAfter: 60 });
    expect(screen.getByRole('alert')).toHaveTextContent('Kod muddati tugadi. Yangi kod so‘rang.');
    expect(screen.getByRole('button', { name: 'Tasdiqlash' })).toBeDisabled();
    await view.user.click(screen.getByRole('button', { name: 'Kodni qayta yuborish' }));
    expect(await screen.findByRole('status')).toHaveTextContent('So‘rov qabul qilindi');
    expect(resend).toHaveBeenCalledTimes(1);
    expect(resend.mock.calls[0]?.[0]).toBe(view.verification.verificationId);
    expect(screen.queryByText('Kod muddati tugadi. Yangi kod so‘rang.')).not.toBeInTheDocument();
    expect(screen.getByText('Kod 2:00 davomida amal qiladi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kodni qayta yuborish (7)' })).toBeDisabled();
    expect(view.router.state.location.state).toMatchObject({ verificationId: nextId, expiresIn: 120, resendAfter: 7 });
    expect(screen.getByRole('button', { name: 'Tasdiqlash' })).toBeEnabled();
  });

  it('uses elapsed wall time after a suspended tab, including the configured cooldown and expiry', () => {
    vi.useFakeTimers();
    const view = renderVerification({ expiresIn: 30, resendAfter: 7 });
    expect(screen.getByRole('button', { name: 'Kodni qayta yuborish (7)' })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByRole('button', { name: 'Kodni qayta yuborish (3)' })).toBeDisabled();
    act(() => {
      vi.setSystemTime(view.verification.receivedAt + 31_000);
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: 'Kodni qayta yuborish' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Tasdiqlash' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Kod muddati tugadi');
    view.unmount();
  });

  it('honors the backend retry delay on rate limiting', async () => {
    vi.spyOn(authApi, 'resendOtp').mockRejectedValue(
      new ApiError({ status: 429, code: 'RATE_LIMITED', message: 'Biroz kuting', retryAfterSeconds: 18 }),
    );
    const view = renderVerification();
    await view.user.click(screen.getByRole('button', { name: 'Kodni qayta yuborish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('18 soniyadan keyin');
    expect(screen.getByRole('button', { name: 'Kodni qayta yuborish (18)' })).toBeDisabled();
  });

  it('prevents resend and duplicate verification while verification is pending', async () => {
    let complete: (value: { message: string }) => void = () => undefined;
    const verify = vi.spyOn(authApi, 'verifyPhone').mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const view = renderVerification();
    await view.user.type(screen.getByLabelText(/Tasdiqlash kodi/), '654321');
    await view.user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasdiqlash' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Kodni qayta yuborish' })).toBeDisabled();
    expect(screen.getByLabelText(/Tasdiqlash kodi/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    expect(verify).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete({ message: 'Tasdiqlandi' });
    });
    expect(await screen.findByText('Kirish sahifasi')).toBeInTheDocument();
  });

  it('clears the previous wrong-code error and entered code after a successful resend', async () => {
    vi.spyOn(authApi, 'verifyPhone').mockRejectedValue(
      new ApiError({ status: 400, code: 'OTP_INVALID', message: 'Kod noto‘g‘ri yoki muddati o‘tgan' }),
    );
    vi.spyOn(authApi, 'resendOtp').mockResolvedValue({
      verificationId: crypto.randomUUID(),
      expiresIn: 300,
      resendAfter: 60,
      message: 'So‘rov qabul qilindi',
    });
    const view = renderVerification();
    await view.user.type(screen.getByLabelText(/Tasdiqlash kodi/), '654321');
    await view.user.click(screen.getByRole('button', { name: 'Tasdiqlash' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kod noto‘g‘ri');
    await view.user.click(screen.getByRole('button', { name: 'Kodni qayta yuborish' }));
    await screen.findByRole('status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Tasdiqlash kodi/)).toHaveValue('');
  });

  it('keeps the current challenge and code on an SMS request failure', async () => {
    vi.spyOn(authApi, 'resendOtp').mockRejectedValue(
      new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }),
    );
    const view = renderVerification();
    await view.user.type(screen.getByLabelText(/Tasdiqlash kodi/), '654321');
    await view.user.click(screen.getByRole('button', { name: 'Kodni qayta yuborish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR_MESSAGE);
    expect(screen.getByLabelText(/Tasdiqlash kodi/)).toHaveValue('654321');
    expect(view.router.state.location.state.verificationId).toBe(view.verification.verificationId);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
