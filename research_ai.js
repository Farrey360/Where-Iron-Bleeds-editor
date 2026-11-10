/* Atelier — assistant IA de l'éditeur d'arbre de recherche.
 *
 * Chaque moddeur branche sa propre IA : Claude (Anthropic), OpenAI, OpenRouter, Ollama (gratuit, sur le PC) ou un
 * autre service compatible OpenAI. La clé reste dans ce navigateur (localStorage) et ne part que vers le service choisi.
 * L'IA agit par des outils (lire, ajouter, modifier, relier, supprimer) ; tout ce qu'elle fait dans une réponse
 * s'annule d'un seul Ctrl+Z, et rien n'arrive dans le jeu sans « Enregistrer » puis « Envoyer dans le jeu ».
 */
(function () {
  'use strict';
  const R = window.ResearchCore;
  const A = window.Atelier;
  if (!R || !A) return;
  const Editor = A.Editor;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KNOWN = new Set(['id', 'icon', 'folder', 'x', 'y', 'small', 'year', 'cost', 'requires', 'exclusive']);
  const STORE = 'atelierIA';
  const MAX_STEPS = 30;

  /* ================================================================== fournisseurs */
  const PROVIDERS = {
    claude: { label: 'Claude (Anthropic)', fmt: 'anthropic', url: 'https://api.anthropic.com/v1/messages', model: 'claude-opus-5-5',
      help: 'Clé sur console.anthropic.com → API Keys. Payant à l\'usage, facturé sur ton compte Anthropic (l\'abonnement Claude.ai ne donne pas de clé).' },
    openai: { label: 'OpenAI (ChatGPT)', fmt: 'openai', url: 'https://api.openai.com/v1/chat/completions', model: '',
      help: 'Clé sur platform.openai.com → API keys. Payant à l\'usage. Mets le nom du modèle indiqué sur leur site.' },
    openrouter: { label: 'OpenRouter (beaucoup de modèles, certains gratuits)', fmt: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions', model: '',
      help: 'Clé sur openrouter.ai → Keys. Choisis un modèle qui sait utiliser des outils (« tools ») ; ceux marqués « free » ne coûtent rien.' },
    ollama: { label: 'Ollama (gratuit, sur ton PC)', fmt: 'openai', url: 'http://localhost:11434/v1/chat/completions', model: '', noKey: true,
      help: 'Installe Ollama (ollama.com), télécharge un modèle qui sait utiliser des outils (ex. « ollama pull qwen3 »), puis autorise l\'atelier : variable d\'environnement OLLAMA_ORIGINS=* et relance Ollama. Aucune clé.' },
    other: { label: 'Autre (compatible OpenAI)', fmt: 'openai', url: '', model: '',
      help: 'Adresse complète de « chat/completions », clé et nom du modèle de ton service.' },
  };

  const Conf = {
    load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } },
    save(c) { try { localStorage.setItem(STORE, JSON.stringify(c)); return true; } catch (e) { return false; } },
    /** Réglages du fournisseur actif : { id, p, key, model, url }. */
    current() {
      const c = Conf.load(), id = PROVIDERS[c.provider] ? c.provider : 'claude', p = PROVIDERS[id], s = (c.per || {})[id] || {};
      return { id, p, key: s.key || '', model: s.model || p.model, url: s.url || p.url };
    },
  };

  /* ================================================================== outils donnés à l'IA */
  const S = (props, req) => ({ type: 'object', properties: props, required: req || [], additionalProperties: false });
  const str = d => ({ type: 'string', description: d }), num = d => ({ type: 'number', description: d });
  const arr = d => ({ type: 'array', items: { type: 'string' }, description: d });
  const TOOLS = [
    { name: 'list_folders', description: 'Liste les dossiers (onglets) de l\'arbre : identifiant, nom, nombre de recherches.', schema: S({}) },
    { name: 'get_folder', description: 'Un dossier en entier : sens (vertical = années vers le bas), lignes d\'années avec leur position, titres, et toutes ses recherches (id, nom, année, x, y, prérequis, exclusions).',
      schema: S({ folder: str('identifiant du dossier') }, ['folder']) },
    { name: 'find_techs', description: 'Cherche des recherches par mot (nom français ou anglais, identifiant), dans tous les dossiers.',
      schema: S({ query: str('mot à chercher') }, ['query']) },
    { name: 'get_tech', description: 'Tout sur une recherche : noms français et anglais, année, coût, position, image, prérequis, exclusions, et le texte de ses effets (format du jeu).',
      schema: S({ id: str('identifiant') }, ['id']) },
    { name: 'add_tech', description: 'Ajoute une recherche. Son année suit sa position (ligne d\'années) sauf si year est donnée.',
      schema: S({
        folder: str('dossier'), x: num('position x'), y: num('position y'),
        name_fr: str('nom français'), name_en: str('nom anglais'),
        id: str('identifiant voulu : minuscules, chiffres, _ (facultatif)'),
        year: num('année (facultatif)'), cost: num('coût (1 = normal)'), small: { type: 'boolean', description: 'petite case' },
        requires: arr('identifiants demandés avant (une seule suffit)'),
        effects: str('effets, une clé = valeur par ligne, format du jeu (facultatif)'),
      }, ['folder', 'x', 'y', 'name_fr', 'name_en']) },
    { name: 'edit_tech', description: 'Modifie une recherche. Ne donner que ce qui change. Changer x / y remet l\'année selon la ligne, sauf si year est donnée aussi. effects remplace tout le texte des effets.',
      schema: S({
        id: str('identifiant actuel'), new_id: str('nouvel identifiant'),
        name_fr: str('nom français'), name_en: str('nom anglais'),
        folder: str('autre dossier'), x: num('position x'), y: num('position y'),
        year: num('année'), cost: num('coût'), small: { type: 'boolean', description: 'petite case' },
        icon: str('nom de l\'image (gfx/interface/research/<icon>.png) ; vide = celle de l\'identifiant'),
        effects: str('nouveau texte complet des effets'),
      }, ['id']) },
    { name: 'link', description: 'Crée ou retire un lien : child demande parent avant elle. Refusé s\'il ferait une boucle.',
      schema: S({ parent: str('recherche demandée avant'), child: str('recherche qui la demande'), on: { type: 'boolean', description: 'true = créer, false = retirer' } }, ['parent', 'child', 'on']) },
    { name: 'exclusive', description: 'Rend deux recherches incompatibles (on = true) ou ne l\'est plus (on = false).',
      schema: S({ a: str('identifiant'), b: str('identifiant'), on: { type: 'boolean', description: 'true = incompatibles' } }, ['a', 'b', 'on']) },
    { name: 'delete_tech', description: 'Supprime une recherche et ce qui la nomme (liens, exclusions, textes).', schema: S({ id: str('identifiant') }, ['id']) },
    { name: 'check', description: 'Vérifie l\'arbre : erreurs qui empêcheraient le jeu de charger, et avertissements.', schema: S({}) },
  ];
  const MUTATING = new Set(['add_tech', 'edit_tech', 'link', 'exclusive', 'delete_tech']);

  const SYSTEM = `Tu es l'assistant de l'Atelier de « Where Iron Bleeds », jeu de grande stratégie (Seconde Guerre mondiale, départ 1936). Tu aides un moddeur à modifier l'arbre de recherche avec les outils fournis. Réponds dans la langue du moddeur, court et clair.

L'arbre :
- Des dossiers (onglets). Dans chacun, des lignes d'années à une position (« at ») : en y si le dossier est vertical, sinon en x. Une recherche prend l'année de la ligne où elle est posée ; entre deux lignes éloignées, au prorata.
- Une recherche : case de 134 × 62 (petite case : 62 de large), position x / y du coin haut gauche, alignée de préférence sur 10. Laisser au moins 20 d'écart entre les cases.
- requires = recherches demandées avant ; une seule suffit à débloquer. exclusive = on ne peut en prendre qu'une.
- Les effets sont du texte au format du jeu, une clé par ligne, par exemple « unlock = { infantry } » ou « bonus = { target = artillery soft = 0.1 } ». Avant d'écrire des effets, regarde ceux de recherches proches (get_tech) et copie leur forme exacte ; n'invente pas de clé.
- Chaque recherche a un nom français et un nom anglais.

Méthode : lis d'abord ce qu'il faut (get_folder, find_techs, get_tech), puis agis. Place les nouvelles cases sans chevaucher les autres. Après des changements, lance check et corrige les erreurs. Termine par un résumé court de ce que tu as fait. Si la demande est floue ou risquée (supprimer beaucoup de recherches), demande d'abord.
Tes changements restent dans l'atelier : le moddeur peut tout annuler (Ctrl+Z), puis il enregistre et envoie dans le jeu lui-même.`;

  const tree = () => Editor.tree;
  const nm = (t, lang) => tree().name('tech_' + t.get('id'), lang);
  const brief = t => {
    const o = { id: t.get('id'), nom: nm(t) || undefined, annee: t.num('year'), x: t.num('x', 0), y: t.num('y', 0) };
    if (t.get('small') === 'yes') o.petite = true;
    if (t.list('requires').length) o.demande = t.list('requires');
    if (t.list('exclusive').length) o.exclusive = t.list('exclusive');
    return o;
  };
  const effectsOf = t => t.items.filter(it => !(it && typeof it === 'object' && KNOWN.has(it.k))).map(it => R.blockText([it]).slice(2, -2)).join('\n');
  function setEffects(t, text) {
    const items = R.parse(String(text));
    if (items.some(it => !(it && typeof it === 'object' && 'k' in it))) throw new Error('effets non compris : une clé = valeur par ligne');
    if (items.some(it => KNOWN.has(it.k))) throw new Error('les effets ne doivent pas contenir id, folder, x, y, year, cost, requires, exclusive, small, icon');
    t.items = t.items.filter(it => it && typeof it === 'object' && KNOWN.has(it.k)).concat(items);
  }
  const techOr = id => { const t = tree().tech(String(id)); if (!t) throw new Error(`recherche « ${id} » introuvable`); return t; };
  const folderOr = f => { if (!tree().folders().includes(String(f))) throw new Error(`dossier « ${f} » introuvable ; dossiers : ${tree().folders().join(', ')}`); return String(f); };
  const isNum = v => typeof v === 'number' && isFinite(v);
  function checkInput(tool, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('paramètres attendus en objet JSON');
    const sc = tool.schema;
    for (const k of sc.required) if (input[k] === undefined || input[k] === null) throw new Error(`paramètre « ${k} » manquant`);
    for (const [k, v] of Object.entries(input)) {
      const d = sc.properties[k];
      if (!d) throw new Error(`paramètre « ${k} » inconnu`);
      if (v === null || v === undefined) continue;
      const ok = d.type === 'string' ? typeof v === 'string' : d.type === 'number' ? isNum(v) : d.type === 'boolean' ? typeof v === 'boolean'
        : Array.isArray(v) && v.every(x => typeof x === 'string');
      if (!ok) throw new Error(`paramètre « ${k} » : ${d.type} attendu`);
    }
  }

  /** Exécute un outil ; renvoie [texte pour l'IA, ligne pour le moddeur]. */
  function run(name, input, turn) {
    const T = tree();
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`outil « ${name} » inconnu`);
    checkInput(tool, input);
    if (MUTATING.has(name) && !turn.snapped) { Editor.before(); turn.snapped = true; }
    const done = (res, line) => { if (MUTATING.has(name)) turn.changed = true; return [typeof res === 'string' ? res : JSON.stringify(res), line]; };
    switch (name) {
      case 'list_folders':
        return done(T.folders().map(f => ({ id: f, nom: T.name('techfolder_' + f) || undefined, recherches: T.techs(f).length })));
      case 'get_folder': {
        const f = folderOr(input.folder);
        return done({ id: f, nom: T.name('techfolder_' + f), vertical: T.folderVertical(f),
          annees: T.years(f).map(y => ({ annee: y.year, at: y.at })),
          titres: T.titles(f).map(t => ({ id: t.get('id'), texte: T.name('techtitle_' + t.get('id')), x: t.num('x', 0), y: t.num('y', 0) })),
          recherches: T.techs(f).map(brief) });
      }
      case 'find_techs': {
        const q = input.query.toLowerCase();
        const hits = T.techs().filter(t => [t.get('id'), nm(t), nm(t, 'english')].some(s => (s || '').toLowerCase().includes(q)));
        return done(hits.slice(0, 60).map(t => ({ ...brief(t), dossier: t.get('folder') })).concat(hits.length > 60 ? [{ suite: hits.length - 60 + ' de plus, précise' }] : []));
      }
      case 'get_tech': {
        const t = techOr(input.id);
        return done({ ...brief(t), dossier: t.get('folder'), nom_en: nm(t, 'english'), cout: t.num('cost', 1), image: t.get('icon') || t.get('id'), effets: effectsOf(t) });
      }
      case 'add_tech': {
        const f = folderOr(input.folder);
        if (input.id && (!/^[a-z0-9_]+$/.test(input.id) || T.tech(input.id))) throw new Error(`identifiant « ${input.id} » refusé (minuscules, chiffres, _ ; pas déjà pris)`);
        const req = (input.requires || []).map(techOr);
        const t = T.addTech(f, Math.round(input.x), Math.round(input.y));
        if (input.id) { T.renameTech(t, input.id); t.set('icon', ''); }   // case neuve : l'image suit le nouvel identifiant
        T.setName('tech_' + t.get('id'), input.name_fr, 'french');
        T.setName('tech_' + t.get('id'), input.name_en, 'english');
        if (isNum(input.year)) t.set('year', Math.round(input.year));
        if (isNum(input.cost)) t.set('cost', Math.round(Math.max(0.05, input.cost) * 100) + '%');
        if (input.small) t.set('small', 'yes', ['x', 'y']);
        for (const p of req) T.link(p, t);
        if (input.effects) { try { setEffects(t, input.effects); } catch (e) { T.removeTech(t); throw e; } }
        turn.folder = f;
        return done({ ok: true, ...brief(t) }, `＋ ${input.name_fr} (${t.get('id')})`);
      }
      case 'edit_tech': {
        const t = techOr(input.id);
        const what = [];
        if (input.effects !== undefined) { setEffects(t, input.effects); what.push('effets'); }
        if (input.new_id) { if (!T.renameTech(t, input.new_id)) throw new Error(`identifiant « ${input.new_id} » refusé (minuscules, chiffres, _ ; pas déjà pris)`); what.push('identifiant'); }
        const id = t.get('id');
        if (input.name_fr !== undefined) { T.setName('tech_' + id, input.name_fr, 'french'); what.push('nom'); }
        if (input.name_en !== undefined) { T.setName('tech_' + id, input.name_en, 'english'); what.push('nom anglais'); }
        if (input.folder) { t.set('folder', folderOr(input.folder)); what.push('dossier'); }
        if (isNum(input.x)) { t.set('x', Math.round(input.x)); what.push('place'); }
        if (isNum(input.y)) { t.set('y', Math.round(input.y)); if (!what.includes('place')) what.push('place'); }
        if (isNum(input.year)) { t.set('year', Math.round(input.year)); what.push('année'); }
        else if (input.folder || isNum(input.x) || isNum(input.y)) T.fitYear(t);
        if (isNum(input.cost)) { t.set('cost', Math.round(Math.max(0.05, input.cost) * 100) + '%'); what.push('coût'); }
        if (typeof input.small === 'boolean') { t.set('small', input.small ? 'yes' : '', ['x', 'y']); what.push('taille'); }
        if (input.icon !== undefined) { t.set('icon', input.icon === id ? '' : input.icon, ['id']); what.push('image'); }
        turn.folder = t.get('folder');
        return done({ ok: true, ...brief(t) }, `✎ ${nm(t) || id} : ${what.join(', ') || 'rien'}`);
      }
      case 'link': {
        const p = techOr(input.parent), c = techOr(input.child);
        if (input.on) { if (!T.link(p, c)) throw new Error('ce lien ferait une boucle'); }
        else T.unlink(p, c);
        turn.folder = c.get('folder');
        return done({ ok: true }, `${input.on ? '→' : '✕'} ${nm(p) || p.get('id')} ${input.on ? '→' : '↛'} ${nm(c) || c.get('id')}`);
      }
      case 'exclusive': {
        const a = techOr(input.a), b = techOr(input.b);
        if (a === b) throw new Error('il faut deux recherches différentes');
        T.setExclusive(a, b, input.on);
        return done({ ok: true }, `${input.on ? '⇎' : '⇔'} ${nm(a) || a.get('id')} / ${nm(b) || b.get('id')}`);
      }
      case 'delete_tech': {
        const t = techOr(input.id), label = nm(t) || t.get('id');
        T.removeTech(t);
        Editor.sel.delete(t);
        return done({ ok: true }, `🗑 ${label}`);
      }
      case 'check': {
        const { errs, warns } = T.check();
        return done({ erreurs: errs.slice(0, 50), avertissements: warns.slice(0, 50), total: { erreurs: errs.length, avertissements: warns.length } });
      }
    }
  }

  /* ================================================================== appels aux services */
  const Chat = { history: [], fmt: null, busy: false, abort: null };

  async function post(url, headers, body, signal) {
    let r;
    try { r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('Service injoignable (' + e.message + '). Vérifie l\'adresse, ta connexion' + (url.includes('localhost') ? ', qu\'Ollama tourne et que OLLAMA_ORIGINS=* est réglé' : '') + '.');
    }
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) {}
    if (!r.ok) {
      const msg = (j && (j.error && (j.error.message || j.error) || j.message)) || text.slice(0, 300);
      const hint = r.status === 401 || r.status === 403 ? ' — clé refusée' : r.status === 429 ? ' — trop de demandes ou crédit épuisé, réessaie plus tard' : r.status === 404 ? ' — adresse ou nom du modèle faux' : '';
      throw new Error(`Erreur ${r.status}${hint} : ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    if (!j) throw new Error('Réponse illisible du service');
    return j;
  }

  /** Un tour Claude (API Messages). Renvoie { text, calls: [{id, name, input}], stop }. */
  async function stepAnthropic(c, signal) {
    const headers = { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    const body = {
      model: c.model, max_tokens: 16000, system: SYSTEM,
      tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.schema })),
      messages: Chat.history, cache_control: { type: 'ephemeral' },
    };
    // un refus des filtres de sécurité est repris par un autre modèle Claude (côté Anthropic)
    if (/^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/.test(c.model)) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
    const j = await post(c.url, headers, body, signal);
    Chat.history.push({ role: 'assistant', content: j.content || [] });   // tel quel : l'API veut l'historique intact
    const blocks = j.content || [];
    return {
      text: blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
      calls: j.stop_reason === 'tool_use' ? blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input })) : [],
      stop: j.stop_reason,
    };
  }
  function resultsAnthropic(res) {
    Chat.history.push({ role: 'user', content: res.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.out, ...(r.err ? { is_error: true } : {}) })) });
  }

  /** Un tour chez un service compatible OpenAI (OpenAI, OpenRouter, Ollama…). */
  async function stepOpenAI(c, signal) {
    const headers = { 'content-type': 'application/json' };
    if (c.key) headers.authorization = 'Bearer ' + c.key;
    const body = {
      model: c.model,
      messages: [{ role: 'system', content: SYSTEM }, ...Chat.history],
      tools: TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
    };
    const j = await post(c.url, headers, body, signal);
    const ch = j.choices && j.choices[0];
    if (!ch || !ch.message) throw new Error('Réponse sans message : ' + JSON.stringify(j).slice(0, 200));
    const m = ch.message;
    Chat.history.push({ role: 'assistant', content: m.content ?? null, ...(m.tool_calls && m.tool_calls.length ? { tool_calls: m.tool_calls } : {}) });
    return {
      text: (m.content || '').trim(),
      calls: (m.tool_calls || []).map(tc => {
        let input = null;
        try { input = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments; } catch (e) { input = { __bad: true }; }
        return { id: tc.id, name: tc.function.name, input };
      }),
      stop: ch.finish_reason,
    };
  }
  function resultsOpenAI(res) { for (const r of res) Chat.history.push({ role: 'tool', tool_call_id: r.id, content: r.out }); }

  /** Contexte joint à chaque demande : où en est le moddeur. */
  function context() {
    const sel = [...Editor.sel].map(t => t.get('id'));
    return `[Atelier — dossier ouvert : ${Editor.folder}${sel.length ? ' ; sélection : ' + sel.join(', ') : ''}]`;
  }

  async function ask(text) {
    const c = Conf.current();
    if (!c.p.noKey && !c.key && c.id !== 'other') { settings(true); say('err', 'Mets d\'abord ta clé (⚙).'); return; }
    if (!c.url || !c.model) { settings(true); say('err', 'Il manque l\'adresse ou le nom du modèle (⚙).'); return; }
    if (Chat.fmt && Chat.fmt !== c.p.fmt) Chat.history = [];   // autre format de service : nouvelle conversation
    Chat.fmt = c.p.fmt;
    const anth = c.p.fmt === 'anthropic';
    const step = anth ? stepAnthropic : stepOpenAI, results = anth ? resultsAnthropic : resultsOpenAI;
    say('me', text);
    const full = context() + '\n' + text;
    Chat.history.push(anth ? { role: 'user', content: [{ type: 'text', text: full }] } : { role: 'user', content: full });

    const turn = { snapped: false, changed: false, folder: null };
    Chat.busy = true; Chat.abort = new AbortController(); ui();
    const wait = say('wait', 'Réfléchit…');
    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        const r = await step(c, Chat.abort.signal);
        if (r.text) say('ai', r.text);
        if (r.stop === 'refusal') { say('err', 'L\'IA a refusé cette demande.'); break; }
        if (r.stop === 'max_tokens' || r.stop === 'length') { say('err', 'Réponse coupée (trop longue). Demande en plus petits morceaux.'); break; }
        if (!r.calls.length) break;
        const res = r.calls.map(call => {
          try {
            if (call.input && call.input.__bad) throw new Error('paramètres JSON illisibles, renvoie-les');
            const [out, line] = run(call.name, call.input || {}, turn);
            if (line) say('act', line);
            return { id: call.id, out };
          } catch (e) {
            say('act oops', `${call.name} : ${e.message}`);
            return { id: call.id, out: 'Erreur : ' + e.message, err: true };
          }
        });
        results(res);
        if (turn.changed) { if (turn.folder && turn.folder !== Editor.folder) Editor.folder = turn.folder; Editor.render(); }
        if (i === MAX_STEPS - 1) say('err', 'Arrêt : trop d\'étapes d\'affilée. Dis « continue » pour reprendre.');
      }
    } catch (e) {
      if (e.name === 'AbortError') say('err', 'Arrêté.');
      else say('err', e.message);
      dropDangling(anth);
    } finally {
      wait.remove();
      Chat.busy = false; Chat.abort = null;
      if (turn.changed) { Editor.render(); say('act', 'Tout ce que l\'IA vient de faire s\'annule d\'un Ctrl+Z.'); }
      ui();
    }
  }

  /** Après une erreur, l'historique ne doit pas finir sur des appels d'outils sans réponse (sinon le service refuse la suite). */
  function dropDangling(anth) {
    const h = Chat.history, last = h[h.length - 1];
    if (!last || last.role !== 'assistant') return;
    const pending = anth ? (last.content || []).filter(b => b.type === 'tool_use').map(b => b.id) : (last.tool_calls || []).map(t => t.id);
    if (!pending.length) return;
    if (anth) h.push({ role: 'user', content: pending.map(id => ({ type: 'tool_result', tool_use_id: id, content: 'Interrompu par le moddeur.', is_error: true })) });
    else for (const id of pending) h.push({ role: 'tool', tool_call_id: id, content: 'Interrompu par le moddeur.' });
  }

  /* ================================================================== panneau */
  const css = `
#aiBtn.on{background:var(--accent);border-color:var(--accent);color:#06121f}
#aiBox{position:absolute;right:312px;bottom:10px;width:400px;max-width:calc(100% - 24px);height:min(620px,calc(100% - 70px));display:flex;flex-direction:column;background:#171920;border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 40px #000a;z-index:30}
#aiBox[hidden]{display:none}
#aiHd{display:flex;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line)}
#aiHd b{flex:1}
#aiHd small{color:var(--dim);font-weight:400}
#aiSet{padding:10px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px;font-size:13px}
#aiSet[hidden]{display:none}
#aiSet label{color:var(--dim);font-size:12px}
#aiSet input,#aiSet select{width:100%}
#aiSet .help{color:var(--dim);font-size:12px;line-height:1.45}
#aiLog{flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:6px;font-size:13.5px;line-height:1.45}
#aiLog .m{white-space:pre-wrap;word-wrap:break-word;border-radius:10px;padding:6px 10px;max-width:92%}
#aiLog .me{align-self:flex-end;background:#1f3a5c}
#aiLog .ai{align-self:flex-start;background:var(--panel2)}
#aiLog .act{align-self:flex-start;color:var(--dim);font-size:12px;padding:0 4px}
#aiLog .act.oops{color:var(--danger)}
#aiLog .err{align-self:stretch;color:var(--danger);font-size:12.5px;padding:2px 4px}
#aiLog .wait{align-self:flex-start;color:var(--dim);font-style:italic;font-size:12.5px}
#aiLog .hello{color:var(--dim);font-size:12.5px}
#aiIn{display:flex;gap:6px;padding:8px;border-top:1px solid var(--line)}
#aiIn textarea{flex:1;resize:none;height:58px;background:#0f1117;border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit;font-size:13.5px;padding:6px}
`;

  function say(kind, text) {
    const d = document.createElement('div');
    d.className = 'm ' + kind; d.textContent = text;
    const log = $('#aiLog'); log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  function hello() {
    $('#aiLog').innerHTML = `<div class="hello">Demande ce que tu veux changer dans l'arbre, par exemple :<br>« Ajoute un char lourd 1941 sous le char moyen, en anglais Heavy Tank »<br>« Range les recherches d'artillerie en colonne »<br>« Qu'est-ce que débloque l'infanterie motorisée ? »<br><br>L'IA travaille dans l'atelier seulement : Ctrl+Z annule ce qu'elle a fait, et c'est toi qui enregistres puis envoies dans le jeu.</div>`;
  }
  function ui() {
    const c = Conf.current();
    $('#aiWho').textContent = c.p.label.split(' (')[0] + (c.model ? ' · ' + c.model : '');
    $('#aiSend').textContent = Chat.busy ? 'Stop' : 'Envoyer';
    $('#aiQ').disabled = Chat.busy;
  }
  function settings(open) {
    const box = $('#aiSet');
    box.hidden = open === undefined ? !box.hidden : !open;
    if (box.hidden) return;
    const c = Conf.current();
    box.innerHTML = `
      <label>Service</label><select id="aiProv">${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}" ${k === c.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
      <div class="help">${esc(c.p.help)}</div>
      ${c.p.noKey ? '' : `<label>Clé</label><input type="password" id="aiKey" autocomplete="off" value="${esc(c.key)}" placeholder="colle ta clé ici">`}
      <label>Modèle</label><input type="text" id="aiModel" value="${esc(c.model)}" placeholder="${c.id === 'ollama' ? 'ex. qwen3' : 'nom du modèle'}">
      <label>Adresse</label><input type="text" id="aiUrl" value="${esc(c.url)}" placeholder="https://…/chat/completions">
      <div class="help">La clé reste dans ce navigateur et ne part que vers ce service. Les frais éventuels sont sur ton compte chez lui.</div>
      <div class="row"><button id="aiOk" class="on">OK</button>${c.p.noKey ? '' : '<button id="aiForget">Oublier la clé</button>'}</div>`;
    const keep = () => {
      const all = Conf.load(), id = $('#aiProv').value;
      all.per = all.per || {};
      all.per[c.id] = { key: $('#aiKey') ? $('#aiKey').value.trim() : '', model: $('#aiModel').value.trim(), url: $('#aiUrl').value.trim() };
      all.provider = id;
      if (!Conf.save(all) && window.toast) window.toast('Réglages non gardés (stockage bloqué)');
    };
    $('#aiProv').onchange = () => { keep(); settings(true); ui(); };
    $('#aiOk').onclick = () => { keep(); settings(false); ui(); $('#aiQ').focus(); };
    if ($('#aiForget')) $('#aiForget').onclick = () => { $('#aiKey').value = ''; keep(); settings(true); };
  }

  function mount() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const btn = document.createElement('button');
    btn.id = 'aiBtn'; btn.textContent = '🤖 IA'; btn.title = 'Demander à une IA de modifier l\'arbre';
    $('#rStatus').before(btn);
    const box = document.createElement('div');
    box.id = 'aiBox'; box.hidden = true;
    box.innerHTML = `<div id="aiHd"><b>Assistant IA <small id="aiWho"></small></b><button id="aiNew" title="Nouvelle conversation">Nouvelle</button><button id="aiCfg" title="Réglages : service, clé, modèle">⚙</button><button id="aiX" title="Fermer">×</button></div>
      <div id="aiSet" hidden></div><div id="aiLog"></div>
      <div id="aiIn"><textarea id="aiQ" placeholder="Ta demande… (Entrée = envoyer, Maj+Entrée = ligne)"></textarea><button id="aiSend" class="on">Envoyer</button></div>`;
    $('#rMain').appendChild(box);
    $('#rMain').style.position = 'relative';
    hello();
    const toggle = on => { box.hidden = !on; btn.classList.toggle('on', on); if (on) { ui(); if (!Conf.current().key && !Conf.current().p.noKey) settings(true); else $('#aiQ').focus(); } };
    btn.onclick = () => toggle(box.hidden);
    $('#aiX').onclick = () => toggle(false);
    $('#aiCfg').onclick = () => settings();
    $('#aiNew').onclick = () => { if (Chat.busy) return; Chat.history = []; hello(); };
    const send = () => {
      if (Chat.busy) { Chat.abort && Chat.abort.abort(); return; }
      const q = $('#aiQ').value.trim();
      if (!q) return;
      $('#aiQ').value = '';
      ask(q);
    };
    $('#aiSend').onclick = send;
    $('#aiQ').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  }

  mount();
  A.AI = { Conf, TOOLS, run, Chat, ask, PROVIDERS };
})();
