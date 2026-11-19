import { describe, expect, it } from 'vitest';
import { isPlainColor, plainColor } from './color';

describe('a colour from a project file', () => {
  it('lets plain colours through', () => {
    for (const ok of [
      '#fff',
      '#15151b',
      '#15151bcc',
      'rgb(1, 2, 3)',
      'rgba(1,2,3,.5)',
      'hsl(210 40% 20%)',
      'oklch(0.7 0.1 200 / 50%)',
      'rebeccapurple',
      ' #abc ',
      'transparent',
    ])
      expect(isPlainColor(ok)).toBe(true);
  });
  it('stops anything that could fetch, run or break out of the declaration', () => {
    for (const bad of [
      'url(http://example.invalid/x.png)',
      'URL(//example.invalid/x)',
      'url("data:image/png;base64,AAAA")',
      'image-set(url(x) 1x)',
      'rgb(0,0,0) url(http://example.invalid/x)',
      'red; background-image: url(http://example.invalid/x)',
      'var(--x)',
      'expression(alert(1))',
      '#fff url(x)',
      'linear-gradient(red, blue)',
      'rgb(url(x))',
      '',
      '  ',
      'url',
      'inherit',
      '#ggg',
      'red}',
      5,
      null,
      undefined,
      {},
      ['#fff'],
    ])
      expect(isPlainColor(bad)).toBe(false);
    expect(plainColor('url(http://example.invalid/x.png)')).toBe('transparent');
    expect(plainColor('nope()', '#000000')).toBe('#000000');
    expect(plainColor(' #ABC ')).toBe('#ABC');
  });
});
