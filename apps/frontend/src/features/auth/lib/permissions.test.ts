import { describe, expect, it } from 'vitest';
import { matchesPath, navigationFor, tabIndexFor } from '@/widgets/tab-bar/navigation';
import { assignableRoles, can, canActOn, roleHome } from './permissions';

describe('role rules (mirroring the backend contract)', () => {
  it('sends each role to its own home', () => {
    expect(roleHome('FARMER')).toBe('/dashboard');
    expect(roleHome('SUPER_ADMIN')).toBe('/admin');
    expect(roleHome('SUPPORT')).toBe('/admin');
    expect(roleHome('VET')).toBe('/admin/medicines');
  });

  it('only SUPER_ADMIN grants admin roles', () => {
    expect(assignableRoles('SUPER_ADMIN')).toContain('ADMIN');
    expect(assignableRoles('ADMIN')).toEqual(['SUPPORT', 'VET', 'FARMER']);
    expect(assignableRoles('SUPPORT')).toEqual([]);
  });

  it('forbids self-actions and ADMIN acting on admins', () => {
    const admin = { id: 'a', role: 'ADMIN' as const };
    expect(canActOn(admin, { id: 'a', role: 'ADMIN' })).toBe(false);
    expect(canActOn(admin, { id: 'b', role: 'SUPER_ADMIN' })).toBe(false);
    expect(canActOn(admin, { id: 'c', role: 'FARMER' })).toBe(true);
    expect(canActOn({ id: 's', role: 'SUPPORT' }, { id: 'c', role: 'FARMER' })).toBe(false);
  });

  it('approval of medicines is VET-only', () => {
    expect(can.approveMedicines('VET')).toBe(true);
    expect(can.approveMedicines('SUPER_ADMIN')).toBe(false);
  });
});

describe('tab bar per role', () => {
  type Role = Parameters<typeof navigationFor>[0];
  /** "Label" for a link tab, "Label: a, b · c" for a sheet (groups split by " · "). */
  const tabs = (role: Role) =>
    navigationFor(role).map((tab) =>
      tab.kind === 'link'
        ? tab.label
        : `${tab.label}: ${tab.groups.map((group) => group.map((item) => item.label).join(', ')).join(' · ')}`,
    );
  const owner = (role: Role, pathname: string) => {
    const list = navigationFor(role);
    return list[tabIndexFor(list, pathname)]?.label;
  };

  it('farmers get Ombor · Bosh sahifa · Dorixona · Boshqa, with no expenses tab', () => {
    expect(tabs('FARMER')).toEqual([
      'Ombor: Yem ombori, Yem hisoblagich',
      'Bosh sahifa',
      'Dorixona: Dori ombori, Molim kasal',
      'Boshqa: Hayvonlar, Guruhlar, Hisobot · Fermalarim, Profil va sozlamalar',
    ]);
    expect(navigationFor('FARMER')[1]).toMatchObject({ kind: 'link', to: '/dashboard' });
  });

  it('puts every farmer page under its own tab', () => {
    for (const path of [
      '/feed',
      '/feed/i1',
      '/feed-calculator',
      '/feed-calculator/types/t1',
      '/feed-calculator/rations/r1/edit',
    ]) {
      expect(owner('FARMER', path)).toBe('Ombor');
    }
    expect(owner('FARMER', '/dashboard')).toBe('Bosh sahifa');
    for (const path of ['/medicines', '/medicines/stock/i1', '/diseases']) {
      expect(owner('FARMER', path)).toBe('Dorixona');
    }
    for (const path of ['/animals', '/animals/a1', '/animal-groups', '/reports', '/farms', '/profile', '/profile/email']) {
      expect(owner('FARMER', path)).toBe('Boshqa');
    }
  });

  it('super admins get administration sheets around their dashboard', () => {
    expect(tabs('SUPER_ADMIN')).toEqual([
      'Boshqaruv: Foydalanuvchilar, Rollar, Audit loglar',
      'Bosh sahifa',
      'Boshqa: Dorilar katalogi, Sozlamalar · Profil va sozlamalar',
    ]);
    expect(owner('SUPER_ADMIN', '/admin')).toBe('Bosh sahifa');
    expect(owner('SUPER_ADMIN', '/admin/users/u1')).toBe('Boshqaruv');
    expect(owner('SUPER_ADMIN', '/admin/medicines')).toBe('Boshqa');
  });

  it('support and vets see only what they may open', () => {
    expect(tabs('SUPPORT')).toEqual([
      'Boshqaruv: Foydalanuvchilar, Rollar',
      'Bosh sahifa',
      'Boshqa: Dorilar katalogi · Profil va sozlamalar',
    ]);
    // A vet's home is the medicines catalog: no admin sheet, no duplicate row.
    expect(tabs('VET')).toEqual(['Bosh sahifa', 'Boshqa: Profil va sozlamalar']);
    expect(navigationFor('VET')[0]).toMatchObject({ kind: 'link', to: '/admin/medicines' });
  });

  it('matches whole path segments only', () => {
    expect(matchesPath('/feed/i1', '/feed')).toBe(true);
    expect(matchesPath('/feed-calculator', '/feed')).toBe(false);
    expect(matchesPath('/animal-groups', '/animals')).toBe(false);
  });
});
