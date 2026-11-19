// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { nameFields } from './nameFields';

const page = (html: string) => { document.body.innerHTML = html; const left = nameFields(document.body); return { left, name: (sel: string) => document.querySelector(sel)!.getAttribute('aria-label') }; };

describe('naming fields from what is on screen', () => {
  it('names a table field from its column heading and its row', () => {
    const p = page(`<table><thead><tr><th>Participant</th><th>Days</th><th>Bonus ×</th></tr></thead>
      <tbody><tr><td><input id="a" value="Dana Okafor"></td><td><input id="b" type="number" value="12"></td><td><select id="c"><option>1</option></select></td></tr></tbody></table>`);
    expect(p.name('#b')).toBe('Days, Dana Okafor');
    expect(p.name('#c')).toBe('Bonus ×, Dana Okafor');
    expect(p.name('#a')).toBe('Participant, 12');
    expect(p.left).toBe(0);
  });
  it('counts colspans and uses the heading row nearest the body', () => {
    const p = page(`<table><thead><tr><th colspan="2">Who</th><th>Money</th></tr><tr><th>Name</th><th>Role</th><th>Rate</th></tr></thead>
      <tbody><tr><th>Line 2101</th><td><input id="r"></td><td><input id="m"></td></tr></tbody></table>`);
    expect(p.name('#r')).toBe('Role, Line 2101');
    expect(p.name('#m')).toBe('Rate, Line 2101');
  });
  it('tells two fields in one cell apart by their placeholders', () => {
    const p = page(`<table><thead><tr><th>Scene</th><th>Call</th></tr></thead><tbody><tr><td>12</td><td><input id="x" placeholder="report"><input id="y" placeholder="on set"></td></tr></tbody></table>`);
    expect(p.name('#x')).toBe('Call, report, 12');
    expect(p.name('#y')).toBe('Call, on set, 12');
  });
  it('uses the label beside a field in a .ctl box, and a placeholder when that is all there is', () => {
    const p = page(`<div class="ctl"><label>Pages / day <span class="hint">about five</span></label><input id="a" type="number"></div><input id="b" placeholder="Working title">`);
    expect(p.name('#a')).toBe('Pages / day');
    expect(p.name('#b')).toBe('Working title');
  });
  it('leaves a field that has a name of its own, and reports the ones it cannot name', () => {
    const p = page(`<label for="a">Budget</label><input id="a"><label>Wrapped <input id="b"></label><input id="c" aria-label="Mine"><input id="d" title="Tip"><div><input id="e"></div>`);
    for (const id of ['#a', '#b', '#d']) expect(p.name(id)).toBeNull();
    expect(p.name('#c')).toBe('Mine');
    expect(p.left).toBe(1);
  });
  it('works a name out again when the row changes', () => {
    const p = page(`<table><thead><tr><th>Name</th><th>Days</th></tr></thead><tbody><tr><td>Ada</td><td><input id="d"></td></tr></tbody></table>`);
    expect(p.name('#d')).toBe('Days, Ada');
    document.querySelector('td')!.textContent = 'Bea';
    nameFields(document.body);
    expect(p.name('#d')).toBe('Days, Bea');
  });
});
