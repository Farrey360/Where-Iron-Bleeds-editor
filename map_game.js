/* Atelier — la carte du jeu (sans interface, testable sous Node).
 *
 * read(files)  : fichiers du jeu (content/base) -> projet de l'éditeur de carte (même forme que serialize()).
 * write(project, files) : projet -> fichiers du jeu à réécrire, avec erreurs et avertissements.
 *
 * files = { 'map/geometry.bin': ArrayBuffer, 'map/provinces.txt': texte, ... } (voir PATHS).
 *
 * geometry.bin (little-endian, écrit avant par tools/map/bopvec_to_mod.py) :
 *   "GSGEO" u8 version=1
 *   u32 nv,  nv x (f32 lon, f32 lat)
 *   u32 np,  np x (i32 id, f32 cx, f32 cy, u32 tri0, u32 ntri)   centre = pôle d'inaccessibilité
 *   u32 ni,  ni x u32                                             3 sommets par triangle
 *   u32 nc,  nc x (i32 left, i32 right, u32 s0, u32 n)            frontière entre deux provinces (-1 = rien)
 *   u32 ns,  ns x u32                                             sommets des frontières
 *
 * Les contours des provinces sont retrouvés depuis leurs triangles (arêtes qui ne sont qu'à un triangle).
 * À l'écriture, une province dont les contours n'ont pas bougé garde ses triangles et son centre d'origine ;
 * les autres sont re-triangulées (earcut) et reçoivent un nouveau centre (polylabel). Les frontières sont
 * recalculées comme le faisait le script Python. Les lignes de texte non touchées restent identiques.
 */
