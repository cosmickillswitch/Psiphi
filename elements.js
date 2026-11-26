/* Psi Phi Studio · the 118 elements: symbol, name, standard atomic weight, category, table position and electron shells.
   Shared by the Atom (3D) and the Periodic table (2D). */
(function () {
  'use strict';
  const RAW = 'H Hydrogen 1.008|He Helium 4.0026|Li Lithium 6.94|Be Beryllium 9.0122|B Boron 10.81|C Carbon 12.011|N Nitrogen 14.007|O Oxygen 15.999|F Fluorine 18.998|Ne Neon 20.180|' +
    'Na Sodium 22.990|Mg Magnesium 24.305|Al Aluminium 26.982|Si Silicon 28.085|P Phosphorus 30.974|S Sulfur 32.06|Cl Chlorine 35.45|Ar Argon 39.95|' +
    'K Potassium 39.098|Ca Calcium 40.078|Sc Scandium 44.956|Ti Titanium 47.867|V Vanadium 50.942|Cr Chromium 51.996|Mn Manganese 54.938|Fe Iron 55.845|Co Cobalt 58.933|Ni Nickel 58.693|Cu Copper 63.546|Zn Zinc 65.38|Ga Gallium 69.723|Ge Germanium 72.630|As Arsenic 74.922|Se Selenium 78.971|Br Bromine 79.904|Kr Krypton 83.798|' +
    'Rb Rubidium 85.468|Sr Strontium 87.62|Y Yttrium 88.906|Zr Zirconium 91.224|Nb Niobium 92.906|Mo Molybdenum 95.95|Tc Technetium [98]|Ru Ruthenium 101.07|Rh Rhodium 102.91|Pd Palladium 106.42|Ag Silver 107.87|Cd Cadmium 112.41|In Indium 114.82|Sn Tin 118.71|Sb Antimony 121.76|Te Tellurium 127.60|I Iodine 126.90|Xe Xenon 131.29|' +
    'Cs Caesium 132.91|Ba Barium 137.33|La Lanthanum 138.91|Ce Cerium 140.12|Pr Praseodymium 140.91|Nd Neodymium 144.24|Pm Promethium [145]|Sm Samarium 150.36|Eu Europium 151.96|Gd Gadolinium 157.25|Tb Terbium 158.93|Dy Dysprosium 162.50|Ho Holmium 164.93|Er Erbium 167.26|Tm Thulium 168.93|Yb Ytterbium 173.05|Lu Lutetium 174.97|' +
    'Hf Hafnium 178.49|Ta Tantalum 180.95|W Tungsten 183.84|Re Rhenium 186.21|Os Osmium 190.23|Ir Iridium 192.22|Pt Platinum 195.08|Au Gold 196.97|Hg Mercury 200.59|Tl Thallium 204.38|Pb Lead 207.2|Bi Bismuth 208.98|Po Polonium [209]|At Astatine [210]|Rn Radon [222]|' +
    'Fr Francium [223]|Ra Radium [226]|Ac Actinium [227]|Th Thorium 232.04|Pa Protactinium 231.04|U Uranium 238.03|Np Neptunium [237]|Pu Plutonium [244]|Am Americium [243]|Cm Curium [247]|Bk Berkelium [247]|Cf Californium [251]|Es Einsteinium [252]|Fm Fermium [257]|Md Mendelevium [258]|No Nobelium [259]|Lr Lawrencium [266]|' +
    'Rf Rutherfordium [267]|Db Dubnium [268]|Sg Seaborgium [269]|Bh Bohrium [270]|Hs Hassium [269]|Mt Meitnerium [278]|Ds Darmstadtium [281]|Rg Roentgenium [282]|Cn Copernicium [285]|Nh Nihonium [286]|Fl Flerovium [289]|Mc Moscovium [290]|Lv Livermorium [293]|Ts Tennessine [294]|Og Oganesson [294]';

  const CATS = {
    alkali: { label: 'Alkali metal', color: '#F28B82' }, alkaline: { label: 'Alkaline earth metal', color: '#F6B26B' },
    transition: { label: 'Transition metal', color: '#E8C46A' }, post: { label: 'Post-transition metal', color: '#9FD4A3' },
    metalloid: { label: 'Metalloid', color: '#7DD3C0' }, nonmetal: { label: 'Reactive non-metal', color: '#7FB7F5' },
    halogen: { label: 'Halogen', color: '#A99CF2' }, noble: { label: 'Noble gas', color: '#E59CE0' },
    lanthanide: { label: 'Lanthanide', color: '#F5A3B8' }, actinide: { label: 'Actinide', color: '#D7A0F0' },
    unknown: { label: 'Unknown properties', color: '#A8ADB8' }
  };
  const BLOCKS = { s: { label: 's-block', color: '#F28B82' }, p: { label: 'p-block', color: '#7FB7F5' }, d: { label: 'd-block', color: '#E8C46A' }, f: { label: 'f-block', color: '#9FD4A3' } };
  const IN = (z, list) => list.includes(z);
  function category(z) {
    if (IN(z, [3, 11, 19, 37, 55, 87])) return 'alkali';
    if (IN(z, [4, 12, 20, 38, 56, 88])) return 'alkaline';
    if (z >= 57 && z <= 71) return 'lanthanide';
    if (z >= 89 && z <= 103) return 'actinide';
    if (z >= 109) return 'unknown';
    if (IN(z, [2, 10, 18, 36, 54, 86])) return 'noble';
    if (IN(z, [9, 17, 35, 53, 85])) return 'halogen';
    if (IN(z, [5, 14, 32, 33, 51, 52])) return 'metalloid';
    if (IN(z, [1, 6, 7, 8, 15, 16, 34])) return 'nonmetal';
    if (IN(z, [13, 31, 49, 50, 81, 82, 83, 84])) return 'post';
    return 'transition';
  }
  // period and group; the f-block (57–71, 89–103) sits in the two rows under the table
  function place(z) {
    const starts = [1, 3, 11, 19, 37, 55, 87, 119];
    let per = 1; while (z >= starts[per]) per++;
    const i = z - starts[per - 1];
    let group = null, row = per, col;
    if (per === 1) group = z === 1 ? 1 : 18;
    else if (per <= 3) group = i < 2 ? i + 1 : i + 10;
    else if (per <= 5) group = i + 1;
    else if (i < 2) group = i + 1;
    else if (i <= 16) { row = per + 3; col = i + 1; }        // f row: La…Lu / Ac…Lr under groups 3–17
    else group = i - 13;
    if (group != null) col = group;
    return { period: per, group, row, col };
  }
  // electron shells: Madelung filling, then the known exceptions
  const ORDER = ['1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p', '5s', '4d', '5p', '6s', '4f', '5d', '6p', '7s', '5f', '6d', '7p'];
  const CAP = { s: 2, p: 6, d: 10, f: 14 };
  const FIX = { 24: { '4s': -1, '3d': 1 }, 29: { '4s': -1, '3d': 1 }, 41: { '5s': -1, '4d': 1 }, 42: { '5s': -1, '4d': 1 }, 44: { '5s': -1, '4d': 1 }, 45: { '5s': -1, '4d': 1 },
    46: { '5s': -2, '4d': 2 }, 47: { '5s': -1, '4d': 1 }, 57: { '4f': -1, '5d': 1 }, 58: { '4f': -1, '5d': 1 }, 64: { '4f': -1, '5d': 1 }, 78: { '6s': -1, '5d': 1 }, 79: { '6s': -1, '5d': 1 },
    89: { '5f': -1, '6d': 1 }, 90: { '5f': -2, '6d': 2 }, 91: { '5f': -1, '6d': 1 }, 92: { '5f': -1, '6d': 1 }, 93: { '5f': -1, '6d': 1 }, 96: { '5f': -1, '6d': 1 }, 103: { '6d': -1, '7p': 1 } };
  function config(z) {
    const occ = {}; let left = z;
    for (const s of ORDER) { if (left <= 0) break; const n = Math.min(CAP[s[1]], left); occ[s] = n; left -= n; }
    for (const [s, d] of Object.entries(FIX[z] || {})) occ[s] = (occ[s] || 0) + d;
    return occ;
  }
  function shells(z, charge) {
    const occ = config(z), sh = [];
    for (const [s, n] of Object.entries(occ)) { if (n <= 0) continue; const k = +s[0] - 1; sh[k] = (sh[k] || 0) + n; }
    const out = []; for (let i = 0; i < sh.length; i++) out.push(sh[i] || 0);
    // ions: take electrons from (or add them to) the outer shell
    let c = Math.round(charge || 0);
    while (c > 0 && out.length) { const k = out.length - 1; out[k]--; c--; if (out[k] <= 0) out.pop(); }
    if (c < 0 && out.length) out[out.length - 1] -= c;
    return out;
  }
  const SUP = { '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '0': '⁰' };
  function configText(z) {
    const occ = config(z), order = Object.keys(occ).filter(s => occ[s] > 0).sort((a, b) => (+a[0] - +b[0]) || ('spdf'.indexOf(a[1]) - 'spdf'.indexOf(b[1])));
    return order.map(s => s + String(occ[s]).replace(/./g, d => SUP[d])).join(' ');
  }

  const list = RAW.split('|').map((s, i) => {
    const [sym, name, m] = s.split(' '), z = i + 1, pl = place(z), cat = category(z);
    const block = (z >= 57 && z <= 71) || (z >= 89 && z <= 103) ? 'f' : (pl.group <= 2 || z === 2) ? 's' : pl.group >= 13 ? 'p' : 'd';
    const stable = m[0] !== '[';
    return { z, sym, name, massText: m, mass: parseFloat(m.replace(/[[\]]/g, '')), stable, cat, block, period: pl.period, group: pl.group, row: pl.row, col: pl.col, shells: shells(z) };
  });
  const bySym = {}; for (const e of list) bySym[e.sym.toLowerCase()] = e;
  function find(q) {
    if (q == null) return null;
    const s = String(q).trim().toLowerCase(); if (!s) return null;
    if (/^\d+$/.test(s)) return list[+s - 1] || null;
    return bySym[s] || list.find(e => e.name.toLowerCase() === s || (s === 'aluminum' && e.z === 13) || (s === 'cesium' && e.z === 55) || (s === 'sulphur' && e.z === 16)) || null;
  }
  // Jmol-style colours for the atom sphere; anything else uses its category colour
  const CPK = { H: '#F2F2F2', He: '#D9FFFF', Li: '#CC80FF', Be: '#C2FF00', B: '#FFB5B5', C: '#9AA3B0', N: '#5B8DEF', O: '#FC6255', F: '#90E050', Ne: '#B3E3F5', Na: '#AB5CF2', Mg: '#8AFF00', Al: '#BFA6A6', Si: '#F0C8A0',
    P: '#FF8000', S: '#FFFF30', Cl: '#1FF01F', Ar: '#80D1E3', K: '#8F40D4', Ca: '#3DFF00', Ti: '#BFC2C7', Cr: '#8A99C7', Mn: '#9C7AC7', Fe: '#E06633', Co: '#F090A0', Ni: '#50D050', Cu: '#C88033', Zn: '#7D80B0',
    Br: '#A62929', Kr: '#5CB8D1', Ag: '#C0C0C0', Sn: '#668080', I: '#940094', Xe: '#429EB0', Pt: '#D0D0E0', Au: '#FFD123', Hg: '#B8B8D0', Pb: '#575961', U: '#008FFF', Rn: '#428296' };
  const colorOf = e => CPK[e.sym] || CATS[e.cat].color;
  window.Elements = { list, CATS, BLOCKS, find, shells, config, configText, colorOf };
})();
