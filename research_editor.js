/* Atelier — page d'accueil (toutes les parties du jeu à modifier) et éditeur d'arbre de recherche.
 *
 * Relié au jeu : on choisit une fois le dossier du jeu (Chrome / Edge sur PC, accès aux fichiers), l'atelier lit
 * content/base (recherches, textes, images) et « Envoyer dans le jeu » réécrit les fichiers. Relancer le jeu suffit.
 * Le cœur (lecture / écriture des fichiers) est dans research_core.js.
 */
(function () {
  'use strict';
  const R = window.ResearchCore;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = msg => (window.toast ? window.toast(msg) : console.log(msg));

  /* ================================================================== styles */
  const css = `
#hub{position:absolute;inset:0;overflow:auto;padding:calc(26px + var(--safe-t)) 26px 40px;background:radial-gradient(circle at 20% 0%,#1b2433 0,#0e0f13 55%)}
#hub h1{margin:0;font-size:28px;letter-spacing:.02em}
#hub .sub{color:var(--dim);margin:4px 0 20px}
#hubGame{display:flex;gap:10px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:22px;max-width:980px}
#hubGame .dot{width:10px;height:10px;border-radius:50%;background:var(--danger);flex:none}
#hubGame .dot.on{background:var(--ok)}
#hubGame span{flex:1;color:var(--dim)}
#hubGame b{color:var(--text)}
#hubTiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;max-width:1100px}
.tile{position:relative;background:linear-gradient(160deg,#1d212b,#15171e);border:1px solid var(--line);border-radius:16px;padding:18px 18px 16px;cursor:pointer;min-height:150px;display:flex;flex-direction:column;gap:6px;transition:transform .12s,border-color .12s}
.tile:hover{border-color:var(--accent);transform:translateY(-2px)}
.tile .ic{font-size:38px;line-height:1}
.tile b{font-size:17px}
.tile span{color:var(--dim);font-size:13px}
.tile.soon{cursor:default;opacity:.5}
.tile.soon:hover{border-color:var(--line);transform:none}
.tile .tag{position:absolute;top:12px;right:12px;font-size:11px;border:1px solid var(--line);border-radius:10px;padding:1px 8px;color:var(--dim)}
.tile.ready .tag{border-color:var(--ok);color:var(--ok)}
#home h1 button{margin-right:10px;vertical-align:middle}

#research{position:absolute;inset:0;display:flex;flex-direction:column;background:#0e0f13}
#rTop{display:flex;gap:8px;align-items:center;padding:calc(6px + var(--safe-t)) 8px 6px;border-bottom:1px solid var(--line);background:#14161c;flex-wrap:wrap}
#rTabs{display:flex;gap:4px;flex-wrap:wrap}
#rTabs button{padding:4px 10px}
#rTabs button.on{background:var(--accent);border-color:var(--accent);color:#06121f}
#rStatus{color:var(--dim);font-size:12px;margin-left:auto;white-space:nowrap}
#rStatus.dirty{color:var(--warn)}
#rMain{flex:1;display:flex;min-height:0}
#rView{flex:1;overflow:auto;position:relative;background:#2b3038 linear-gradient(#0000 0 0);cursor:default;outline:none}
#rView.pan{cursor:grabbing}
#rSurf{position:relative;transform-origin:0 0}
#rSurf .years{position:absolute;left:0;top:0;pointer-events:none}
.ryl{position:absolute;color:#cfd5df;font:600 13px system-ui;opacity:.75}
.ryline{position:absolute;background:#ffffff14}
.rtitle{position:absolute;color:#aeb6c4;font:600 15px system-ui;white-space:nowrap;cursor:move;padding:0 4px;border-radius:4px}
.rtitle:hover,.rtitle.sel{background:#4da3ff33;color:#fff}
#rLinks{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
#rLinks path{fill:none}
#rLinks .hit{stroke:#0000;stroke-width:12;cursor:pointer;pointer-events:stroke}
#rLinks .req{stroke:#9aa3b2;stroke-width:2}
#rLinks .req.sel{stroke:var(--accent);stroke-width:3}
#rLinks .exc{stroke:#ff6b6b;stroke-width:2;stroke-dasharray:6 5}
#rLinks .exc.sel{stroke-width:3}
#rLinks .tmp{stroke:var(--accent);stroke-width:2;stroke-dasharray:4 4}
.rbox{position:absolute;height:62px;background:linear-gradient(#5a6170,#454b57);border:2px solid #23262e;border-radius:5px;box-shadow:0 2px 4px #0007;cursor:move;user-select:none;overflow:visible}
.rbox:hover{border-color:#8fb8e8}
.rbox.sel{border-color:var(--accent);box-shadow:0 0 0 2px #4da3ff88,0 2px 6px #000a}
.rbox.link-target{border-color:var(--ok)}
.rbox img{position:absolute;left:6px;top:3px;width:calc(100% - 12px);height:40px;object-fit:contain;pointer-events:none}
.rbox.small img{left:4px;top:5px;width:54px;height:52px}
.rbox .nm{position:absolute;left:5px;right:5px;bottom:2px;font-size:11.5px;color:#eef1f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 1px #000}
.rbox .yr{position:absolute;left:3px;top:1px;font-size:10px;color:#ffd27a;text-shadow:0 1px 1px #000}
.rbox .port{position:absolute;width:14px;height:14px;border-radius:50%;background:var(--accent);border:2px solid #0e0f13;cursor:crosshair;opacity:0;transition:opacity .1s}
.rbox:hover .port,.rbox.sel .port{opacity:1}
.rbox .ext{position:absolute;right:3px;top:1px;font-size:10px;color:#9fd0ff}
#rBand{position:absolute;border:1px dashed var(--accent);background:#4da3ff1a;pointer-events:none}
#rSide{width:300px;flex:none;overflow:auto;border-left:1px solid var(--line);background:#171920;padding:12px}
#rSide h3{margin:0 0 8px;font-size:13px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
#rSide .row label{width:84px}
#rSide .pic{height:110px;background:#0f1117;border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;cursor:pointer}
#rSide .pic img{max-width:92%;max-height:96px}
#rSide .chips{padding:2px 0 6px;display:flex;flex-wrap:wrap;gap:4px}
#rSide .chip{display:inline-flex;gap:4px;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:1px 4px 1px 9px;font-size:12px}
#rSide .chip button{padding:0 6px;border:0;background:none;color:var(--dim)}
#rSide textarea{width:100%;min-height:110px;background:#0f1117;border:1px solid var(--line);border-radius:7px;color:var(--text);font:12px ui-monospace,Consolas,monospace;padding:6px}
#rSide textarea.bad{border-color:var(--danger)}
#rSide .help{color:var(--dim);font-size:12.5px;line-height:1.5}
#rSide .help kbd{background:#0f1117;border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:11px}
#rSide hr{border:0;border-top:1px solid var(--line);margin:12px 0}
#rSide .yrow{display:flex;gap:4px;margin-bottom:4px}
#rSide .yrow input{width:70px}
#rIcons{position:fixed;inset:0;background:#000a;z-index:60;display:flex;align-items:center;justify-content:center}
#rIcons .box{background:var(--panel);border:1px solid var(--line);border-radius:14px;width:min(900px,96vw);height:min(640px,90vh);display:flex;flex-direction:column}
#rIcons .hd{display:flex;gap:8px;align-items:center;padding:10px;border-bottom:1px solid var(--line)}
#rIcons .grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;padding:10px}
#rIcons .grid div{background:#0f1117;border:1px solid var(--line);border-radius:8px;padding:6px;cursor:pointer;text-align:center;font-size:11px;color:var(--dim)}
#rIcons .grid div:hover{border-color:var(--accent)}
#rIcons .grid img{width:100%;height:46px;object-fit:contain;display:block;margin-bottom:3px}
`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  /* ================================================================== mémoire locale (dossier du jeu) */
  const KV = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('atelier', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { KV.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    async get(k) { if (!KV.db) await KV.open(); return new Promise(res => { const q = KV.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); },
    async set(k, v) { if (!KV.db) await KV.open(); return new Promise((res, rej) => { const t = KV.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
    async del(k) { if (!KV.db) await KV.open(); return new Promise(res => { const t = KV.db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); t.onerror = () => res(); }); },
  };

  /* ================================================================== le dossier du jeu */
  const Game = {
    base: null,    // dossier content/base
    label: '',
    urls: new Map(),
    supported: typeof window.showDirectoryPicker === 'function',

    /** Accepte le dossier du jeu, son dossier content ou content/base. */
    async use(handle) {
      const tries = [['content', 'base'], ['base'], []];
      for (const p of tries) {
        try {
          let d = handle;
          for (const n of p) d = await d.getDirectoryHandle(n);
          const common = await d.getDirectoryHandle('common');
          await common.getFileHandle('technologies.txt');
          Game.base = d; Game.label = handle.name; Game.urls.clear();
          return true;
        } catch (e) { /* pas ici */ }
      }
      return false;
    },
    async pick() {
      const h = await window.showDirectoryPicker({ id: 'gs1936', mode: 'readwrite' });
      if (!(await Game.use(h))) { toast('Ce dossier n\'est pas celui du jeu (il faut content/base/common/technologies.txt)'); return false; }
      await KV.set('gameDir', h);
      return true;
    },
    /** Reprend le dossier choisi la dernière fois ; ask = on peut demander l'accès (après un clic). */
    async restore(ask) {
      if (Game.base) return true;
      const h = await KV.get('gameDir').catch(() => null);
      if (!h || !h.queryPermission) return false;
      let p = await h.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'readwrite' });
      return p === 'granted' && Game.use(h);
    },
    async remembered() { const h = await KV.get('gameDir').catch(() => null); return h ? h.name : ''; },
    async dir(path) { let d = Game.base; for (const n of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(n); return d; },
    async list(path) { const out = []; const d = await Game.dir(path); for await (const [n, h] of d.entries()) if (h.kind === 'file') out.push(n); return out.sort(); },
    async read(path) { const i = path.lastIndexOf('/'); const f = await (await Game.dir(path.slice(0, i))).getFileHandle(path.slice(i + 1)); return (await f.getFile()).text(); },
    async write(path, text) {
      const i = path.lastIndexOf('/');
      const f = await (await Game.dir(path.slice(0, i))).getFileHandle(path.slice(i + 1), { create: true });
      const w = await f.createWritable();
      await w.write(text);
      await w.close();
    },
    async url(path) {
      if (Game.urls.has(path)) return Game.urls.get(path);
      let u = '';
      try { const i = path.lastIndexOf('/'); const f = await (await Game.dir(path.slice(0, i))).getFileHandle(path.slice(i + 1)); u = URL.createObjectURL(await f.getFile()); } catch (e) { u = ''; }
      Game.urls.set(path, u);
      return u;
    },
  };

  /* ================================================================== page d'accueil */
  const AREAS = [
    { id: 'map', ic: '🗺️', name: 'Carte', text: 'Provinces, pays, régions, terrains, détroits, zones navales et aériennes.', ready: true },
    { id: 'research', ic: '🔬', name: 'Arbre de recherche', text: 'Placer, relier, ajouter des recherches comme dans le jeu, puis les envoyer dans le jeu.', ready: true },
    { id: 'equipment', ic: '🔫', name: 'Équipements', text: 'Matériel, niveaux, pièces des chars, avions et navires.' },
    { id: 'units', ic: '🪖', name: 'Unités', text: 'Bataillons, compagnies de soutien, divisions de départ.' },
    { id: 'economy', ic: '🏭', name: 'Économie', text: 'Bâtiments, ressources, usines et règles de production.' },
    { id: 'countries', ic: '🏳️', name: 'Pays', text: 'Pays, couleurs, chefs, politique, scénario de 1936.' },
    { id: 'leaders', ic: '🎖️', name: 'Généraux et amiraux', text: 'Chefs militaires et leurs traits.' },
    { id: 'texts', ic: '🔤', name: 'Textes', text: 'Noms et traductions (français, anglais).' },
    { id: 'images', ic: '🖼️', name: 'Images', text: 'Icônes et illustrations du jeu.' },
  ];

  async function showHub() {
    for (const id of ['#home', '#editor', '#research']) { const e = $(id); if (e) e.hidden = true; }
    $('#hub').hidden = false;
    const known = await Game.remembered();
    const ok = !!Game.base;
    $('#hubGame').innerHTML = !Game.supported
      ? `<div class="dot"></div><span>Relier l'atelier au jeu demande Chrome ou Edge sur PC (accès aux fichiers). La carte marche partout.</span>`
      : `<div class="dot ${ok ? 'on' : ''}"></div><span>Dossier du jeu : <b>${ok ? esc(Game.label) : known ? esc(known) + ' (accès à redonner)' : 'non choisi'}</b>${ok ? ' — les modifications sont écrites directement dans content/base.' : ''}</span>
         <button id="hubPick">${ok || known ? 'Changer' : 'Choisir le dossier du jeu'}</button>`;
    if ($('#hubPick')) $('#hubPick').onclick = async () => { try { if (await Game.pick()) showHub(); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } };
    $('#hubTiles').innerHTML = AREAS.map(a => `<div class="tile ${a.ready ? 'ready' : 'soon'}" data-a="${a.id}"><span class="tag">${a.ready ? 'Prêt' : 'Bientôt'}</span><div class="ic">${a.ic}</div><b>${a.name}</b><span>${a.text}</span></div>`).join('');
    for (const t of document.querySelectorAll('#hubTiles .tile.ready')) t.onclick = () => openArea(t.dataset.a);
  }

  async function openArea(id) {
    if (id === 'map') { $('#hub').hidden = true; window.showHome(); return; }
    if (id === 'research') {
      if (!Game.supported) { toast('Il faut Chrome ou Edge sur PC pour lire les fichiers du jeu'); return; }
      try {
        if (!(await Game.restore(true)) && !(await Game.pick())) return;
      } catch (e) { if (e.name !== 'AbortError') toast(e.message); return; }
      await Editor.open();
    }
  }

  /* ================================================================== éditeur d'arbre */
  const BOX_W = 134, SMALL_W = 62, BOX_H = 62, SNAP = 10;
  const DRAFT = 'researchDraft';   // clé du brouillon dans IndexedDB
  const KNOWN = new Set(['id', 'icon', 'folder', 'x', 'y', 'small', 'year', 'cost', 'requires', 'exclusive']);

  const Editor = {
    tree: null, folder: '', zoom: 1, sel: new Set(), selLink: null, selTitle: null,
    undo: [], redo: [], icons: [], drag: null, el: new Map(),

    async load() {
      busy(true, 'Lecture des fichiers du jeu…');
      try {
        const names = (await Game.list('common')).filter(n => /^technologies.*\.txt$/.test(n));
        const files = [];
        for (const n of names) files.push(new R.TechFile(n, await Game.read('common/' + n)));
        const locs = {};
        for (const lang of ['french', 'english']) {
          let list = [];
          try { list = (await Game.list('localisation/' + lang)).filter(n => n.endsWith('.txt')); } catch (e) { continue; }
          const lf = [];
          for (const n of list) lf.push(new R.LocFile(n, await Game.read(`localisation/${lang}/${n}`)));
          locs[lang] = new R.Loc(lf, 'technologies.txt');
        }
        Editor.tree = new R.Tree(files, locs);
        Editor.disk = Editor.tree.snapshot();
        // brouillon enregistré sans l'envoyer dans le jeu : on le reprend
        const d = await KV.get(DRAFT).catch(() => null);
        if (d && d.snap && d.snap !== Editor.disk
          && (d.disk === Editor.disk || confirm('Les fichiers du jeu ont changé depuis ton brouillon enregistré. Reprendre le brouillon quand même ? (Annuler = ouvrir le jeu tel qu\'il est, le brouillon reste gardé)'))) {
          Editor.tree = R.Tree.restore(d.snap, Editor.tree.saved);
          toast('Brouillon repris — pas encore envoyé dans le jeu');
        }
        Editor.savedSig = Editor.sig();
        try { Editor.icons = (await Game.list('gfx/interface/research')).filter(n => n.endsWith('.png')).map(n => n.slice(0, -4)); } catch (e) { Editor.icons = []; }
        Editor.undo = []; Editor.redo = [];
        if (!Editor.tree.folders().includes(Editor.folder)) Editor.folder = Editor.tree.folders()[0] || '';
      } finally { busy(false); }
    },

    async open() {
      await Editor.load();
      $('#hub').hidden = true; $('#research').hidden = false;
      Editor.sel.clear(); Editor.selLink = null; Editor.selTitle = null;
      Editor.render();
      $('#rView').scrollTo(0, 0);
      $('#rView').focus();
    },

    dirty() { return Editor.tree && Editor.tree.changes().length > 0; },
    /** Des modifications ni enregistrées ni envoyées. */
    unsaved() { return !!Editor.tree && Editor.sig() !== Editor.savedSig; },
    /** Empreinte légère de l'état (recherches + textes changés) : le snapshot complet pèse plusieurs Mo. */
    sig() { const t = Editor.tree; return t.files.map(f => f.text()).join('\0') + '\0\0' + Object.entries(t.locs).map(([k, l]) => k + l.files.filter(f => f.changed).map(f => f.name + '\0' + f.text()).join('\0')).join('\0'); },

    status() {
      const n = Editor.tree.changes().length;
      const u = Editor.unsaved();
      const s = $('#rStatus');
      const files = `${n} fichier${n > 1 ? 's' : ''} à envoyer dans le jeu`;
      s.textContent = u ? 'Modifications non enregistrées' + (n ? ' · ' + files : '') : n ? 'Brouillon enregistré · ' + files : 'À jour avec le jeu';
      s.classList.toggle('dirty', u || n > 0);
      $('#rUndo').disabled = !Editor.undo.length; $('#rRedo').disabled = !Editor.redo.length;
      $('#rSave').disabled = !u;
      $('#rSend').disabled = !n;
    },

    /** Garde le travail dans le navigateur sans toucher au jeu. */
    async save() {
      const snap = Editor.tree.snapshot();
      try {
        if (snap === Editor.disk) await KV.del(DRAFT);
        else await KV.set(DRAFT, { snap, disk: Editor.disk, at: Date.now() });
        Editor.savedSig = Editor.sig();
        toast('Enregistré (pas encore dans le jeu)');
      } catch (e) { toast('Enregistrement impossible : ' + e.message); }
      Editor.status();
    },

    /** À appeler avant une modification : elle pourra être annulée. */
    before() {
      Editor.undo.push(Editor.tree.snapshot());
      if (Editor.undo.length > 200) Editor.undo.shift();
      Editor.redo = [];
    },
    restore(snap) {
      const ids = [...Editor.sel].map(t => t.get('id'));
      Editor.tree = R.Tree.restore(snap, Editor.tree.saved);
      Editor.sel = new Set(ids.map(i => Editor.tree.tech(i)).filter(Boolean));
      Editor.selLink = null; Editor.selTitle = null;
      Editor.render();
    },
    doUndo() { if (!Editor.undo.length) return; Editor.redo.push(Editor.tree.snapshot()); Editor.restore(Editor.undo.pop()); },
    doRedo() { if (!Editor.redo.length) return; Editor.undo.push(Editor.tree.snapshot()); Editor.restore(Editor.redo.pop()); },

    vertical() { return Editor.tree.folderVertical(Editor.folder); },
    /** Ces recherches et toutes celles du même dossier qui les demandent, de proche en proche. */
    withChildren(list) {
      const kids = new Map();
      for (const t of Editor.tree.techs(Editor.folder))
        for (const r of t.list('requires')) { if (!kids.has(r)) kids.set(r, []); kids.get(r).push(t); }
      const out = new Set(list), stack = [...list];
      while (stack.length) for (const c of kids.get(stack.pop().get('id')) || []) if (!out.has(c)) { out.add(c); stack.push(c); }
      return [...out];
    },
    W(t) { return t.get('small') === 'yes' ? SMALL_W : BOX_W; },
    name(t) { return Editor.tree.name('tech_' + t.get('id')) || t.get('id'); },

    /* ---------------------------------------------------------------- dessin */
    render() {
      const tree = Editor.tree;
      $('#rTabs').innerHTML = tree.folders().map(f => `<button data-f="${esc(f)}" class="${f === Editor.folder ? 'on' : ''}" title="${esc(f)}">${esc(tree.name('techfolder_' + f) || f)}</button>`).join('')
        + `<button id="rNewFolder" title="Nouveau dossier">＋</button>`;
      for (const b of document.querySelectorAll('#rTabs button[data-f]')) b.onclick = () => { Editor.folder = b.dataset.f; Editor.sel.clear(); Editor.selLink = null; Editor.selTitle = null; Editor.render(); $('#rView').scrollTo(0, 0); };
      $('#rNewFolder').onclick = Editor.newFolder;

      const surf = $('#rSurf');
      const techs = tree.techs(Editor.folder);
      const years = tree.years(Editor.folder);
      const vertical = Editor.vertical();
      let mx = 800, my = 600;
      for (const t of techs) { mx = Math.max(mx, t.num('x', 0) + BOX_W + 300); my = Math.max(my, t.num('y', 0) + BOX_H + 300); }
      for (const tl of tree.titles(Editor.folder)) { mx = Math.max(mx, tl.num('x', 0) + 400); my = Math.max(my, tl.num('y', 0) + 200); }
      const off = vertical ? { x: 70, y: 10 } : { x: 10, y: 40 };   // place des années
      Editor.off = off;
      surf.style.width = (mx + off.x) + 'px'; surf.style.height = (my + off.y) + 'px';
      surf.style.transform = `scale(${Editor.zoom})`;
      $('#rSize').style.width = (mx + off.x) * Editor.zoom + 'px'; $('#rSize').style.height = (my + off.y) * Editor.zoom + 'px';

      let h = '';
      for (const y of years) {
        if (vertical) h += `<div class="ryline" style="left:0;top:${off.y + y.at - 8}px;width:${mx + off.x}px;height:1px"></div><div class="ryl" style="left:8px;top:${off.y + y.at - 4}px">${y.year}</div>`;
        else h += `<div class="ryline" style="top:0;left:${off.x + y.at - 8}px;height:${my + off.y}px;width:1px"></div><div class="ryl" style="top:10px;left:${off.x + y.at}px">${y.year}</div>`;
      }
      for (const tl of tree.titles(Editor.folder)) {
        const id = tl.get('id');
        h += `<div class="rtitle ${Editor.selTitle === tl ? 'sel' : ''}" data-title="${esc(id)}" style="left:${off.x + tl.num('x', 0)}px;top:${off.y + tl.num('y', 0)}px">${esc(tree.name('techtitle_' + id) || id)}</div>`;
      }
      h += `<svg id="rLinks" width="${mx + off.x}" height="${my + off.y}"></svg>`;
      for (const t of techs) {
        const id = t.get('id'), small = t.get('small') === 'yes';
        const other = t.list('requires').some(r => { const o = tree.tech(r); return o && o.get('folder') !== Editor.folder; });
        h += `<div class="rbox ${small ? 'small' : ''} ${Editor.sel.has(t) ? 'sel' : ''}" data-t="${esc(id)}" title="${esc(Editor.name(t))}">`
          + `<img data-icon="${esc(t.get('icon') || id)}" alt="">`
          + `<span class="yr">${t.num('year', '')}</span>${other ? '<span class="ext" title="Demande une recherche d\'un autre dossier">↗</span>' : ''}`
          + (small ? '' : `<span class="nm">${esc(Editor.name(t))}</span>`)
          + `<div class="port" title="Glisser vers une autre case : elle demandera celle-ci"></div></div>`;
      }
      surf.innerHTML = h;
      Editor.el.clear();
      for (const b of surf.querySelectorAll('.rbox')) Editor.el.set(b.dataset.t, b);
      for (const t of techs) Editor.place(t);
      Editor.links();
      Editor.loadImages();
      Editor.side();
      Editor.status();
    },

    place(t) {
      const b = Editor.el.get(t.get('id'));
      if (!b) return;
      const small = t.get('small') === 'yes';
      b.style.left = (Editor.off.x + t.num('x', 0)) + 'px';
      b.style.top = (Editor.off.y + t.num('y', 0)) + 'px';
      b.style.width = Editor.W(t) + 'px';
      const p = b.querySelector('.port');
      if (Editor.vertical()) { p.style.left = (Editor.W(t) / 2 - 9) + 'px'; p.style.top = (BOX_H - 9) + 'px'; }
      else { p.style.left = (Editor.W(t) - 9) + 'px'; p.style.top = (BOX_H / 2 - 9) + 'px'; }
      b.classList.toggle('small', small);
    },

    async loadImages() {
      for (const img of document.querySelectorAll('#rSurf img[data-icon]')) {
        const u = await Game.url(`gfx/interface/research/${img.dataset.icon}.png`);
        if (u) img.src = u; else img.removeAttribute('src');
      }
    },

    rect(t) { return { x: Editor.off.x + t.num('x', 0), y: Editor.off.y + t.num('y', 0), w: Editor.W(t), h: BOX_H }; },

    path(a, b) {
      const A = Editor.rect(a), B = Editor.rect(b);
      if (Editor.vertical()) {
        const xa = A.x + A.w / 2, ya = A.y + A.h, xb = B.x + B.w / 2, yb = B.y;
        if (yb < ya) return `M${xa},${A.y + A.h / 2}L${xb},${B.y + B.h / 2}`;
        const m = (ya + yb) / 2;
        return `M${xa},${ya}V${m}H${xb}V${yb}`;
      }
      const xa = A.x + A.w, ya = A.y + A.h / 2, xb = B.x, yb = B.y + B.h / 2;
      if (xb < xa) return `M${A.x + A.w / 2},${ya}L${B.x + B.w / 2},${yb}`;
      const m = (xa + xb) / 2;
      return `M${xa},${ya}H${m}V${yb}H${xb}`;
    },

    links() {
      const svg = $('#rLinks');
      if (!svg) return;
      const tree = Editor.tree;
      let h = '';
      const seen = new Set();
      for (const t of tree.techs(Editor.folder)) {
        for (const r of t.list('requires')) {
          const p = tree.tech(r);
          if (!p || p.get('folder') !== Editor.folder) continue;
          const key = r + '>' + t.get('id');
          const sel = Editor.selLink === 'req:' + key;
          const d = Editor.path(p, t);
          h += `<path class="req ${sel ? 'sel' : ''}" d="${d}"/><path class="hit" data-link="req:${esc(key)}" d="${d}"/>`;
        }
        for (const x of t.list('exclusive')) {
          const o = tree.tech(x);
          if (!o || o.get('folder') !== Editor.folder) continue;
          const key = [t.get('id'), x].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const A = Editor.rect(t), B = Editor.rect(o);
          const d = `M${A.x + A.w / 2},${A.y + A.h / 2}L${B.x + B.w / 2},${B.y + B.h / 2}`;
          const sel = Editor.selLink === 'exc:' + key;
          h += `<path class="exc ${sel ? 'sel' : ''}" d="${d}"/><path class="hit" data-link="exc:${esc(key)}" d="${d}"/>`;
        }
      }
      if (Editor.drag && Editor.drag.kind === 'link' && Editor.drag.to) {
        const A = Editor.rect(Editor.drag.from), v = Editor.vertical();
        const sx = v ? A.x + A.w / 2 : A.x + A.w, sy = v ? A.y + A.h : A.y + A.h / 2;
        h += `<path class="tmp" d="M${sx},${sy}L${Editor.drag.to.x},${Editor.drag.to.y}"/>`;
      }
      svg.innerHTML = h;
    },

    /* ---------------------------------------------------------------- panneau de droite */
    side() {
      const tree = Editor.tree, el = $('#rSide');
      const sel = [...Editor.sel];
      if (Editor.selLink) {
        const [kind, key] = [Editor.selLink.slice(0, 3), Editor.selLink.slice(4)];
        const [a, b] = kind === 'req' ? key.split('>') : key.split('|');
        const na = Editor.name(tree.tech(a) || { get: () => a }), nb = tree.tech(b) ? Editor.name(tree.tech(b)) : b;
        el.innerHTML = `<h3>${kind === 'req' ? 'Lien' : 'Exclusion'}</h3>
          <div class="help">${kind === 'req' ? `<b>${esc(nb)}</b> demande <b>${esc(na)}</b> avant elle.` : `<b>${esc(na)}</b> et <b>${esc(nb)}</b> ne peuvent pas être prises toutes les deux.`}</div><hr>
          <button class="danger" id="rDelLink">Supprimer ce ${kind === 'req' ? 'lien' : 'trait'} (Suppr)</button>`;
        $('#rDelLink').onclick = Editor.deleteSelection;
        return;
      }
      if (Editor.selTitle) {
        const tl = Editor.selTitle, id = tl.get('id');
        el.innerHTML = `<h3>Titre</h3>
          <div class="row"><label>Texte</label><input type="text" id="rTtl" value="${esc(tree.name('techtitle_' + id))}"></div>
          <div class="row"><label>Anglais</label><input type="text" id="rTtlEn" value="${esc(tree.name('techtitle_' + id, 'english'))}"></div>
          <hr><button class="danger" id="rDelTitle">Supprimer le titre</button>`;
        $('#rTtl').onchange = e => { Editor.before(); tree.setName('techtitle_' + id, e.target.value, 'french'); Editor.render(); };
        $('#rTtlEn').onchange = e => { Editor.before(); tree.setName('techtitle_' + id, e.target.value, 'english'); Editor.status(); };
        $('#rDelTitle').onclick = Editor.deleteSelection;
        return;
      }
      if (sel.length > 1) {
        el.innerHTML = `<h3>${sel.length} recherches</h3><div class="help">Glisser l'une d'elles déplace tout le groupe et ce qui en dépend (Ctrl = le groupe seul).</div><hr>
          <div class="row"><button id="rAlignH">Aligner en ligne</button><button id="rAlignV">En colonne</button></div>
          <div class="row"><button id="rExc">Rendre exclusives</button></div>
          <button class="danger" id="rDelSel">Supprimer les ${sel.length} (Suppr)</button>`;
        $('#rAlignH').onclick = () => { Editor.before(); const y = sel[0].num('y'); sel.forEach(t => { t.set('y', y); tree.fitYear(t); }); Editor.render(); };
        $('#rAlignV').onclick = () => { Editor.before(); const x = sel[0].num('x'); sel.forEach(t => { t.set('x', x); tree.fitYear(t); }); Editor.render(); };
        $('#rExc').onclick = () => { Editor.before(); for (const a of sel) for (const b of sel) if (a !== b) tree.setExclusive(a, b, true); Editor.render(); };
        $('#rDelSel').onclick = Editor.deleteSelection;
        return;
      }
      if (sel.length === 1) return Editor.techPanel(sel[0]);
      Editor.folderPanel();
    },

    techPanel(t) {
      const tree = Editor.tree, el = $('#rSide'), id = t.get('id');
      const others = t.items.filter(it => !(it && typeof it === 'object' && KNOWN.has(it.k)));
      const raw = others.map(it => R.blockText([it]).slice(2, -2)).join('\n');
      const chips = k => t.list(k).map(r => `<span class="chip">${esc(tree.tech(r) ? Editor.name(tree.tech(r)) : r)}<button data-k="${k}" data-r="${esc(r)}" title="Retirer">×</button></span>`).join('') || '<span class="help">aucune</span>';
      const opts = tree.techs().filter(o => o !== t).map(o => `<option value="${esc(o.get('id'))}">${esc(Editor.name(o))}</option>`).join('');
      el.innerHTML = `<h3>Recherche</h3>
        <div class="pic" id="rPic" title="Changer l'image"><img id="rPicImg" alt=""></div>
        <div class="row"><label>Nom</label><input type="text" id="rName" value="${esc(tree.name('tech_' + id))}"></div>
        <div class="row"><label>Anglais</label><input type="text" id="rNameEn" value="${esc(tree.name('tech_' + id, 'english'))}"></div>
        <div class="row"><label>Identifiant</label><input type="text" id="rId" value="${esc(id)}"></div>
        <div class="row"><label>Année</label><input type="number" id="rYear" value="${t.num('year', 1936)}"></div>
        <div class="row"><label>Coût (%)</label><input type="number" step="25" id="rCost" value="${Math.round(t.num('cost', 1) * 100)}"></div>
        <div class="row"><label>Petite case</label><input type="checkbox" id="rSmall" ${t.get('small') === 'yes' ? 'checked' : ''}></div>
        <div class="row"><label>Dossier</label><select id="rFolder">${tree.folders().map(f => `<option value="${esc(f)}" ${f === t.get('folder') ? 'selected' : ''}>${esc(tree.name('techfolder_' + f) || f)}</option>`).join('')}</select></div>
        <div class="row"><label>Position</label><input type="number" id="rX" value="${t.num('x', 0)}"><input type="number" id="rY" value="${t.num('y', 0)}"></div>
        <hr><h3>Demande avant (une suffit)</h3><div class="chips">${chips('requires')}</div>
        <div class="row"><select id="rAddReq"><option value="">＋ ajouter…</option>${opts}</select></div>
        <h3>Incompatible avec</h3><div class="chips">${chips('exclusive')}</div>
        <div class="row"><select id="rAddExc"><option value="">＋ ajouter…</option>${opts}</select></div>
        <hr><h3>Ce qu'elle donne (texte du jeu)</h3>
        <textarea id="rRaw" spellcheck="false" placeholder="unlock = { infantry }&#10;bonus = { target = artillery soft = 0.1 }">${esc(raw)}</textarea>
        <div class="help">Une clé par ligne, comme dans technologies.txt : unlock, bonus, modules, frames, production, research_speed…</div>
        <hr><div class="row"><button id="rDup">Dupliquer (Ctrl+D)</button><button class="danger" id="rDel">Supprimer</button></div>`;
      Game.url(`gfx/interface/research/${t.get('icon') || id}.png`).then(u => { if (u) $('#rPicImg').src = u; });
      const edit = fn => e => { Editor.before(); fn(e.target); Editor.render(); };
      $('#rName').onchange = edit(i => tree.setName('tech_' + t.get('id'), i.value, 'french'));
      $('#rNameEn').onchange = edit(i => tree.setName('tech_' + t.get('id'), i.value, 'english'));
      $('#rId').onchange = e => {
        const v = e.target.value.trim();
        const snap = tree.snapshot();
        if (!tree.renameTech(t, v)) { toast('Identifiant refusé : lettres minuscules, chiffres et _ ; pas déjà pris'); e.target.value = t.get('id'); return; }
        Editor.undo.push(snap); Editor.redo = [];
        Editor.render();
      };
      $('#rYear').onchange = edit(i => t.set('year', Math.round(+i.value) || 1936));
      $('#rCost').onchange = edit(i => t.set('cost', Math.max(5, Math.round(+i.value || 100)) + '%'));
      $('#rSmall').onchange = edit(i => t.set('small', i.checked ? 'yes' : '', ['x', 'y']));
      $('#rFolder').onchange = edit(i => { t.set('folder', i.value); tree.fitYear(t); Editor.sel.clear(); });
      $('#rX').onchange = edit(i => { t.set('x', Math.round(+i.value) || 0); tree.fitYear(t); });
      $('#rY').onchange = edit(i => { t.set('y', Math.round(+i.value) || 0); tree.fitYear(t); });
      $('#rAddReq').onchange = e => { const o = tree.tech(e.target.value); if (!o) return; Editor.before(); if (!tree.link(o, t)) { Editor.undo.pop(); toast('Ce lien ferait une boucle'); } Editor.render(); };
      $('#rAddExc').onchange = e => { const o = tree.tech(e.target.value); if (!o) return; Editor.before(); tree.setExclusive(t, o, true); Editor.render(); };
      for (const b of el.querySelectorAll('.chip button')) b.onclick = () => {
        Editor.before();
        const o = tree.tech(b.dataset.r);
        if (b.dataset.k === 'exclusive' && o) tree.setExclusive(t, o, false);
        else t.setList(b.dataset.k, t.list(b.dataset.k).filter(x => x !== b.dataset.r), R.TECH_ORDER.slice(0, R.TECH_ORDER.indexOf(b.dataset.k)));
        Editor.render();
      };
      $('#rRaw').onchange = e => {
        const items = R.parse(e.target.value);
        const bad = items.some(it => !(it && typeof it === 'object' && 'k' in it)) || items.some(it => KNOWN.has(it.k));
        e.target.classList.toggle('bad', bad);
        if (bad) { toast('Texte non compris : une clé = valeur par ligne (sans id, année, position…)'); return; }
        Editor.before();
        t.items = t.items.filter(it => it && typeof it === 'object' && KNOWN.has(it.k)).concat(items);
        Editor.render();
      };
      $('#rPic').onclick = () => Editor.pickIcon(t);
      $('#rDup').onclick = Editor.duplicate;
      $('#rDel').onclick = Editor.deleteSelection;
    },

    folderPanel() {
      const tree = Editor.tree, el = $('#rSide'), f = Editor.folder;
      const years = tree.years(f);
      el.innerHTML = `<h3>Dossier</h3>
        <div class="row"><label>Nom</label><input type="text" id="rFName" value="${esc(tree.name('techfolder_' + f))}"></div>
        <div class="row"><label>Anglais</label><input type="text" id="rFNameEn" value="${esc(tree.name('techfolder_' + f, 'english'))}"></div>
        <div class="row"><label>Sens</label><select id="rFDir"><option value="yes" ${Editor.vertical() ? 'selected' : ''}>Années vers le bas</option><option value="no" ${Editor.vertical() ? '' : 'selected'}>Années vers la droite</option></select></div>
        <hr><h3>Années (position)</h3>
        ${years.map((y, i) => `<div class="yrow"><input type="number" data-y="${i}" value="${y.year}"><input type="number" data-a="${i}" value="${y.at}"><button data-del="${i}" title="Retirer">×</button></div>`).join('')}
        <div class="row"><button id="rAddYear">＋ Année</button><button id="rAddTitle">＋ Titre</button></div>
        <hr><div class="help">
          <b>Double-clic</b> dans le vide : nouvelle recherche.<br>
          <b>Glisser</b> une case : la déplacer avec les recherches qui en dépendent (<kbd>Ctrl</kbd> = elle seule, <kbd>Alt</kbd> = sans aimant).<br>
          <b>Rond bleu</b> d'une case → autre case : la 2e demande la 1re.<br>
          <b>Clic sur un trait</b> puis <kbd>Suppr</kbd> : le retirer.<br>
          <kbd>Maj</kbd>+clic : plusieurs cases ; <kbd>Maj</kbd>+glisser dans le vide : rectangle.<br>
          Glisser dans le vide ou clic du milieu : se déplacer. <kbd>Ctrl</kbd>+molette : zoom.<br>
          <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> annuler, <kbd>Ctrl+D</kbd> dupliquer, <kbd>Ctrl+S</kbd> enregistrer (sans toucher au jeu). <b>🤖 IA</b> : demander à une IA de modifier l'arbre.
        </div>`;
      $('#rFName').onchange = e => { Editor.before(); tree.setName('techfolder_' + f, e.target.value, 'french'); Editor.render(); };
      $('#rFNameEn').onchange = e => { Editor.before(); tree.setName('techfolder_' + f, e.target.value, 'english'); Editor.status(); };
      $('#rFDir').onchange = e => { Editor.before(); tree.all('folder').find(x => x.get('id') === f).set('vertical', e.target.value); Editor.render(); };
      for (const i of el.querySelectorAll('input[data-y]')) i.onchange = () => { Editor.before(); years[+i.dataset.y].e.set('year', Math.round(+i.value)); Editor.render(); };
      for (const i of el.querySelectorAll('input[data-a]')) i.onchange = () => { Editor.before(); years[+i.dataset.a].e.set('at', Math.round(+i.value)); Editor.render(); };
      for (const b of el.querySelectorAll('button[data-del]')) b.onclick = () => { Editor.before(); const e = years[+b.dataset.del].e; tree.fileOf(e).remove(e); Editor.render(); };
      $('#rAddYear').onclick = () => {
        Editor.before();
        const last = years[years.length - 1];
        const e = new R.Entry('year', [{ k: 'folder', v: f }, { k: 'year', v: String(last ? last.year + 1 : 1936) }, { k: 'at', v: String(last ? last.at + 100 : 40) }]);
        tree.fileForFolder(f).add(e);
        Editor.render();
      };
      $('#rAddTitle').onclick = () => {
        Editor.before();
        let n = 0, id;
        do id = f + '_' + n++; while (tree.all('title').some(x => x.get('id') === id));
        const p = Editor.viewCentre();
        const e = new R.Entry('title', [{ k: 'folder', v: f }, { k: 'id', v: id }, { k: 'x', v: String(Math.round(p.x)) }, { k: 'y', v: String(Math.round(p.y)) }]);
        tree.fileForFolder(f).add(e);
        tree.setName('techtitle_' + id, 'Nouveau titre', 'french');
        tree.setName('techtitle_' + id, 'New title', 'english');
        Editor.selTitle = e;
        Editor.render();
      };
    },

    async pickIcon(t) {
      const box = document.createElement('div');
      box.id = 'rIcons';
      box.innerHTML = `<div class="box"><div class="hd"><b>Image</b><input type="text" id="rIconQ" placeholder="Chercher…" style="flex:1"><button id="rIconX">×</button></div><div class="grid" id="rIconGrid"></div></div>`;
      document.body.appendChild(box);
      const fill = async q => {
        const list = Editor.icons.filter(n => !q || n.includes(q.toLowerCase())).slice(0, 400);
        $('#rIconGrid').innerHTML = list.map(n => `<div data-n="${esc(n)}"><img alt="">${esc(n)}</div>`).join('');
        for (const d of $('#rIconGrid').children) {
          d.onclick = () => { Editor.before(); t.set('icon', d.dataset.n === t.get('id') ? '' : d.dataset.n, ['id']); box.remove(); Editor.render(); };
          Game.url(`gfx/interface/research/${d.dataset.n}.png`).then(u => { const i = d.querySelector('img'); if (u && i) i.src = u; });
        }
      };
      $('#rIconQ').oninput = e => fill(e.target.value.trim());
      $('#rIconX').onclick = () => box.remove();
      box.onclick = e => { if (e.target === box) box.remove(); };
      await fill('');
      $('#rIconQ').focus();
    },

    /* ---------------------------------------------------------------- actions */
    viewCentre() {
      const v = $('#rView');
      return { x: (v.scrollLeft + v.clientWidth / 2) / Editor.zoom - Editor.off.x, y: (v.scrollTop + v.clientHeight / 2) / Editor.zoom - Editor.off.y };
    },
    addAt(x, y) {
      Editor.before();
      const t = Editor.tree.addTech(Editor.folder, Editor.snap(x - BOX_W / 2), Editor.snap(y - BOX_H / 2));
      Editor.sel = new Set([t]); Editor.selLink = null; Editor.selTitle = null;
      Editor.render();
      const n = $('#rName'); if (n) { n.focus(); n.select(); }
    },
    duplicate() {
      const sel = [...Editor.sel];
      if (!sel.length) return;
      Editor.before();
      Editor.sel = new Set(sel.map(t => Editor.tree.duplicate(t, 20, 20)));
      Editor.render();
    },
    deleteSelection() {
      const tree = Editor.tree;
      if (Editor.selLink) {
        Editor.before();
        const kind = Editor.selLink.slice(0, 3), key = Editor.selLink.slice(4);
        if (kind === 'req') { const [a, b] = key.split('>'); if (tree.tech(a) && tree.tech(b)) tree.unlink(tree.tech(a), tree.tech(b)); }
        else { const [a, b] = key.split('|'); if (tree.tech(a) && tree.tech(b)) tree.setExclusive(tree.tech(a), tree.tech(b), false); }
        Editor.selLink = null;
      } else if (Editor.selTitle) {
        Editor.before();
        const e = Editor.selTitle;
        tree.fileOf(e).remove(e);
        for (const l of Object.values(tree.locs)) l.remove('techtitle_' + e.get('id'));
        Editor.selTitle = null;
      } else if (Editor.sel.size) {
        if (Editor.sel.size > 3 && !confirm(`Supprimer ${Editor.sel.size} recherches ?`)) return;
        Editor.before();
        for (const t of Editor.sel) tree.removeTech(t);
        Editor.sel.clear();
      } else return;
      Editor.render();
    },
    newFolder() {
      const name = prompt('Nom du nouveau dossier ?');
      if (!name) return;
      const tree = Editor.tree;
      let id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'dossier';
      while (tree.folders().includes(id)) id += '_2';
      Editor.before();
      const main = tree.files.find(f => f.name === 'technologies.txt') || tree.files[0];
      main.add(new R.Entry('folder', [{ k: 'id', v: id }, { k: 'vertical', v: 'yes' }]));
      main.add(new R.Entry('year', [{ k: 'folder', v: id }, { k: 'year', v: '1936' }, { k: 'at', v: '40' }]));
      tree.setName('techfolder_' + id, name, 'french');
      tree.setName('techfolder_' + id, name, 'english');
      Editor.folder = id; Editor.sel.clear();
      Editor.render();
    },
    snap(v) { return Editor.noSnap ? Math.round(v) : Math.round(v / SNAP) * SNAP; },

    async send() {
      const tree = Editor.tree;
      const { errs, warns } = tree.check();
      if (errs.length) { Editor.report('Le jeu ne pourrait pas charger cet arbre', errs, warns); return; }
      const ch = tree.changes();
      if (!ch.length) { toast('Rien à envoyer'); return; }
      busy(true, 'Écriture dans le jeu…');
      try {
        for (const c of ch) await Game.write(c.path, c.text);
        tree.markSaved();
        Editor.disk = tree.snapshot(); Editor.savedSig = Editor.sig();
        await KV.del(DRAFT);
        toast(`${ch.length} fichier${ch.length > 1 ? 's' : ''} écrit${ch.length > 1 ? 's' : ''} dans le jeu — relance le jeu pour voir l'arbre`);
      } catch (e) {
        toast('Écriture impossible : ' + e.message + ' (redonne l\'accès au dossier depuis l\'accueil)');
      } finally { busy(false); Editor.status(); }
    },
    check() {
      const { errs, warns } = Editor.tree.check();
      if (!errs.length && !warns.length) { toast('Tout est bon : le jeu chargera cet arbre'); return; }
      Editor.report(errs.length ? 'À corriger avant d\'envoyer' : 'Rien de bloquant', errs, warns);
    },
    report(title, errs, warns) {
      $('#dlgTitle').textContent = title;
      $('#dlgBody').innerHTML = (errs.length ? `<h4>Erreurs (${errs.length})</h4><ul>${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '')
        + (warns.length ? `<h4>Remarques (${warns.length})</h4><ul>${warns.slice(0, 100).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '');
      $('#dlg').hidden = false;
    },
    async reload() {
      if ((Editor.dirty() || Editor.unsaved()) && !confirm('Jeter le brouillon et les modifications pas encore envoyées, et relire le jeu ?')) return;
      await KV.del(DRAFT);
      await Editor.load();
      Editor.sel.clear(); Editor.selLink = null; Editor.selTitle = null;
      Editor.render();
    },
    leave() {
      if (Editor.unsaved() && !confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?')) return;
      $('#research').hidden = true;
      showHub();
    },

    /* ---------------------------------------------------------------- souris */
    at(e) {
      const v = $('#rView'), r = v.getBoundingClientRect();
      return { x: (e.clientX - r.left + v.scrollLeft) / Editor.zoom, y: (e.clientY - r.top + v.scrollTop) / Editor.zoom };
    },
    down(e) {
      const v = $('#rView');
      if (e.button === 1) { Editor.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, l: v.scrollLeft, t: v.scrollTop }; v.classList.add('pan'); e.preventDefault(); return; }
      if (e.button !== 0) return;
      const p = Editor.at(e);
      const port = e.target.closest('.port'), box = e.target.closest('.rbox'), link = e.target.closest('[data-link]'), title = e.target.closest('.rtitle');
      Editor.noSnap = e.altKey;
      if (port && box) {
        Editor.drag = { kind: 'link', from: Editor.tree.tech(box.dataset.t), to: p };
        e.preventDefault();
        return;
      }
      if (box) {
        const t = Editor.tree.tech(box.dataset.t);
        if (e.shiftKey) { if (Editor.sel.has(t)) Editor.sel.delete(t); else Editor.sel.add(t); }
        else if (!Editor.sel.has(t)) Editor.sel = new Set([t]);
        Editor.selLink = null; Editor.selTitle = null;
        // les recherches qui en dépendent (dessous dans l'arbre) suivent ; Ctrl = la sélection seule
        const moving = e.ctrlKey ? [...Editor.sel] : Editor.withChildren([...Editor.sel]);
        Editor.drag = { kind: 'move', p, snap: Editor.tree.snapshot(), start: moving.map(s => [s, s.num('x', 0), s.num('y', 0)]), moved: false };
        Editor.markSel();
        Editor.side();
        e.preventDefault();
        return;
      }
      if (title) {
        const tl = Editor.tree.titles(Editor.folder).find(x => x.get('id') === title.dataset.title);
        Editor.selTitle = tl; Editor.sel.clear(); Editor.selLink = null;
        Editor.drag = { kind: 'title', p, snap: Editor.tree.snapshot(), e: tl, x: tl.num('x', 0), y: tl.num('y', 0), moved: false };
        Editor.render();
        e.preventDefault();
        return;
      }
      if (link) {
        Editor.selLink = link.dataset.link; Editor.sel.clear(); Editor.selTitle = null;
        Editor.render();
        return;
      }
      if (e.shiftKey) { Editor.drag = { kind: 'band', p, q: p }; return; }
      Editor.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, l: v.scrollLeft, t: v.scrollTop, click: true };
      v.classList.add('pan');
    },
    move(e) {
      const d = Editor.drag;
      if (!d) return;
      const v = $('#rView');
      if (d.kind === 'pan') {
        if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.click = false;
        v.scrollLeft = d.l - (e.clientX - d.sx); v.scrollTop = d.t - (e.clientY - d.sy);
        return;
      }
      const p = Editor.at(e);
      Editor.noSnap = e.altKey;
      if (d.kind === 'move') {
        const dx = p.x - d.p.x, dy = p.y - d.p.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        d.moved = true;
        for (const [t, x, y] of d.start) { t.set('x', Math.max(0, Editor.snap(x + dx))); t.set('y', Math.max(0, Editor.snap(y + dy))); Editor.place(t); }
        Editor.links();
        return;
      }
      if (d.kind === 'title') {
        const dx = p.x - d.p.x, dy = p.y - d.p.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        d.moved = true;
        d.e.set('x', Math.max(0, Editor.snap(d.x + dx))); d.e.set('y', Math.max(0, Editor.snap(d.y + dy)));
        const el = document.querySelector(`.rtitle[data-title="${CSS.escape(d.e.get('id'))}"]`);
        if (el) { el.style.left = (Editor.off.x + d.e.num('x')) + 'px'; el.style.top = (Editor.off.y + d.e.num('y')) + 'px'; }
        return;
      }
      if (d.kind === 'link') {
        d.to = p;
        const over = document.elementFromPoint(e.clientX, e.clientY);
        const box = over && over.closest('.rbox');
        for (const b of document.querySelectorAll('.rbox.link-target')) b.classList.remove('link-target');
        if (box && box.dataset.t !== d.from.get('id')) box.classList.add('link-target');
        Editor.links();
        return;
      }
      if (d.kind === 'band') {
        d.q = p;
        let b = $('#rBand');
        if (!b) { b = document.createElement('div'); b.id = 'rBand'; $('#rSurf').appendChild(b); }
        b.style.left = Math.min(d.p.x, p.x) + 'px'; b.style.top = Math.min(d.p.y, p.y) + 'px';
        b.style.width = Math.abs(p.x - d.p.x) + 'px'; b.style.height = Math.abs(p.y - d.p.y) + 'px';
      }
    },
    up(e) {
      const d = Editor.drag;
      Editor.drag = null;
      $('#rView').classList.remove('pan');
      if (!d) return;
      if (d.kind === 'pan') {
        if (!d.click) return;
        // double-clic dans le vide : nouvelle recherche (fait ici : le 1er clic redessine, le navigateur perdrait le dblclick)
        const now = performance.now(), last = Editor.lastClick;
        if (last && now - last.t < 450 && Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) < 8) {
          Editor.lastClick = null;
          const p = Editor.at(e);
          Editor.addAt(p.x - Editor.off.x, p.y - Editor.off.y);
          return;
        }
        Editor.lastClick = { t: now, x: e.clientX, y: e.clientY };
        if (Editor.sel.size || Editor.selLink || Editor.selTitle) { Editor.sel.clear(); Editor.selLink = null; Editor.selTitle = null; Editor.render(); }
        return;
      }
      if (d.kind === 'move' || d.kind === 'title') {
        if (d.moved) {
          if (d.kind === 'move') for (const [t] of d.start) Editor.tree.fitYear(t);   // l'année suit la ligne où on la pose
          Editor.undo.push(d.snap); Editor.redo = []; Editor.render();
        }
        return;
      }
      if (d.kind === 'link') {
        const over = document.elementFromPoint(e.clientX, e.clientY);
        const box = over && over.closest('.rbox');
        if (box && box.dataset.t !== d.from.get('id')) {
          const child = Editor.tree.tech(box.dataset.t);
          Editor.before();
          if (!Editor.tree.link(d.from, child)) { Editor.undo.pop(); toast('Ce lien ferait une boucle'); }
        }
        Editor.render();
        return;
      }
      if (d.kind === 'band') {
        const x0 = Math.min(d.p.x, d.q.x), x1 = Math.max(d.p.x, d.q.x), y0 = Math.min(d.p.y, d.q.y), y1 = Math.max(d.p.y, d.q.y);
        for (const t of Editor.tree.techs(Editor.folder)) {
          const r = Editor.rect(t);
          if (r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0) Editor.sel.add(t);
        }
        Editor.render();
      }
    },
    markSel() { for (const [id, b] of Editor.el) b.classList.toggle('sel', [...Editor.sel].some(t => t.get('id') === id)); },
    wheel(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const v = $('#rView'), p = Editor.at(e);
      const z = Math.min(2, Math.max(0.3, Editor.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (z === Editor.zoom) return;
      Editor.zoom = z;
      Editor.render();
      const r = v.getBoundingClientRect();
      v.scrollLeft = p.x * z - (e.clientX - r.left);
      v.scrollTop = p.y * z - (e.clientY - r.top);
    },
    key(e) {
      if ($('#research').hidden || !$('#dlg').hidden || $('#rIcons')) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') { if (e.key === 'Escape') e.target.blur(); return; }
      const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
      if (c && k === 'z') { e.preventDefault(); e.shiftKey ? Editor.doRedo() : Editor.doUndo(); }
      else if (c && k === 'y') { e.preventDefault(); Editor.doRedo(); }
      else if (c && k === 'd') { e.preventDefault(); Editor.duplicate(); }
      else if (c && k === 's') { e.preventDefault(); Editor.save(); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); Editor.deleteSelection(); }
      else if (k === 'escape') { Editor.sel.clear(); Editor.selLink = null; Editor.selTitle = null; Editor.render(); }
    },
  };

  /* ================================================================== mise en place */
  function busy(on, msg) { if (window.busy) window.busy(on, msg); }

  function mount() {
    const hub = document.createElement('div');
    hub.id = 'hub'; hub.hidden = true;
    hub.innerHTML = `<h1>Where Iron Bleeds — Atelier</h1>
      <div class="sub">Tout ce qui se modifie dans le jeu. Choisis une partie ; ce qui est prêt s'ouvre, le reste arrive.</div>
      <div id="hubGame"></div><div id="hubTiles"></div>`;
    document.body.insertBefore(hub, document.body.firstChild);

    const re = document.createElement('div');
    re.id = 'research'; re.hidden = true;
    re.innerHTML = `<div id="rTop">
        <button id="rBack" title="Retour à l'atelier">← Atelier</button>
        <div id="rTabs"></div>
        <button id="rUndo" title="Annuler (Ctrl+Z)">↶</button><button id="rRedo" title="Rétablir (Ctrl+Y)">↷</button>
        <button id="rAdd" title="Nouvelle recherche au milieu de la vue (ou double-clic dans le vide)">＋ Recherche</button>
        <button id="rCheck">Vérifier</button>
        <button id="rReload" title="Relire les fichiers du jeu">⟳ Relire</button>
        <button id="rSave" title="Garder le travail dans l'atelier sans toucher au jeu (Ctrl+S)">Enregistrer</button>
        <button id="rSend" class="on" title="Écrire dans les fichiers du jeu">Envoyer dans le jeu</button>
        <span id="rStatus"></span>
      </div>
      <div id="rMain"><div id="rView" tabindex="0"><div id="rSize" style="position:absolute;left:0;top:0;pointer-events:none"></div><div id="rSurf"></div></div><div id="rSide"></div></div>`;
    document.body.insertBefore(re, hub.nextSibling);

    // la page des cartes ramène à l'atelier
    const h1 = $('#home h1');
    if (h1) { h1.textContent = 'Cartes'; const b = document.createElement('button'); b.textContent = '← Atelier'; b.onclick = showHub; h1.prepend(b); }
    const sub = $('#home .sub');
    if (sub) sub.textContent = 'Carte vectorielle du monde : découpe les terres en provinces, regroupe-les en pays et régions, puis exporte vers le jeu.';

    $('#rBack').onclick = Editor.leave;
    $('#rUndo').onclick = Editor.doUndo;
    $('#rRedo').onclick = Editor.doRedo;
    $('#rAdd').onclick = () => { const p = Editor.viewCentre(); Editor.addAt(p.x + Editor.off.x, p.y + Editor.off.y); };
    $('#rCheck').onclick = Editor.check;
    $('#rReload').onclick = Editor.reload;
    $('#rSave').onclick = Editor.save;
    $('#rSend').onclick = Editor.send;
    const v = $('#rView');
    v.addEventListener('pointerdown', Editor.down);
    window.addEventListener('pointermove', Editor.move);
    window.addEventListener('pointerup', Editor.up);
    v.addEventListener('wheel', Editor.wheel, { passive: false });
    v.addEventListener('dblclick', e => {
      if (e.target.closest('.rbox')) { const n = $('#rName'); if (n) { n.focus(); n.select(); } }
    });
    window.addEventListener('keydown', Editor.key);
    window.addEventListener('beforeunload', e => { if (!$('#research').hidden && Editor.unsaved()) { e.preventDefault(); e.returnValue = ''; } });
  }

  mount();
  window.Atelier = { showHub, Game, Editor, openArea };
})();