(function (root) {
  'use strict';

  const TERRAINS = ['plains', 'steppe', 'forest', 'taiga', 'hills', 'mountains', 'desert', 'marsh', 'snow', 'glacier',
    'sea', 'impassable', 'lake'];               // même ordre que l'éditeur
  const MERGED = { taiga: 'forest', snow: 'plains', glacier: 'mountains' };   // le jeu a 7 terrains
  const TYPE_OF = { sea: 'sea', impassable: 'impassable', lake: 'lake' };
  const NOT_SET = 255;
  const QK = 1e7;                               // clé de sommet : 7 décimales
  const SEAM = 1800000000;

  const PATHS = {
    geometry: 'map/geometry.bin', provinces: 'map/provinces.txt', regions: 'map/regions.txt', zones: 'map/air_zones.txt',
    straits: 'map/straits.txt', countries: 'common/countries/countries.txt',
    owners: 'history/start_1936/owners.txt', capitals: 'history/start_1936/capitals.txt',
    // lus seulement pour vérifier qu'une province supprimée n'y est pas citée
    ports: 'map/ports.txt', units: 'history/start_1936/units.txt', navy: 'history/start_1936/navy.txt',
    buildings: 'history/start_1936/province_buildings.txt', population: 'history/start_1936/regions.txt',
  };
  const LANGS = ['french', 'english'];
  const LOC = { provinces: 'map_provinces.txt', regions: 'map_regions.txt', zones: 'map_air_zones.txt', countries: 'map_countries.txt' };
  const locPath = (lang, k) => `localisation/${lang}/${LOC[k]}`;
  /** Tous les fichiers à fournir à read() / write(). */
  function allPaths() {
    const out = Object.values(PATHS);
    for (const lang of LANGS) for (const k in LOC) out.push(locPath(lang, k));
    return out;
  }

  /* ================================================================== géométrie binaire */

  function readGeometry(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 5));
    if (magic !== 'GSGEO' || dv.getUint8(5) !== 1) throw new Error('map/geometry.bin : format inconnu');
    let o = 6;
    const nv = dv.getUint32(o, true); o += 4;
    const verts = new Float32Array(buf.slice(o, o + 8 * nv)); o += 8 * nv;
    const np = dv.getUint32(o, true); o += 4;
    const ids = new Int32Array(np), cx = new Float32Array(np), cy = new Float32Array(np), t0 = new Uint32Array(np), nt = new Uint32Array(np);
    for (let i = 0; i < np; i++, o += 20) {
      ids[i] = dv.getInt32(o, true); cx[i] = dv.getFloat32(o + 4, true); cy[i] = dv.getFloat32(o + 8, true);
      t0[i] = dv.getUint32(o + 12, true); nt[i] = dv.getUint32(o + 16, true);
    }
    const ni = dv.getUint32(o, true); o += 4;
    const tris = new Uint32Array(buf.slice(o, o + 4 * ni)); o += 4 * ni;
    const nc = dv.getUint32(o, true); o += 4;
    const cl = new Int32Array(nc), cr = new Int32Array(nc), cs = new Uint32Array(nc), cn = new Uint32Array(nc);
    for (let i = 0; i < nc; i++, o += 16) {
      cl[i] = dv.getInt32(o, true); cr[i] = dv.getInt32(o + 4, true); cs[i] = dv.getUint32(o + 8, true); cn[i] = dv.getUint32(o + 12, true);
    }
    const ns = dv.getUint32(o, true); o += 4;
    const cv = new Uint32Array(buf.slice(o, o + 4 * ns));
    return { verts, ids, cx, cy, t0, nt, tris, chains: nc, chainVerts: ns, cl, cr, cs, cn, cv };
  }

  function writeGeometry(verts, recs, tris, chains) {
    let ns = 0;
    for (const c of chains) ns += c.pts.length;
    const size = 6 + 4 + verts.length * 4 + 4 + recs.length * 20 + 4 + tris.length * 4 + 4 + chains.length * 16 + 4 + ns * 4;
    const buf = new ArrayBuffer(size), dv = new DataView(buf);
    [71, 83, 71, 69, 79, 1].forEach((b, i) => dv.setUint8(i, b));   // "GSGEO" 1
    let o = 6;
    dv.setUint32(o, verts.length / 2, true); o += 4;
    for (let i = 0; i < verts.length; i++, o += 4) dv.setFloat32(o, verts[i], true);
    dv.setUint32(o, recs.length, true); o += 4;
    for (const r of recs) {
      dv.setInt32(o, r.id, true); dv.setFloat32(o + 4, r.cx, true); dv.setFloat32(o + 8, r.cy, true);
      dv.setUint32(o + 12, r.t0, true); dv.setUint32(o + 16, r.nt, true); o += 20;
    }
    dv.setUint32(o, tris.length, true); o += 4;
    for (let i = 0; i < tris.length; i++, o += 4) dv.setUint32(o, tris[i], true);
    dv.setUint32(o, chains.length, true); o += 4;
    let s = 0;
    for (const c of chains) {
      dv.setInt32(o, c.l, true); dv.setInt32(o + 4, c.r, true); dv.setUint32(o + 8, s, true); dv.setUint32(o + 12, c.pts.length, true);
      o += 16; s += c.pts.length;
    }
    dv.setUint32(o, ns, true); o += 4;
    for (const c of chains) for (const v of c.pts) { dv.setUint32(o, v, true); o += 4; }
    return new Uint8Array(buf);
  }

  /** Table de hachage sur deux entiers 32 bits (sans objets : tient des millions d'entrées). */
  class PairHash {
    constructor(n) {
      let c = 1024;
      while (c < n * 2) c *= 2;
      this.mask = c - 1; this.ka = new Int32Array(c); this.kb = new Int32Array(c); this.v = new Int32Array(c).fill(-1); this.n = 0;
    }
    slot(a, b) {
      let h = (Math.imul(a, 0x9E3779B1) ^ Math.imul(b ^ (b >>> 13), 0x85EBCA77)) >>> 0;
      h = (h ^ (h >>> 15)) & this.mask;
      for (;;) {
        if (this.v[h] === -1) return ~h;
        if (this.ka[h] === a && this.kb[h] === b) return h;
        h = (h + 1) & this.mask;
      }
    }
    get(a, b) { const s = this.slot(a, b); return s < 0 ? -1 : this.v[s]; }
    set(a, b, val) {
      let s = this.slot(a, b);
      if (s < 0) { s = ~s; this.ka[s] = a; this.kb[s] = b; this.n++; }
      this.v[s] = val;
    }
  }

  /** Petite table réutilisée province après province (arêtes orientées d'une province). */
  class EdgeSet {
    constructor() { this.grow(1024); this.stamp = 1; }
    grow(c) { this.mask = c - 1; this.ka = new Int32Array(c); this.kb = new Int32Array(c); this.st = new Int32Array(c); }
    reset(n) {
      let c = this.mask + 1;
      if (c < n * 2) { while (c < n * 2) c *= 2; this.grow(c); this.stamp = 1; } else this.stamp++;
    }
    find(a, b) {
      let h = ((Math.imul(a, 0x9E3779B1) ^ Math.imul(b, 0x85EBCA77)) >>> 0) & this.mask;
      for (;;) {
        if (this.st[h] !== this.stamp) return ~h;
        if (this.ka[h] === a && this.kb[h] === b) return h;
        h = (h + 1) & this.mask;
      }
    }
    add(a, b) { const s = this.find(a, b); if (s < 0) { const i = ~s; this.ka[i] = a; this.kb[i] = b; this.st[i] = this.stamp; } }
    has(a, b) { return this.find(a, b) >= 0; }
  }

  function ringArea(r) {
    let a = 0;
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) a += r[2 * j] * r[2 * i + 1] - r[2 * i] * r[2 * j + 1];
    return a / 2;
  }
  function pointInRing(x, y, r) {
    let c = false;
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /** Contours de chaque province (dans l'ordre du fichier) : [[anneau extérieur, ...trous], ...], anneau = [x0,y0,x1,y1...]. */
  function ringsFromTriangles(geo) {
    const V = geo.verts, T = geo.tris, E = new EdgeSet(), out = [];
    const canon = canonical(V), chainsOf = new Map();
    const addChain = (id, c) => { if (id < 0) return; const l = chainsOf.get(id); if (l) l.push(c); else chainsOf.set(id, [c]); };
    for (let c = 0; c < geo.chains; c++) { addChain(geo.cl[c], c); if (geo.cr[c] !== geo.cl[c]) addChain(geo.cr[c], c); }
    for (let k = 0; k < geo.ids.length; k++) {
      const t0 = geo.t0[k], nt = geo.nt[k];
      E.reset(nt * 3);
      for (let t = t0; t < t0 + nt; t++) {
        const a = T[3 * t];
        let b = T[3 * t + 1], c = T[3 * t + 2];
        const cr = (V[2 * b] - V[2 * a]) * (V[2 * c + 1] - V[2 * a + 1]) - (V[2 * b + 1] - V[2 * a + 1]) * (V[2 * c] - V[2 * a]);
        if (cr < 0) { const s = b; b = c; c = s; }
        E.add(a, b); E.add(b, c); E.add(c, a);
      }
      // bord = arête orientée dont l'inverse n'existe pas
      const from = [], to = [];
      for (let t = t0; t < t0 + nt; t++) {
        const a = T[3 * t];
        let b = T[3 * t + 1], c = T[3 * t + 2];
        const cr = (V[2 * b] - V[2 * a]) * (V[2 * c + 1] - V[2 * a + 1]) - (V[2 * b + 1] - V[2 * a + 1]) * (V[2 * c] - V[2 * a]);
        if (cr < 0) { const s = b; b = c; c = s; }
        if (a !== b && !E.has(b, a)) { from.push(a); to.push(b); }
        if (b !== c && !E.has(c, b)) { from.push(b); to.push(c); }
        if (c !== a && !E.has(a, c)) { from.push(c); to.push(a); }
      }
      const outOf = new Map();
      for (let i = 0; i < from.length; i++) { const l = outOf.get(from[i]); if (l) l.push(i); else outOf.set(from[i], [i]); }
      const used = new Uint8Array(from.length), rings = [];
      const adj = chainGraph(geo, chainsOf.get(geo.ids[k]), canon);
      for (let e = 0; e < from.length; e++) {
        if (used[e]) continue;
        const start = from[e], ids = [];
        let cur = e;
        for (;;) {
          used[cur] = 1;
          ids.push(from[cur]);
          const v = to[cur];
          if (v === start) break;
          const next = (outOf.get(v) || []).find(i => !used[i]);
          if (next === undefined) break;
          cur = next;
        }
        const ring = [];
        for (let i = 0; i < ids.length; i++) {
          const a = ids[i];
          ring.push(V[2 * a], V[2 * a + 1]);
          if (adj) for (const m of between(adj, canon[a], canon[ids[(i + 1) % ids.length]], V)) ring.push(V[2 * m], V[2 * m + 1]);
        }
        if (ring.length >= 6) rings.push(ring);
      }
      out.push(groupRings(rings));
    }
    return out;
  }

  /** Sommet -> premier sommet de même position (180 et -180 confondus), comme les frontières du fichier. */
  function canonical(V) {
    const n = V.length / 2, h = new PairHash(n), out = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let kx = Math.round(V[2 * i] * QK);
      const ky = Math.round(V[2 * i + 1] * QK);
      if (kx === SEAM) kx = -SEAM;
      const j = h.get(kx, ky);
      if (j < 0) { h.set(kx, ky, i); out[i] = i; } else out[i] = j;
    }
    return out;
  }

  /** Voisins de chaque sommet le long des frontières d'une province. */
  function chainGraph(geo, list, canon) {
    if (!list) return null;
    const adj = new Map(), link = (a, b) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
    for (const c of list) {
      for (let j = geo.cs[c] + 1; j < geo.cs[c] + geo.cn[c]; j++) {
        const a = canon[geo.cv[j - 1]], b = canon[geo.cv[j]];
        link(a, b); link(b, a);
      }
    }
    return adj;
  }

  /**
   * Sommets de frontière entre a et b qui manquent aux triangles : la triangulation d'origine a jeté les triangles plats,
   * et avec eux les sommets alignés sur un côté. Les frontières du fichier les ont encore.
   */
  function between(adj, a, b, V) {
    const na = adj.get(a);
    if (a === b || !na || na.includes(b)) return [];
    if (Math.abs(V[2 * a]) > 179.99999 || Math.abs(V[2 * b]) > 179.99999) return [];   // 180 et -180 confondus : pas sûr
    const x0 = Math.min(V[2 * a], V[2 * b]) - 1e-6, x1 = Math.max(V[2 * a], V[2 * b]) + 1e-6;
    const y0 = Math.min(V[2 * a + 1], V[2 * b + 1]) - 1e-6, y1 = Math.max(V[2 * a + 1], V[2 * b + 1]) + 1e-6;
    const path = [], seen = new Set([a]);
    const dfs = (v) => {
      if (path.length > 256) return false;
      for (const w of adj.get(v) || []) {
        if (w === b) return true;
        if (seen.has(w) || V[2 * w] < x0 || V[2 * w] > x1 || V[2 * w + 1] < y0 || V[2 * w + 1] > y1) continue;
        seen.add(w); path.push(w);
        if (dfs(w)) return true;
        path.pop();
      }
      return false;
    };
    return dfs(a) ? path : [];
  }

  /** Anneaux -> polygones : sens direct = extérieur, sens indirect = trou du plus petit extérieur qui le contient. */
  function groupRings(rings) {
    const shells = [], holes = [];
    for (const r of rings) {
      const a = ringArea(r);
      if (a > 0) shells.push({ r, a, holes: [] }); else if (a < 0) holes.push(r);
    }
    for (const h of holes) {
      let best = null;
      for (const s of shells) if ((!best || s.a < best.a) && pointInRing(h[0], h[1], s.r)) best = s;
      if (best) best.holes.push(h); else shells.push({ r: h, a: -ringArea(h), holes: [] });
    }
    return shells.map(s => [s.r, ...s.holes]);
  }

  function sameRings(a, b) {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].length !== b[i].length) return false;
      for (let j = 0; j < a[i].length; j++) {
        const ra = a[i][j], rb = b[i][j];
        if (ra.length !== rb.length) return false;
        for (let k = 0; k < ra.length; k++) if (Math.abs(ra[k] - rb[k]) > 2e-7) return false;
      }
    }
    return true;
  }

  /* ================================================================== fichiers texte */

  class Lines {
    constructor(text) {
      text = text || '';
      this.bom = text.charCodeAt(0) === 0xFEFF;
      if (this.bom) text = text.slice(1);
      this.eol = text.includes('\r\n') ? '\r\n' : '\n';
      this.end = text === '' || text.endsWith('\n');
      this.lines = text === '' ? [] : text.split(/\r?\n/);
      if (text !== '' && this.end) this.lines.pop();
    }
    text() { return (this.bom ? '﻿' : '') + this.lines.join(this.eol) + (this.end && this.lines.length ? this.eol : ''); }
    /** Lignes de commentaire (ou vides) du début. */
    head() { const h = []; for (const l of this.lines) { if (l.trim() === '' || l.trim().startsWith('#')) h.push(l); else break; } return h; }
  }

  /** "kind = { k = v k = v }" -> [[k, v], ...] (valeurs simples seulement), sinon null. */
  function pairs(line) {
    const m = /\{(.*)\}/.exec(line);
    if (!m) return null;
    const t = m[1].trim().split(/\s+/).filter(Boolean), out = [];
    for (let i = 0; i < t.length; i += 3) { if (t[i + 1] !== '=' || i + 2 >= t.length) return null; out.push([t[i], t[i + 2]]); }
    return out;
  }
  const getP = (ps, k) => { const p = ps.find(x => x[0] === k); return p ? p[1] : undefined; };
  function setP(ps, k, v, order) {
    const i = ps.findIndex(x => x[0] === k);
    if (v === undefined || v === null) { if (i >= 0) ps.splice(i, 1); return; }
    if (i >= 0) { ps[i][1] = String(v); return; }
    // nouvelle clé : après la dernière clé qui la précède dans `order`
    const before = order.slice(0, order.indexOf(k));
    let at = -1;
    ps.forEach((x, j) => { if (before.includes(x[0])) at = j; });
    ps.splice(at + 1, 0, [k, String(v)]);
  }
  const pairsText = (kind, ps) => kind + ' = { ' + ps.map(x => x[0] + ' = ' + x[1]).join(' ') + ' }';
  const unq = v => (v && v[0] === '"' ? v.slice(1, -1) : v);

  const LOC_LINE = /^(\s*)([\w.\-]+)(\s*=\s*)"(.*)"(\s*)$/;
  const escape = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const unescape = s => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));

  /** Un fichier de textes : clé -> ligne, modifié sans toucher aux autres lignes. */
  class LocLines extends Lines {
    constructor(text) {
      super(text);
      this.at = new Map();
      this.lines.forEach((l, i) => { const m = LOC_LINE.exec(l); if (m && !this.at.has(m[2])) this.at.set(m[2], i); });
    }
    get(k) { const i = this.at.get(k); if (i === undefined) return undefined; return unescape(LOC_LINE.exec(this.lines[i])[4]); }
    set(k, v) {
      const i = this.at.get(k);
      if (i === undefined) { this.at.set(k, this.lines.length); this.lines.push(k + ' = "' + escape(v) + '"'); return; }
      const m = LOC_LINE.exec(this.lines[i]);
      if (unescape(m[4]) !== v) this.lines[i] = m[1] + k + m[3] + '"' + escape(v) + '"' + m[5];
    }
    remove(k) { const i = this.at.get(k); if (i !== undefined) { this.lines[i] = null; this.at.delete(k); } }
    text() { this.lines = this.lines.filter(l => l !== null); return super.text(); }
  }

  function readOwners(text) {
    const own = new Map();   // province -> tag
    for (const l of new Lines(text).lines) {
      const m = /^\s*(\w+)\s*=\s*\{([^}]*)\}/.exec(l);
      if (m) for (const s of m[2].trim().split(/\s+/)) if (s) own.set(+s, m[1]);
    }
    return own;
  }
  function readCapitals(text) {
    const caps = new Map();   // tag -> province
    for (const l of new Lines(text).lines) { const m = /^\s*(\w+)\s*=\s*(\d+)/.exec(l); if (m) caps.set(m[1], +m[2]); }
    return caps;
  }
  function locs(files) {
    const o = {};
    for (const lang of LANGS) { o[lang] = {}; for (const k in LOC) o[lang][k] = new LocLines(files[locPath(lang, k)] || ''); }
    return o;
  }
  function needText(files, key) {
    const t = files[PATHS[key]];
    if (typeof t !== 'string') throw new Error(PATHS[key] + ' introuvable');
    return t;
  }

  /* ================================================================== lecture */

  /** Fichiers du jeu -> projet de l'éditeur (forme de serialize() ; couleurs des provinces/régions/zones à donner par l'appli). */
  function read(files) {
    if (!files[PATHS.geometry]) throw new Error(PATHS.geometry + ' introuvable');
    const geo = readGeometry(files[PATHS.geometry]);
    const rings = ringsFromTriangles(geo);
    const L = locs(files), fr = L.french;

    const info = new Map();
    for (const l of new Lines(needText(files, 'provinces')).lines) {
      if (!/^\s*province\s*=/.test(l)) continue;
      const ps = pairs(l); if (!ps) continue;
      info.set(+getP(ps, 'id'), ps);
    }

    const countries = [], tagId = new Map(), tags = {};
    for (const l of new Lines(needText(files, 'countries')).lines) {
      if (!/^\s*country\s*=/.test(l)) continue;
      const ps = pairs(l); if (!ps) continue;
      const tag = getP(ps, 'tag'), id = countries.length + 1;
      countries.push({ id, name: fr.countries.get(tag) || tag, tag, color: unq(getP(ps, 'color')) || '#888888' });
      tagId.set(tag, id); tags[id] = tag;
    }
    const owners = readOwners(needText(files, 'owners'));
    const capOf = new Map();
    for (const [tag, pid] of readCapitals(files[PATHS.capitals] || '')) if (tagId.has(tag)) capOf.set(pid, tagId.get(tag));

    const provinces = [];
    let maxId = 0;
    const center = new Map();
    for (let k = 0; k < geo.ids.length; k++) {
      const id = geo.ids[k], ps = info.get(id) || [];
      maxId = Math.max(maxId, id);
      center.set(id, [geo.cx[k], geo.cy[k]]);
      const type = getP(ps, 'type') || 'land';
      const terrain = type === 'land' ? TERRAINS.indexOf(getP(ps, 'terrain')) : TERRAINS.indexOf(type);
      const p = {
        id, name: fr.provinces.get('prov_' + id) || '', country: tagId.get(owners.get(id)) || 0,
        region: +(getP(ps, 'region') || 0), terrain: terrain < 0 ? NOT_SET : terrain, polys: rings[k],
      };
      const air = +(getP(ps, 'air_zone') || 0);
      if (air) p.air = air;
      if (capOf.has(id)) p.cap = capOf.get(id);
      provinces.push(p);
    }

    const regions = [];
    for (const l of new Lines(files[PATHS.regions] || '').lines) {
      const m = /^\s*region\s*=\s*\{\s*id\s*=\s*(\d+)/.exec(l);
      if (m) regions.push({ id: +m[1], name: fr.regions.get('region_' + m[1]) || 'Région ' + m[1] });
    }
    const zones = [];
    for (const l of new Lines(files[PATHS.zones] || '').lines) {
      if (!/^\s*air_zone\s*=/.test(l)) continue;
      const ps = pairs(l); if (!ps) continue;
      const id = +getP(ps, 'id');
      zones.push({ id, name: fr.zones.get('air_zone_' + id) || 'Zone ' + id, sea: getP(ps, 'sea') === 'yes', hoi4: 0 });
    }
    const straits = [];
    for (const l of new Lines(files[PATHS.straits] || '').lines) {
      if (!/^\s*strait\s*=/.test(l)) continue;
      const ps = pairs(l); if (!ps) continue;
      const a = center.get(+getP(ps, 'from')), b = center.get(+getP(ps, 'to'));
      if (a && b) straits.push({ id: straits.length + 1, a: a.slice(), b: b.slice(), type: getP(ps, 'type') || 'sea', name: '', rule: '' });
    }

    const maxOf = list => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    return {
      format: 1, name: 'Carte du jeu', provinces, countries, regions, zones, straits,
      nextProv: maxId + 1, nextCountry: countries.length + 1, nextRegion: maxOf(regions), nextZone: maxOf(zones), nextStrait: straits.length + 1,
      showStraits: true, straitsFromHoi4: false, provAlpha: 1, bg: [],
      game: { tags },
    };
  }

  /* ================================================================== écriture */

  /** Ids cités ailleurs dans le jeu : id -> [fichiers]. */
  function references(files) {
    const refs = new Map();
    const add = (id, f) => { const l = refs.get(id); if (!l) refs.set(id, [f]); else if (!l.includes(f)) l.push(f); };
    const scan = (key, re) => {
      const t = files[PATHS[key]]; if (!t) return;
      for (const m of t.matchAll(re)) add(+m[1], PATHS[key]);
    };
    scan('ports', /\bprovince\s*=\s*(\d+)/g);
    scan('units', /\bprovince\s*=\s*(\d+)/g);
    scan('navy', /\bport\s*=\s*(\d+)/g);
    scan('buildings', /^\s*(\d+)\s*=/gm);
    return refs;
  }

  const HEX = /^#[0-9a-fA-F]{6}$/;

  /**
   * Projet -> fichiers à réécrire. Renvoie { changes: [{path, data}], errors: [], warns: [], stats }.
   * Rien n'est écrit s'il y a des erreurs (l'appli vérifie errors avant d'écrire).
   */
  function write(project, files, log) {
    log = log || (() => {});
    const errors = [], warns = [];
    const geo = readGeometry(files[PATHS.geometry]);
    const origRings = ringsFromTriangles(geo);
    const origIndex = new Map();
    for (let k = 0; k < geo.ids.length; k++) origIndex.set(geo.ids[k], k);
    log('contours d\'origine relus');

    const provs = project.provinces.filter(p => p.polys && p.polys.length).sort((a, b) => a.id - b.id);
    const empty = project.provinces.filter(p => !p.polys || !p.polys.length);
    if (empty.length) warns.push(`${empty.length} province(s) sans forme ignorée(s) (ex. ${empty[0].id})`);
    const kept = new Set(provs.map(p => p.id));

    // ------------------------------------------------ pays
    const country = new Map(project.countries.map(c => [c.id, c]));
    const oldTags = (project.game && project.game.tags) || {};
    const owning = new Set(provs.map(p => p.country).filter(Boolean));
    const tagOf = new Map(), seenTag = new Map();
    for (const c of project.countries) {
      const tag = (c.tag || '').trim();
      if (oldTags[c.id] && oldTags[c.id] !== tag) errors.push(`Pays « ${c.name} » : son code ${oldTags[c.id]} ne peut pas changer (${tag || 'vide'}) — les autres fichiers du jeu l'utilisent.`);
      if (!oldTags[c.id] && !owning.has(c.id)) continue;   // pays ajouté sans province : laissé de côté
      if (!/^[A-Z0-9]{3}$/.test(tag)) { errors.push(`Pays « ${c.name} » : il faut un code de 3 lettres majuscules (actuel : « ${tag} »).`); continue; }
      if (seenTag.has(tag)) { errors.push(`Code ${tag} utilisé par deux pays : « ${seenTag.get(tag)} » et « ${c.name} ».`); continue; }
      seenTag.set(tag, c.name); tagOf.set(c.id, tag);
      if (!HEX.test(c.color || '')) errors.push(`Pays « ${c.name} » : couleur « ${c.color} » non lisible (#rrggbb attendu).`);
    }

    // ------------------------------------------------ provinces supprimées encore citées
    const refs = references(files);
    const removed = [...origIndex.keys()].filter(id => !kept.has(id));
    for (const id of removed) {
      const where = refs.get(id);
      if (where) errors.push(`Province ${id} supprimée (ou fusionnée) mais citée dans ${where.join(', ')}.`);
    }
    for (const p of provs) {
      const t = p.terrain === NOT_SET ? 'plains' : TERRAINS[p.terrain];
      if (!TYPE_OF[t] && !p.region) warns.push(`Province ${p.id} (${p.name || 'sans nom'}) : terrestre sans région.`);
    }
    if (errors.length) return { changes: [], errors, warns, stats: null };

    // ------------------------------------------------ géométrie
    const changed = provs.filter(p => !origIndex.has(p.id) || !sameRings(origRings[origIndex.get(p.id)], p.polys));
    const added = provs.filter(p => !origIndex.has(p.id)).length;
    const changes = [];
    let centers;
    if (changed.length || removed.length) {
      const g = buildGeometry(geo, provs, origIndex, new Set(changed.map(p => p.id)), origRings, log);
      changes.push({ path: PATHS.geometry, data: g.data });
      centers = g.centers;
      warns.push(...g.warns);
    } else {
      centers = provs.map(p => { const k = origIndex.get(p.id); return [geo.cx[k], geo.cy[k]]; });
    }

    // ------------------------------------------------ provinces.txt
    const L = locs(files);
    const pf = new Lines(needText(files, 'provinces'));
    const lineOf = new Map();
    for (const l of pf.lines) { if (/^\s*province\s*=/.test(l)) { const ps = pairs(l); if (ps) lineOf.set(+getP(ps, 'id'), l); } }
    const ORDER = ['id', 'type', 'terrain', 'region', 'air_zone'];
    const usedRegions = new Set(), usedZones = new Set();
    const plines = pf.head();
    for (const p of provs) {
      let t = p.terrain === NOT_SET ? 'plains' : TERRAINS[p.terrain];
      t = MERGED[t] || t;
      const type = TYPE_OF[t] || 'land';
      const raw = lineOf.get(p.id);
      const ps = raw ? pairs(raw) : [['id', String(p.id)]];
      const before = pairsText('province', ps);
      setP(ps, 'type', type, ORDER);
      setP(ps, 'terrain', type === 'land' ? t : null, ORDER);
      setP(ps, 'region', p.region || null, ORDER);
      setP(ps, 'air_zone', p.air || null, ORDER);
      if (p.region) usedRegions.add(p.region);
      if (p.air) usedZones.add(p.air);
      const now = pairsText('province', ps);
      plines.push(raw && now === before ? raw : now);
    }
    pf.lines = plines;
    put(changes, files, PATHS.provinces, pf.text());

    // ------------------------------------------------ régions et zones (on ajoute, on ne retire rien : d'autres fichiers les citent)
    const rf = new Lines(files[PATHS.regions] || '# Regions: name = text key region_<id>.\n');
    const haveR = new Set();
    for (const l of rf.lines) { const m = /^\s*region\s*=\s*\{\s*id\s*=\s*(\d+)/.exec(l); if (m) haveR.add(+m[1]); }
    const newRegions = [...usedRegions].filter(r => !haveR.has(r)).sort((a, b) => a - b);
    for (const r of newRegions) rf.lines.push(`region = { id = ${r} }`);
    put(changes, files, PATHS.regions, rf.text());
    if (newRegions.length) warns.push(`${newRegions.length} région(s) nouvelle(s) sans population ni bâtiments (${PATHS.population}).`);

    const zone = new Map((project.zones || []).map(z => [z.id, z]));
    const zf = new Lines(files[PATHS.zones] || '# Air zones: name = text key air_zone_<id>.\n');
    const haveZ = new Set();
    zf.lines = zf.lines.map(l => {
      if (!/^\s*air_zone\s*=/.test(l)) return l;
      const ps = pairs(l); if (!ps) return l;
      const id = +getP(ps, 'id'); haveZ.add(id);
      const z = zone.get(id); if (!z) return l;
      const sea = z.sea ? 'yes' : 'no';
      if (getP(ps, 'sea') === sea) return l;
      setP(ps, 'sea', sea, ['id', 'sea']);
      return pairsText('air_zone', ps);
    });
    for (const id of [...usedZones].filter(z => !haveZ.has(z)).sort((a, b) => a - b)) zf.lines.push(`air_zone = { id = ${id} sea = ${zone.get(id) && zone.get(id).sea ? 'yes' : 'no'} }`);
    put(changes, files, PATHS.zones, zf.text());

    // ------------------------------------------------ détroits (bouts -> province au centre le plus proche)
    const sf = new Lines(files[PATHS.straits] || '# Crossings between two shores: type = sea | river | river_large | impassable.\n');
    const nearest = (x, y) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < centers.length; i++) { const dx = centers[i][0] - x, dy = centers[i][1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      return provs[best].id;
    };
    const slines = sf.head();
    for (const s of project.straits || []) {
      const a = nearest(s.a[0], s.a[1]), b = nearest(s.b[0], s.b[1]);
      if (a !== b) slines.push(`strait = { from = ${a} to = ${b} type = ${s.type || 'sea'} }`);
    }
    sf.lines = slines;
    put(changes, files, PATHS.straits, sf.text());

    // ------------------------------------------------ pays, propriétaires, capitales
    const cf = new Lines(needText(files, 'countries'));
    const haveT = new Set();
    const colorOf = new Map([...tagOf].map(([id, tag]) => [tag, country.get(id).color.toLowerCase()]));
    cf.lines = cf.lines.map(l => {
      if (!/^\s*country\s*=/.test(l)) return l;
      const ps = pairs(l); if (!ps) return l;
      const tag = getP(ps, 'tag'); haveT.add(tag);
      const col = colorOf.get(tag);
      if (!col || unq(getP(ps, 'color')).toLowerCase() === col) return l;
      setP(ps, 'color', `"${col}"`, ['tag', 'color']);
      return pairsText('country', ps);
    });
    for (const [tag, col] of [...colorOf].sort()) if (!haveT.has(tag)) cf.lines.push(`country = { tag = ${tag} color = "${col}" }`);
    put(changes, files, PATHS.countries, cf.text());

    const owners = new Map();
    for (const p of provs) { const tag = tagOf.get(p.country); if (tag) { if (!owners.has(tag)) owners.set(tag, []); owners.get(tag).push(p.id); } }
    const of = new Lines(needText(files, 'owners'));
    of.lines = [...of.head(), ...[...owners].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([tag, ids]) => `${tag} = { ${ids.join(' ')} }`)];
    put(changes, files, PATHS.owners, of.text());

    const oldCaps = readCapitals(files[PATHS.capitals] || '');
    const caps = new Map();
    for (const p of provs) { const tag = p.cap && tagOf.get(p.cap); if (tag) caps.set(tag, p.id); }
    for (const tag of oldCaps.keys()) if (!caps.has(tag) && owners.has(tag)) warns.push(`${tag} n'a plus de capitale.`);
    const kf = new Lines(files[PATHS.capitals] || '# Capital province of every country.\n');
    kf.lines = [...kf.head(), ...[...caps].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([tag, id]) => `${tag} = ${id}`)];
    put(changes, files, PATHS.capitals, kf.text());

    // ------------------------------------------------ noms (français = celui de l'éditeur ; anglais seulement pour les nouveaux)
    const name = (lang, k, key, v) => {
      if (!v) return;
      const f = L[lang][k];
      if (lang === 'french') f.set(key, v); else if (f.get(key) === undefined) f.set(key, v);
    };
    for (const lang of LANGS) {
      for (const p of provs) name(lang, 'provinces', 'prov_' + p.id, p.name);
      for (const id of removed) L[lang].provinces.remove('prov_' + id);
      const reg = new Map((project.regions || []).map(r => [r.id, r]));
      for (const r of usedRegions) name(lang, 'regions', 'region_' + r, reg.has(r) ? reg.get(r).name : 'Région ' + r);
      for (const z of usedZones) name(lang, 'zones', 'air_zone_' + z, zone.has(z) ? zone.get(z).name : 'Zone ' + z);
      for (const [id, tag] of tagOf) name(lang, 'countries', tag, country.get(id).name);
      for (const k in LOC) put(changes, files, locPath(lang, k), L[lang][k].text());
    }

    return {
      changes, errors, warns, tags: Object.fromEntries(tagOf),
      stats: { provinces: provs.length, reshaped: changed.length - added, added, removed: removed.length, files: changes.length },
    };
  }

  function put(changes, files, path, text) { if ((files[path] || '') !== text) changes.push({ path, data: text }); }

  /** Sommets, triangles, centres et frontières de toute la carte. */
  function buildGeometry(geo, provs, origIndex, changedIds, origRings, log) {
    const warns = [];
    const OV = geo.verts, nv0 = OV.length / 2;
    let extra = 0;
    for (const p of provs) if (changedIds.has(p.id)) for (const poly of p.polys) for (const r of poly) extra += r.length / 2;
    const verts = Array.from(OV);
    const qx = x => Math.round(x * QK);
    const exact = new PairHash(nv0 + extra), canon = new PairHash(nv0 + extra);
    for (let i = 0; i < nv0; i++) {
      const kx = qx(OV[2 * i]), ky = qx(OV[2 * i + 1]);
      if (exact.get(kx, ky) < 0) exact.set(kx, ky, i);
      const fx = kx === SEAM ? -SEAM : kx;
      if (canon.get(fx, ky) < 0) canon.set(fx, ky, i);
    }
    // clé prise avant l'arrondi en 32 bits : l'éditeur garde 7 décimales, un sommet du fichier retrouve ainsi sa clé exacte
    const vid = (x, y) => {
      const kx = qx(x), ky = qx(y);
      let i = exact.get(kx, ky);
      if (i < 0) { i = verts.length / 2; verts.push(Math.fround(x), Math.fround(y)); exact.set(kx, ky, i); const fx = kx === SEAM ? -SEAM : kx; if (canon.get(fx, ky) < 0) canon.set(fx, ky, i); }
      return i;
    };
    const cid = (x, y) => { const kx = qx(x), ky = qx(y); return canon.get(kx === SEAM ? -SEAM : kx, ky); };

    // sens des triangles du fichier d'origine (le jeu peut en dépendre pour le dessin)
    let pos = 0, neg = 0;
    for (let t = 0; t < Math.min(geo.tris.length / 3, 5000); t++) {
      const a = geo.tris[3 * t], b = geo.tris[3 * t + 1], c = geo.tris[3 * t + 2];
      const cr = (OV[2 * b] - OV[2 * a]) * (OV[2 * c + 1] - OV[2 * a + 1]) - (OV[2 * b + 1] - OV[2 * a + 1]) * (OV[2 * c] - OV[2 * a]);
      if (cr > 0) pos++; else if (cr < 0) neg++;
    }
    const wantPos = pos >= neg;

    const tris = [], recs = [], centers = [];
    let bad = 0;
    for (const p of provs) {
      const t0 = tris.length / 3;
      let cx, cy;
      if (!changedIds.has(p.id)) {
        const k = origIndex.get(p.id);
        for (let t = geo.t0[k]; t < geo.t0[k] + geo.nt[k]; t++) tris.push(geo.tris[3 * t], geo.tris[3 * t + 1], geo.tris[3 * t + 2]);
        cx = geo.cx[k]; cy = geo.cy[k];
      } else {
        let best = null, bestA = -1;
        for (const poly of p.polys) {
          const data = [], holes = [], ids = [];
          for (const r of poly) {
            if (data.length) holes.push(data.length / 2);
            for (let i = 0; i < r.length; i += 2) { data.push(r[i], r[i + 1]); ids.push(vid(r[i], r[i + 1])); }
          }
          const tr = earcut(data, holes);
          if (!tr.length) bad++;
          for (let i = 0; i < tr.length; i += 3) {
            let a = tr[i], b = tr[i + 1], c = tr[i + 2];
            const cr = (data[2 * b] - data[2 * a]) * (data[2 * c + 1] - data[2 * a + 1]) - (data[2 * b + 1] - data[2 * a + 1]) * (data[2 * c] - data[2 * a]);
            if ((cr > 0) !== wantPos) { const s = b; b = c; c = s; }
            tris.push(ids[a], ids[b], ids[c]);
          }
          const ar = Math.abs(ringArea(poly[0]));
          if (ar > bestA) { bestA = ar; best = poly; }
        }
        [cx, cy] = best && bestA > 0 ? polylabel(best, Math.max(Math.sqrt(bestA) * 0.02, 1e-4)) : [p.polys[0][0][0], p.polys[0][0][1]];
      }
      recs.push({ id: p.id, cx, cy, t0, nt: tris.length / 3 - t0 });
      centers.push([cx, cy]);
    }
    if (bad) warns.push(`${bad} morceau(x) de province n'ont pas pu être triangulés (forme qui se croise ?) : invisibles dans le jeu.`);
    log('triangles faits');

    // ------------------------------------------------ frontières (comme tools/map/bopvec_to_mod.py)
    const edges = new PairHash(geo.chainVerts * 1.2 + extra + 1024);
    const ea = [], eb = [], e1 = [], e2 = [];
    let multi = 0;
    provs.forEach((p, pi) => {
      const polys = changedIds.has(p.id) ? p.polys : origRings[origIndex.get(p.id)];
      for (const poly of polys) for (const r of poly) {
        const n = r.length / 2;
        const c = new Int32Array(n);
        for (let j = 0; j < n; j++) c[j] = cid(r[2 * j], r[2 * j + 1]);
        for (let j = 0; j < n; j++) {
          let a = c[j], b = c[(j + 1) % n];
          if (a === b || a < 0 || b < 0) continue;
          if (a > b) { const s = a; a = b; b = s; }
          const e = edges.get(a, b);
          if (e < 0) { edges.set(a, b, ea.length); ea.push(a); eb.push(b); e1.push(pi); e2.push(-1); }
          else if (e1[e] !== pi && e2[e] !== pi) {
            if (e2[e] === -1) e2[e] = pi;
            else if (changedIds.has(p.id) || changedIds.has(provs[e1[e]].id) || changedIds.has(provs[e2[e]].id)) multi++;   // les vieux chevauchements du jeu : on ne les signale pas
          }
        }
      }
    });
    const isSeam = v => Math.abs(Math.abs(verts[2 * v]) - 180) < 1e-7;
    const order = [], key = new Float64Array(ea.length), np = provs.length + 1;
    for (let e = 0; e < ea.length; e++) {
      let l = e1[e], r = e2[e];
      if (r === -1 && isSeam(ea[e]) && isSeam(eb[e])) continue;   // bord de carte sur la méridienne 180
      if (r !== -1 && r < l) { const s = l; l = r; r = s; e1[e] = l; e2[e] = r; }
      key[e] = l * np + (r + 1) + e / (ea.length + 1);   // + rang : garde l'ordre de rencontre dans une paire
      order.push(e);
    }
    order.sort((x, y) => key[x] - key[y]);
    const chains = [];
    for (let i = 0; i < order.length;) {
      const l = e1[order[i]], r = e2[order[i]];
      let j = i;
      const adj = new Map();
      while (j < order.length && e1[order[j]] === l && e2[order[j]] === r) {
        const e = order[j++], a = ea[e], b = eb[e];
        (adj.get(a) || adj.set(a, []).get(a)).push(b);
        (adj.get(b) || adj.set(b, []).get(b)).push(a);
      }
      const used = new Set(), ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
      const walk = (start, nxt) => {
        const path = [start, nxt];
        used.add(ek(start, nxt));
        let prev = start, cur = nxt;
        while (adj.get(cur).length === 2) {
          const n2 = adj.get(cur), cand = n2[0] !== prev ? n2[0] : n2[1];
          if (used.has(ek(cur, cand))) break;
          used.add(ek(cur, cand)); path.push(cand); prev = cur; cur = cand;
        }
        return path;
      };
      const starts = [...adj.keys()].filter(v => adj.get(v).length !== 2).concat([...adj.keys()]);
      for (const v of starts) for (const w of adj.get(v)) if (!used.has(ek(v, w))) chains.push({ l: provs[l].id, r: r >= 0 ? provs[r].id : -1, pts: walk(v, w) });
      i = j;
    }
    if (multi) warns.push(`${multi} bout(s) de frontière partagés par plus de deux provinces (provinces qui se chevauchent ?).`);
    log(`${chains.length} frontières`);

    // ------------------------------------------------ on ne garde que les sommets servis
    const remap = new Int32Array(verts.length / 2).fill(-1);
    const out = [];
    const use = v => { if (remap[v] < 0) { remap[v] = out.length / 2; out.push(verts[2 * v], verts[2 * v + 1]); } return remap[v]; };
    for (let i = 0; i < tris.length; i++) tris[i] = use(tris[i]);
    for (const c of chains) c.pts = c.pts.map(use);
    return { data: writeGeometry(out, recs, tris, chains), centers, warns };
  }

  /* ================================================================== polylabel (pôle d'inaccessibilité, d'après mapbox/polylabel, ISC) */

  function polylabel(poly, precision) {
    const r0 = poly[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < r0.length; i += 2) { minX = Math.min(minX, r0[i]); minY = Math.min(minY, r0[i + 1]); maxX = Math.max(maxX, r0[i]); maxY = Math.max(maxY, r0[i + 1]); }
    const w = maxX - minX, h = maxY - minY, size = Math.min(w, h);
    if (size === 0) return [minX, minY];
    const cell = (x, y, hh) => { const d = pointToPolyDist(x, y, poly); return { x, y, h: hh, d, max: d + hh * Math.SQRT2 }; };
    const heap = [];
    const push = c => { heap.push(c); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].max >= heap[i].max) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].max > heap[m].max) m = l;
          if (r < heap.length && heap[r].max > heap[m].max) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const hh = size / 2;
    for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) push(cell(x + hh, y + hh, hh));
    let best = centroidCell(poly, cell);
    const bb = cell(minX + w / 2, minY + h / 2, 0);
    if (bb.d > best.d) best = bb;
    while (heap.length) {
      const c = pop();
      if (c.d > best.d) best = c;
      if (c.max - best.d <= precision) continue;
      const q = c.h / 2;
      push(cell(c.x - q, c.y - q, q)); push(cell(c.x + q, c.y - q, q));
      push(cell(c.x - q, c.y + q, q)); push(cell(c.x + q, c.y + q, q));
    }
    return [best.x, best.y];
  }
  function centroidCell(poly, cell) {
    const r = poly[0], n = r.length / 2;
    let area = 0, x = 0, y = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = r[2 * i], ay = r[2 * i + 1], bx = r[2 * j], by = r[2 * j + 1], f = ax * by - bx * ay;
      x += (ax + bx) * f; y += (ay + by) * f; area += f * 3;
    }
    return area === 0 ? cell(r[0], r[1], 0) : cell(x / area, y / area, 0);
  }
  function pointToPolyDist(x, y, poly) {
    let inside = false, min = Infinity;
    for (const r of poly) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = r[2 * i], ay = r[2 * i + 1], bx = r[2 * j], by = r[2 * j + 1];
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
        let px = ax, py = ay, dx = bx - ax, dy = by - ay;
        if (dx !== 0 || dy !== 0) {
          const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
          if (t > 1) { px = bx; py = by; } else if (t > 0) { px += dx * t; py += dy * t; }
        }
        dx = x - px; dy = y - py;
        min = Math.min(min, dx * dx + dy * dy);
      }
    }
    return (inside ? 1 : -1) * Math.sqrt(min);
  }

  /* ================================================================== earcut (triangulation avec trous, d'après mapbox/earcut, ISC) */

  function earcut(data, holeIndices) {
    const dim = 2, hasHoles = holeIndices && holeIndices.length;
    const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
    let outerNode = linkedList(data, 0, outerLen, dim, true);
    const triangles = [];
    if (!outerNode || outerNode.next === outerNode.prev) return triangles;
    let minX, minY, invSize = 0;
    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
    if (data.length > 80 * dim) {
      minX = data[0]; minY = data[1];
      let maxX = minX, maxY = minY;
      for (let i = dim; i < outerLen; i += dim) {
        const x = data[i], y = data[i + 1];
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
      invSize = Math.max(maxX - minX, maxY - minY);
      invSize = invSize !== 0 ? 32767 / invSize : 0;
    }
    earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
    return triangles;
  }
  function linkedList(data, start, end, dim, clockwise) {
    let last;
    if (clockwise === (signedArea(data, start, end, dim) > 0)) {
      for (let i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
    } else {
      for (let i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
    }
    if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
    return last;
  }
  function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    let p = start, again;
    do {
      again = false;
      if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
        removeNode(p);
        p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else p = p.next;
    } while (again || p !== end);
    return end;
  }
  function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
    if (!ear) return;
    if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
    let stop = ear;
    while (ear.prev !== ear.next) {
      const prev = ear.prev, next = ear.next;
      if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
        triangles.push(prev.i / dim | 0, ear.i / dim | 0, next.i / dim | 0);
        removeNode(ear);
        ear = next.next; stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
        else if (pass === 1) { ear = cureLocalIntersections(filterPoints(ear), triangles, dim); earcutLinked(ear, triangles, dim, minX, minY, invSize, 2); }
        else if (pass === 2) splitEarcut(ear, triangles, dim, minX, minY, invSize);
        break;
      }
    }
  }
  function isEar(ear) {
    const a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
    const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
    let p = c.next;
    while (p !== a) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }
  function isEarHashed(ear, minX, minY, invSize) {
    const a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
    const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
    const minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
    const hit = q => q !== a && q !== c && q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1 && pointInTriangle(ax, ay, bx, by, cx, cy, q.x, q.y) && area(q.prev, q, q.next) >= 0;
    let p = ear.prevZ, n = ear.nextZ;
    while (p && p.z >= minZ && n && n.z <= maxZ) {
      if (hit(p)) return false;
      p = p.prevZ;
      if (hit(n)) return false;
      n = n.nextZ;
    }
    while (p && p.z >= minZ) { if (hit(p)) return false; p = p.prevZ; }
    while (n && n.z <= maxZ) { if (hit(n)) return false; n = n.nextZ; }
    return true;
  }
  function cureLocalIntersections(start, triangles, dim) {
    let p = start;
    do {
      const a = p.prev, b = p.next.next;
      if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
        triangles.push(a.i / dim | 0, p.i / dim | 0, b.i / dim | 0);
        removeNode(p); removeNode(p.next);
        p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return filterPoints(p);
  }
  function splitEarcut(start, triangles, dim, minX, minY, invSize) {
    let a = start;
    do {
      let b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && isValidDiagonal(a, b)) {
          let c = splitPolygon(a, b);
          a = filterPoints(a, a.next);
          c = filterPoints(c, c.next);
          earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
          earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function eliminateHoles(data, holeIndices, outerNode, dim) {
    const queue = [];
    for (let i = 0; i < holeIndices.length; i++) {
      const start = holeIndices[i] * dim, end = i < holeIndices.length - 1 ? holeIndices[i + 1] * dim : data.length;
      const list = linkedList(data, start, end, dim, false);
      if (!list) continue;
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
    queue.sort((a, b) => a.x - b.x);
    for (const h of queue) outerNode = eliminateHole(h, outerNode);
    return outerNode;
  }
  function eliminateHole(hole, outerNode) {
    const bridge = findHoleBridge(hole, outerNode);
    if (!bridge) return outerNode;
    const bridgeReverse = splitPolygon(bridge, hole);
    filterPoints(bridgeReverse, bridgeReverse.next);
    return filterPoints(bridge, bridge.next);
  }
  function findHoleBridge(hole, outerNode) {
    let p = outerNode, qx = -Infinity, m;
    const hx = hole.x, hy = hole.y;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
        if (x <= hx && x > qx) {
          qx = x;
          m = p.x < p.next.x ? p : p.next;
          if (x === hx) return m;
        }
      }
      p = p.next;
    } while (p !== outerNode);
    if (!m) return null;
    const stop = m, mx = m.x, my = m.y;
    let tanMin = Infinity;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        const tan = Math.abs(hy - p.y) / (hx - p.x);
        if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) { m = p; tanMin = tan; }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function sectorContainsSector(m, p) { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }
  function indexCurve(start, minX, minY, invSize) {
    let p = start;
    do {
      if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
      p.prevZ = p.prev; p.nextZ = p.next; p = p.next;
    } while (p !== start);
    p.prevZ.nextZ = null; p.prevZ = null;
    sortLinked(p);
  }
  function sortLinked(list) {
    let inSize = 1, numMerges;
    do {
      let p = list, tail = null;
      list = null; numMerges = 0;
      while (p) {
        numMerges++;
        let q = p, pSize = 0;
        for (let i = 0; i < inSize; i++) { pSize++; q = q.nextZ; if (!q) break; }
        let qSize = inSize;
        while (pSize > 0 || (qSize > 0 && q)) {
          let e;
          if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) { e = p; p = p.nextZ; pSize--; } else { e = q; q = q.nextZ; qSize--; }
          if (tail) tail.nextZ = e; else list = e;
          e.prevZ = tail; tail = e;
        }
        p = q;
      }
      tail.nextZ = null;
      inSize *= 2;
    } while (numMerges > 1);
    return list;
  }
  function zOrder(x, y, minX, minY, invSize) {
    x = (x - minX) * invSize | 0; y = (y - minY) * invSize | 0;
    x = (x | (x << 8)) & 0x00FF00FF; x = (x | (x << 4)) & 0x0F0F0F0F; x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555;
    y = (y | (y << 8)) & 0x00FF00FF; y = (y | (y << 4)) & 0x0F0F0F0F; y = (y | (y << 2)) & 0x33333333; y = (y | (y << 1)) & 0x55555555;
    return x | (y << 1);
  }
  function getLeftmost(start) {
    let p = start, l = start;
    do { if (p.x < l.x || (p.x === l.x && p.y < l.y)) l = p; p = p.next; } while (p !== start);
    return l;
  }
  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
      ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
        (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
  }
  function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function equals(a, b) { return a.x === b.x && a.y === b.y; }
  function intersects(p1, q1, p2, q2) {
    const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;
    return false;
  }
  function onSegment(p, q, r) { return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y); }
  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
  function intersectsPolygon(a, b) {
    let p = a;
    do {
      if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
      p = p.next;
    } while (p !== a);
    return false;
  }
  function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
  }
  function middleInside(a, b) {
    let p = a, inside = false;
    const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do {
      if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x) inside = !inside;
      p = p.next;
    } while (p !== a);
    return inside;
  }
  function splitPolygon(a, b) {
    const a2 = new Node(a.i, a.x, a.y), b2 = new Node(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a;
    a2.next = an; an.prev = a2;
    b2.next = a2; a2.prev = b2;
    bp.next = b2; b2.prev = bp;
    return b2;
  }
  function insertNode(i, x, y, last) {
    const p = new Node(i, x, y);
    if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function removeNode(p) {
    p.next.prev = p.prev; p.prev.next = p.next;
    if (p.prevZ) p.prevZ.nextZ = p.nextZ;
    if (p.nextZ) p.nextZ.prevZ = p.prevZ;
  }
  function Node(i, x, y) { this.i = i; this.x = x; this.y = y; this.prev = null; this.next = null; this.z = 0; this.prevZ = null; this.nextZ = null; this.steiner = false; }
  function signedArea(data, start, end, dim) {
    let sum = 0;
    for (let i = start, j = end - dim; i < end; i += dim) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; }
    return sum;
  }

  const api = { PATHS, allPaths, read, write, readGeometry, ringsFromTriangles, earcut, polylabel, references };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameMap = api;
})(typeof self !== 'undefined' ? self : this);
