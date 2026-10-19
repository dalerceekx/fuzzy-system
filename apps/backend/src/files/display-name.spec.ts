import { sanitizeDisplayName } from './display-name.js';

describe('sanitizeDisplayName', () => {
  it.each([
    ['sigir rasmi.jpg', 'sigir rasmi.jpg'],
    ['../../etc/passwd.png', 'passwd.png'],
    ['/etc/passwd.png', 'passwd.png'],
    ['..\\..\\win.ini.png', 'win.ini.png'],
    ['C:\\Users\\me\\rasm.png', 'rasm.png'],
    ['%2e%2e%2fetc%2fpasswd.png', '%2e%2e%2fetc%2fpasswd.png'],
    ['a\u0000b\r\n.png', 'ab.png'],
    ['photo\u202Egnp.exe', 'photognp.exe'],
    ['...hidden.png', 'hidden.png'],
    ['Cafe\u0301.png', 'Café.png'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeDisplayName(input, 'png')).toBe(expected);
  });

  it.each(['', '../', '..', '   ', '/', '\u0000', undefined])(
    'falls back for %j',
    (input) => {
      expect(sanitizeDisplayName(input, 'pdf')).toBe('file.pdf');
    },
  );

  it('never contains a path separator and is at most 255 chars', () => {
    const name = sanitizeDisplayName(
      `${'a/'.repeat(10)}${'ж'.repeat(400)}.png`,
      'png',
    );
    expect(name).not.toMatch(/[/\\]/);
    expect(name.length).toBeLessThanOrEqual(255);
  });
});
