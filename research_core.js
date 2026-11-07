/* Atelier — cœur de l'éditeur d'arbre de recherche (sans interface, testable sous Node).
 *
 * Lit et réécrit les fichiers du jeu Grande Stratégie 1936 :
 *   content/base/common/technologies*.txt  (une entrée par ligne : folder / year / title / tech / air_unlock)
 *   content/base/localisation/<langue>/*.txt (clé = "texte")
 * Les lignes que l'éditeur ne touche pas (commentaires, lignes vides, entrées inconnues) sont gardées telles quelles,
 * octet pour octet : un fichier relu puis réécrit sans modification est identique.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ format clé = valeur / { bloc } */

  function tokenize(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '{' || c === '}' || c === '=') { out.push(c); i++; continue; }
      if (c === '"') {
        let j = i + 1, v = '';
        while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && j + 1 < s.length) { v += s[j] + s[j + 1]; j += 2; } else v += s[j++]; }
        out.push({ q: v }); i = j + 1; continue;
      }
      let j = i;
      while (j < s.length && !' \t\r\n{}=#"'.includes(s[j])) j++;
      out.push(s.slice(i, j)); i = j;
    }
    return out;
  }

  /** Bloc = tableau d'éléments : { k, v } (v = texte, {q} ou bloc) ou valeur seule (liste). */
  function parseBlock(tokens, pos) {
    const items = [];
    while (pos.i < tokens.length) {
      const t = tokens[pos.i];
      if (t === '}') { pos.i++; return items; }
      if (t === '{') { pos.i++; items.push(parseBlock(tokens, pos)); continue; }
      if (tokens[pos.i + 1] === '=') {
        pos.i += 2;
        const v = tokens[pos.i];
        if (v === '{') { pos.i++; items.push({ k: t, v: parseBlock(tokens, pos) }); }
        else { pos.i++; items.push({ k: t, v }); }
        continue;
      }
      pos.i++;
      items.push(t);
    }
    return items;
  }

  function parse(text) { return parseBlock(tokenize(text), { i: 0 }); }

  function valueText(v) {
    if (Array.isArray(v)) return blockText(v);
    if (v && typeof v === 'object' && 'q' in v) return '"' + v.q + '"';
    return String(v);
  }

  function blockText(items) {
    if (!items.length) return '{ }';
    return '{ ' + items.map(it => (it && typeof it === 'object' && 'k' in it) ? it.k + ' = ' + valueText(it.v) : valueText(it)).join(' ') + ' }';
  }

  /* ------------------------------------------------------------------ une entrée (tech, title...) */

  class Entry {
    constructor(kind, items) { this.kind = kind; this.items = items; }
    get(k, def) { const it = this.items.find(x => x && x.k === k); return it ? (typeof it.v === 'object' && 'q' in it.v ? it.v.q : it.v) : def; }
    num(k, def) { const v = this.get(k); return v === undefined || Array.isArray(v) ? def : Number(v); }
    has(k) { return this.items.some(x => x && x.k === k); }
    /** Change une valeur simple ; la clé garde sa place, sinon elle va après la dernière de `after` présente. */
    set(k, v, after) {
      const it = this.items.find(x => x && x.k === k);
      if (v === undefined || v === null || v === '') { if (it) this.items.splice(this.items.indexOf(it), 1); return; }
      const val = typeof v === 'number' ? fmtNum(v) : String(v);
      if (it) { it.v = val; return; }
      this.insert({ k, v: val }, after);
    }
    list(k) { const it = this.items.find(x => x && x.k === k); return it && Array.isArray(it.v) ? it.v.filter(x => typeof x === 'string') : []; }
    setList(k, arr, after) {
      const it = this.items.find(x => x && x.k === k);
      if (!arr.length) { if (it) this.items.splice(this.items.indexOf(it), 1); return; }
      if (it) { it.v = arr.slice(); return; }
      this.insert({ k, v: arr.slice() }, after);
    }
    insert(item, after) {
      let at = -1;
      for (const a of after || []) { const i = this.items.findIndex(x => x && x.k === a); if (i > at) at = i; }
      if (at < 0) this.items.push(item); else this.items.splice(at + 1, 0, item);
    }
    text() { return this.kind + ' = ' + blockText(this.items); }
    clone() { return new Entry(this.kind, JSON.parse(JSON.stringify(this.items))); }
  }

  function fmtNum(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000); }

  /** Ordre des clés d'une recherche, pour placer une clé nouvelle au bon endroit. */
  const TECH_ORDER = ['id', 'icon', 'folder', 'x', 'y', 'small', 'year', 'cost', 'requires', 'exclusive'];
  const after = k => TECH_ORDER.slice(0, TECH_ORDER.indexOf(k));

  /* ------------------------------------------------------------------ un fichier de recherches */

  const KINDS = ['folder', 'year', 'title', 'tech', 'air_unlock'];

  class TechFile {
    constructor(name, text) {
      this.name = name;
      this.eol = text.includes('\r\n') ? '\r\n' : '\n';
      this.endsWithEol = text.endsWith('\n');
      const raw = text.split(/\r?\n/);
      if (this.endsWithEol) raw.pop();
      // ligne = { raw } gardée telle quelle, ou { entry, raw } relue et réécrite seulement si elle change
      this.lines = raw.map(r => {
        const m = /^(\w+)\s*=\s*\{/.exec(r);
        if (!m || !KINDS.includes(m[1])) return { raw: r };
        const items = parse(r);
        const e = items[0] && items[0].k === m[1] && Array.isArray(items[0].v) ? new Entry(m[1], items[0].v) : null;
        return e ? { raw: r, entry: e, was: e.text() } : { raw: r };
      });
    }
    entries(kind) { return this.lines.filter(l => l.entry && (!kind || l.entry.kind === kind)).map(l => l.entry); }
    /** Ajoute une entrée après la dernière du même genre (ou à la fin). */
    add(entry) {
      let at = -1;
      this.lines.forEach((l, i) => { if (l.entry && l.entry.kind === entry.kind) at = i; });
      const line = { raw: null, entry, was: null };
      if (at < 0) this.lines.push(line); else this.lines.splice(at + 1, 0, line);
    }
    remove(entry) { this.lines = this.lines.filter(l => l.entry !== entry); }
    text() {
      // une ligne non modifiée garde son texte d'origine (espaces, ordre des clés...)
      const out = this.lines.map(l => !l.entry ? l.raw : (l.raw !== null && l.entry.text() === l.was ? l.raw : l.entry.text()));
      return out.join(this.eol) + (this.endsWithEol ? this.eol : '');
    }
  }

  /* ------------------------------------------------------------------ fichiers de textes */

  const LOC_LINE = /^(\s*)([\w.\-]+)(\s*=\s*)"(.*)"(\s*)$/;

  class LocFile {
    constructor(name, text) {
      this.name = name;
      this.eol = text.includes('\r\n') ? '\r\n' : '\n';
      this.endsWithEol = text.endsWith('\n');
      this.bom = text.charCodeAt(0) === 0xFEFF;
      const raw = (this.bom ? text.slice(1) : text).split(/\r?\n/);
      if (this.endsWithEol) raw.pop();
      this.lines = raw;
      this.changed = false;
    }
    keys() {
      const o = new Map();
      this.lines.forEach((l, i) => { const m = LOC_LINE.exec(l); if (m) o.set(m[2], { line: i, value: unescape(m[4]) }); });
      return o;
    }
    set(key, value) {
      const i = this.lines.findIndex(l => { const m = LOC_LINE.exec(l); return m && m[2] === key; });
      const line = key + ' = "' + escape(value) + '"';
      if (i >= 0) {
        const m = LOC_LINE.exec(this.lines[i]);
        const nl = m[1] + key + m[3] + '"' + escape(value) + '"' + m[5];
        if (nl !== this.lines[i]) { this.lines[i] = nl; this.changed = true; }
      } else { this.lines.push(line); this.changed = true; }
    }
    remove(key) {
      const n = this.lines.length;
      this.lines = this.lines.filter(l => { const m = LOC_LINE.exec(l); return !(m && m[2] === key); });
      if (this.lines.length !== n) this.changed = true;
    }
    text() { return (this.bom ? '﻿' : '') + this.lines.join(this.eol) + (this.endsWithEol ? this.eol : ''); }
  }

  const escape = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const unescape = s => s.replace(/\\(.)/g, (_, c) => c === 'n' ? '\n' : c);

  /** Les textes d'une langue : tous ses fichiers ; une clé nouvelle va dans `home` (technologies.txt). */
  class Loc {
    constructor(files, home) {
      this.files = files;   // [LocFile]
      this.home = home;
      this.where = new Map();
      this.values = new Map();
      for (const f of files) for (const [k, v] of f.keys()) if (!this.where.has(k)) { this.where.set(k, f); this.values.set(k, v.value); }
    }
    get(k) { return this.values.get(k); }
    set(k, v) {
      if (this.values.get(k) === v) return;
      const f = this.where.get(k) || this.files.find(x => x.name === this.home) || this.files[0];
      if (!f) return;
      f.set(k, v); this.where.set(k, f); this.values.set(k, v);
    }
    remove(k) { const f = this.where.get(k); if (f) f.remove(k); this.where.delete(k); this.values.delete(k); }
    changed() { return this.files.filter(f => f.changed); }
  }

  /* ------------------------------------------------------------------ l'arbre entier */

  class Tree {
    /** files = [TechFile], locs = { french: Loc, english: Loc } */
    constructor(files, locs) {
      this.files = files; this.locs = locs;
      this.saved = files.map(f => f.text());
    }
    all(kind) { return this.files.flatMap(f => f.entries(kind)); }
    folders() { return this.all('folder').map(e => e.get('id')); }
    folderVertical(id) { const f = this.all('folder').find(e => e.get('id') === id); return !f || f.get('vertical') !== 'no'; }
    techs(folder) { return this.all('tech').filter(t => !folder || t.get('folder') === folder); }
    tech(id) { return this.all('tech').find(t => t.get('id') === id); }
    years(folder) { return this.all('year').filter(e => e.get('folder') === folder).map(e => ({ year: e.num('year'), at: e.num('at'), e })).sort((a, b) => a.at - b.at); }
    titles(folder) { return this.all('title').filter(e => e.get('folder') === folder); }
    fileOf(entry) { return this.files.find(f => f.lines.some(l => l.entry === entry)); }
    /** Fichier où va une recherche nouvelle du dossier : celui qui en a déjà, sinon celui qui le déclare. */
    fileForFolder(folder) {
      return this.files.find(f => f.entries('tech').some(t => t.get('folder') === folder))
        || this.files.find(f => f.entries('folder').some(e => e.get('id') === folder)) || this.files[0];
    }
    name(key, lang) { return (this.locs[lang || 'french'] && this.locs[lang || 'french'].get(key)) ?? ''; }
    setName(key, value, lang) { const l = this.locs[lang || 'french']; if (l) l.set(key, value); }

    newId(base) {
      let n = 1, id;
      do id = base + '_' + n++; while (this.tech(id));
      return id;
    }

    /** Recherche nouvelle à cette place ; l'année est celle de la bande où elle tombe. */
    addTech(folder, x, y) {
      const id = this.newId('nouvelle');
      const vertical = this.folderVertical(folder);
      const ys = this.years(folder);
      let year = ys.length ? ys[0].year : 1936;
      for (const b of ys) if ((vertical ? y : x) >= b.at - 10) year = b.year;
      const e = new Entry('tech', [{ k: 'id', v: id }, { k: 'folder', v: folder }, { k: 'x', v: fmtNum(Math.round(x)) }, { k: 'y', v: fmtNum(Math.round(y)) }, { k: 'year', v: fmtNum(year) }, { k: 'cost', v: '1' }]);
      this.fileForFolder(folder).add(e);
      this.setName('tech_' + id, 'Nouvelle recherche', 'french');
      this.setName('tech_' + id, 'New technology', 'english');
      return e;
    }

    duplicate(t, dx, dy) {
      const e = t.clone();
      const id = this.newId(t.get('id'));
      e.set('id', id);
      e.set('x', t.num('x', 0) + dx); e.set('y', t.num('y', 0) + dy);
      this.fileOf(t).add(e);
      for (const lang of Object.keys(this.locs)) { const v = this.name('tech_' + t.get('id'), lang); if (v) this.setName('tech_' + id, v + ' (2)', lang); }
      return e;
    }

    /** Supprime une recherche et tout ce qui la nomme (prérequis, exclusions, déblocages de pièces). */
    removeTech(t) {
      const id = t.get('id');
      this.fileOf(t).remove(t);
      for (const o of this.all('tech')) {
        for (const k of ['requires', 'exclusive']) { const l = o.list(k); if (l.includes(id)) o.setList(k, l.filter(x => x !== id), after(k)); }
      }
      for (const f of this.files) for (const u of f.entries('air_unlock')) if (u.get('tech') === id) f.remove(u);
      for (const lang of Object.keys(this.locs)) this.locs[lang].remove('tech_' + id);
    }

    /** Change l'identifiant partout : prérequis, exclusions, déblocages, textes. */
    renameTech(t, id) {
      const old = t.get('id');
      if (!id || id === old) return true;
      if (!/^[a-z0-9_]+$/.test(id) || this.tech(id)) return false;
      t.set('id', id);
      if (!t.has('icon')) t.set('icon', old, after('icon'));   // l'image gardait le nom d'origine
      for (const o of this.all('tech'))
        for (const k of ['requires', 'exclusive']) { const l = o.list(k); if (l.includes(old)) o.setList(k, l.map(x => x === old ? id : x), after(k)); }
      for (const f of this.files) for (const u of f.entries('air_unlock')) if (u.get('tech') === old) u.set('tech', id);
      for (const lang of Object.keys(this.locs)) {
        const v = this.name('tech_' + old, lang);
        this.locs[lang].remove('tech_' + old);
        if (v) this.setName('tech_' + id, v, lang);
      }
      return true;
    }

    /** child demande parent avant elle (un lien de l'arbre). */
    link(parent, child) {
      const p = parent.get('id');
      if (parent === child || this.leadsTo(child, parent)) return false;
      const l = child.list('requires');
      if (!l.includes(p)) child.setList('requires', l.concat(p), after('requires'));
      return true;
    }
    unlink(parent, child) { child.setList('requires', child.list('requires').filter(x => x !== parent.get('id')), after('requires')); }
    /** a mène à b par les prérequis (b demande a, de proche en proche) : un lien b → a ferait une boucle. */
    leadsTo(a, b) {
      const seen = new Set(), stack = [b];
      while (stack.length) {
        const t = stack.pop();
        if (t === a) return true;
        if (seen.has(t)) continue;
        seen.add(t);
        for (const r of t.list('requires')) { const o = this.tech(r); if (o) stack.push(o); }
      }
      return false;
    }
    setExclusive(a, b, on) {
      for (const [x, y] of [[a, b], [b, a]]) {
        const l = x.list('exclusive').filter(i => i !== y.get('id'));
        x.setList('exclusive', on ? l.concat(y.get('id')) : l, after('exclusive'));
      }
    }

    /** Ce qui empêcherait le jeu de charger, et ce qui est louche. */
    check() {
      const errs = [], warns = [];
      const ids = new Map();
      const folders = new Set(this.folders());
      for (const t of this.all('tech')) {
        const id = t.get('id');
        if (!id) { errs.push('Une recherche sans identifiant'); continue; }
        if (ids.has(id)) errs.push(`« ${id} » existe deux fois`);
        ids.set(id, t);
        if (!folders.has(t.get('folder'))) errs.push(`« ${id} » : dossier inconnu « ${t.get('folder')} »`);
        if (!(t.num('year') > 0)) errs.push(`« ${id} » : année manquante`);
        if (isNaN(t.num('x')) || isNaN(t.num('y'))) errs.push(`« ${id} » : position manquante`);
      }
      for (const t of this.all('tech'))
        for (const k of ['requires', 'exclusive'])
          for (const r of t.list(k)) if (!ids.has(r)) errs.push(`« ${t.get('id')} » demande « ${r} », qui n'existe pas`);
      for (const t of this.all('tech')) if (t.list('requires').some(r => ids.has(r) && this.leadsTo(t, ids.get(r)))) errs.push(`« ${t.get('id')} » : boucle de prérequis`);
      for (const t of this.all('tech')) if (!this.name('tech_' + t.get('id'), 'french')) warns.push(`« ${t.get('id')} » n'a pas de nom en français`);
      return { errs: [...new Set(errs)], warns };
    }

    /** Fichiers à réécrire : chemin relatif à content/base → texte. */
    changes() {
      const out = [];
      this.files.forEach((f, i) => { const t = f.text(); if (t !== this.saved[i]) out.push({ path: 'common/' + f.name, text: t }); });
      for (const [lang, l] of Object.entries(this.locs)) for (const f of l.changed()) out.push({ path: `localisation/${lang}/${f.name}`, text: f.text() });
      return out;
    }
    markSaved() {
      this.saved = this.files.map(f => f.text());
      for (const l of Object.values(this.locs)) for (const f of l.files) f.changed = false;
    }

    /** État complet (annuler / rétablir) : le texte des fichiers. */
    snapshot() {
      return JSON.stringify({
        files: this.files.map(f => ({ name: f.name, text: f.text() })),
        locs: Object.fromEntries(Object.entries(this.locs).map(([k, l]) => [k, l.files.map(f => ({ name: f.name, text: f.text(), changed: f.changed }))])),
      });
    }
    static restore(snap, saved, homes) {
      const d = JSON.parse(snap);
      const files = d.files.map(f => new TechFile(f.name, f.text));
      const locs = {};
      for (const [lang, fs] of Object.entries(d.locs)) {
        const lf = fs.map(f => { const x = new LocFile(f.name, f.text); x.changed = f.changed; return x; });
        locs[lang] = new Loc(lf, homes || 'technologies.txt');
      }
      const t = new Tree(files, locs);
      if (saved) t.saved = saved;
      return t;
    }
  }

  const api = { tokenize, parse, blockText, Entry, TechFile, LocFile, Loc, Tree, TECH_ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResearchCore = api;
})(typeof self !== 'undefined' ? self : this);
