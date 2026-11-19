/* =========================================================
   Helpers
   ========================================================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words = t => (String(t).match(/[A-Za-z0-9ऀ-ॿ'’-]+/g) || []).length;
const has = (t, re) => re.test(t);
const count = (t, re) => (t.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length;
const clamp = (x, a=0, b=4) => Math.max(a, Math.min(b, Math.round(x)));

const STOP = new Set("a an the and or but so to of in on at for with from by is are was were be been am i you he she it we they my your our their me him her us them this that these those there here as if then than not no do does did have has had will would can could should may might must very also just about into over after before when while what which who whom how why all any some more most other such only own same too s t don now".split(" "));
const contentWords = t => (t.toLowerCase().match(/[a-z']+/g) || []).filter(w => w.length > 2 && !STOP.has(w));

function splitSentences(text){
  const out = []; const re = /[^.!?\n]+(?:[.!?]+|(?=\n)|$)/g; let m;
  while ((m = re.exec(text))){
    const raw = m[0]; const lead = raw.length - raw.trimStart().length;
    const s = raw.trim(); if (s.length < 2) continue;
    out.push({text:s, start:m.index + lead, end:m.index + lead + s.length});
  }
  return out;
}

const LINKERS = /\b(firstly|first of all|secondly|thirdly|also|however|because|therefore|so|but|for example|for instance|in addition|moreover|finally|overall|in conclusion|as a result|although|besides|on the other hand|such as|then)\b/gi;
const OPINION = /\b(i think|i believe|in my opinion|in my view|i feel|i agree|i disagree|i strongly|i don'?t think|i do not think|should|must not|should not|shouldn'?t)\b/i;
const REASON = /\b(firstly|first|secondly|second|another reason|also|moreover|because|since|besides|in addition|thirdly)\b/gi;
const EXAMPLE = /\b(for example|for instance|such as|e\.g\.|like when|when i|in my case|my friend|last year)\b/i;
const CONCLUDE = /\b(overall|in conclusion|to conclude|to sum up|so i think|therefore|that'?s why|finally|in short)\b/i;
const INFORMAL = /\b(u|ur|pls|plz|gonna|wanna|coz|bcoz|cuz|thx|tnx|lol|ok+|hey)\b|!!+/gi;
const FORMAL_IN_CHAT = /\b(dear|respected|regards|sincerely|yours faithfully|yours truly|kindly)\b/i;

/* Indian-English phrases: shown as tips, never counted as errors */
const IE_TIPS = [
  [/\bdo the needful\b/i, "“Do the needful” is common in India but unclear elsewhere. Say exactly what you need, e.g. “Please tell me the process.”"],
  [/\bmyself [A-Z][a-z]+/, "“Myself Ananya” is common in Indian English. In writing, use “My name is Ananya” or “I am Ananya.”"],
  [/\bprepone\b/i, "“Prepone” is Indian English. Outside India, say “bring forward” or “move earlier.”"],
  [/\brevert back\b/i, "“Revert back” repeats itself, and “revert” means “go back.” Use “reply” or “get back to you.”"],
  [/\bout of station\b/i, "“Out of station” is Indian English. You can say “out of town.”"],
  [/\bpass(ed)? out\b/i, "“Passed out” means “fainted” outside India. Say “graduated.”"],
  [/\bi am (having|belonging|knowing|understanding|wanting)\b/i, "Verbs like have, belong, know and want are not usually used with “-ing.” Say “I have,” “I belong,” “I know.”"],
  [/\bdiscuss about\b/i, "Say “discuss the plan,” not “discuss about the plan.”"],
  [/\bcope up\b/i, "Say “cope with,” not “cope up with.”"],
];


const P = (label, test) => ({label, test});

function lastLineIsName(text){
  const lines = text.trim().split(/\n/).map(l=>l.trim()).filter(Boolean);
  const last = lines[lines.length-1] || "";
  return words(last) >= 1 && words(last) <= 4 && /^[A-Z]/.test(last) && !/[.?]$/.test(last);
}

/* =========================================================
   Grammar engine: LanguageTool (+ offline fallback)
   ========================================================= */
const ltCache = new Map();
let engineState = "unknown";

function setEngine(state){
  engineState = state;
  const el = $("engine");
  el.className = "engine " + (state==="lt" ? "on" : state==="local" ? "off" : "");
  el.querySelector("span").textContent = state==="lt" ? "LanguageTool connected" : state==="local" ? "Grammar: offline checks" : "Grammar: not checked";
  el.title = state==="lt" ? "Grammar engine: LanguageTool (connected)" : state==="local" ? "Grammar engine: basic offline checks (LanguageTool unreachable)" : "Grammar engine: not checked yet";
}

function classify(m){
  const cat = (m.rule && m.rule.category && m.rule.category.id) || "";
  const issue = (m.rule && m.rule.issueType) || "";
  const id = (m.rule && m.rule.id) || "";
  if (cat === "TYPOS" || issue === "misspelling") return "spelling";
  if (cat === "CASING") return "capitalisation";
  if (cat === "PUNCTUATION" || cat === "TYPOGRAPHY" || issue === "typographical" || id === "WHITESPACE_RULE") return "punctuation";
  if (cat === "STYLE" || cat === "REDUNDANCY" || cat === "PLAIN_ENGLISH" || issue === "style" || issue === "locale-violation") return "tip";
  if (cat === "CONFUSED_WORDS" || cat === "COLLOCATIONS" || cat === "SEMANTICS") return "word choice";
  return "grammar";
}

async function grammarCheck(text){
  const lang = $("ltLang").value, url = $("ltUrl").value.trim();
  const key = lang + "|" + text;
  if (ltCache.has(key)) return ltCache.get(key);
  try{
    const ctl = new AbortController(); const to = setTimeout(()=>ctl.abort(), 8000);
    const res = await fetch(url, {method:"POST", signal:ctl.signal,
      headers:{"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"},
      body:new URLSearchParams({text, language:lang, enabledOnly:"false"})});
    clearTimeout(to);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const issues = (data.matches||[]).map(m => {
      const span = text.substr(m.offset, m.length);
      let type = classify(m);
      // Likely a proper noun (Indian names/places): don't count capitalised unknown words mid-sentence
      if (type === "spelling" && /^[A-Z]/.test(span) && m.offset > 0 && !/[.!?]\s*$/.test(text.slice(0, m.offset).trimEnd().slice(-1) || ".")) type = "name";
      // A word right after "my name is", "I am", "myself", "I'm from"… is a name or place, in any case (anmol / Anmol)
      if (type === "spelling" && /\b(my name is|my name's|name is|i am|i'm|im|myself|this is|call me|called|i live in|i'm from|i am from|from)\s+$/i.test(text.slice(Math.max(0, m.offset - 24), m.offset))) type = "name";
      return {start:m.offset, end:m.offset+m.length, span, type,
        fix:(m.replacements||[]).slice(0,2).map(r=>r.value).filter(v=>v!==undefined),
        why:m.message || m.shortMessage || "", rule:(m.rule&&m.rule.id)||"", ruleName:(m.rule&&m.rule.description)||""};
    }).filter(i => i.type !== "name");
    const result = {source:"lt", issues};
    ltCache.set(key, result); setEngine("lt");
    return result;
  } catch(e){
    setEngine("local");
    return {source:"local", issues:localGrammar(text)};
  }
}

/* Basic offline checks, used only when LanguageTool can't be reached */
function localGrammar(text){
  const out = [];
  const add = (re, type, fixFn, why, rule) => { let m; const r = new RegExp(re.source, re.flags.includes("g")?re.flags:re.flags+"g");
    while ((m = r.exec(text))){ out.push({start:m.index, end:m.index+m[0].length, span:m[0], type, fix:[fixFn(m[0])], why, rule}); } };
  const APOS = {dont:"don't",cant:"can't",wont:"won't",didnt:"didn't",doesnt:"doesn't",isnt:"isn't",im:"I'm",ive:"I've",wasnt:"wasn't",arent:"aren't",couldnt:"couldn't",shouldnt:"shouldn't",wouldnt:"wouldn't",thats:"that's",whats:"what's",lets:"let's"};
  add(/\b(dont|cant|wont|didnt|doesnt|isnt|im|ive|wasnt|arent|couldnt|shouldnt|wouldnt|thats|whats)\b/i, "spelling", w => APOS[w.toLowerCase()] || w, "This short form needs an apostrophe.", "APOSTROPHE");
  add(/(?<![A-Za-z'])i(?![A-Za-z'])/, "capitalisation", () => "I", "Always write “I” as a capital letter.", "LOWERCASE_I");
  add(/\b(\w+)\s+\1\b/i, "grammar", w => w.split(/\s+/)[0], "The same word is repeated.", "REPEATED_WORD");
  add(/\ba\s+(?=[aeiou][a-z])(?!(one|uni|use|eu|uti))\w+/i, "grammar", w => w.replace(/^a/i, m => m==="A"?"An":"an"), "Use “an” before a vowel sound.", "A_AN");
  add(/ {2,}/, "punctuation", () => " ", "Extra space.", "DOUBLE_SPACE");
  add(/\s+[,.](?=\S)/, "punctuation", w => w.trim(), "No space before a comma or full stop.", "SPACE_BEFORE_PUNCT");
  splitSentences(text).forEach(s => { if (/^[a-z]/.test(s.text)) out.push({start:s.start, end:s.start+1, span:s.text[0], type:"capitalisation", fix:[s.text[0].toUpperCase()], why:"Start a sentence with a capital letter.", rule:"SENTENCE_CAPITAL"}); });
  return out.sort((a,b)=>a.start-b.start).filter((x,i,arr)=> i===0 || x.start >= arr[i-1].end);
}

/* =========================================================
   Analysis context
   ========================================================= */
function copyPercent(answer, passage){
  if (!passage) return null;
  const toks = s => s.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(Boolean);
  const Pt = toks(passage), A = toks(answer);
  const grams = new Set(); for (let i=0;i+5<=Pt.length;i++) grams.add(Pt.slice(i,i+5).join(" "));
  const covered = new Array(A.length).fill(false);
  for (let i=0;i+5<=A.length;i++) if (grams.has(A.slice(i,i+5).join(" "))) for (let k=i;k<i+5;k++) covered[k]=true;
  return A.length ? Math.round(100*covered.filter(Boolean).length/A.length) : 0;
}

function buildCtx(text, t){
  const lc = text.toLowerCase();
  const sents = splitSentences(text);
  const n = words(text);
  const cw = contentWords(text);
  const sample = cw.slice(0, 80);
  const ttr = sample.length ? new Set(sample).size / sample.length : 0;
  const freq = {}; cw.forEach(w => freq[w]=(freq[w]||0)+1);
  const taskWords = new Set(contentWords((t.prompt||"") + " " + (t.passage||"") + " " + (t.keywords||"")));
  const repeated = Object.entries(freq).filter(([w,c]) => c >= 3 && !taskWords.has(w)).sort((a,b)=>b[1]-a[1]).map(([w,c])=>`${w} (${c}×)`);
  const overlap = new Set(cw.filter(w => taskWords.has(w))).size;
  const sentLens = sents.map(s => words(s.text));
  const ctx = {text, lc, t, sents, n, ttr, repeated, overlap, sentLens,
    avgLen: sentLens.length ? sentLens.reduce((a,b)=>a+b,0)/sentLens.length : 0,
    longSents: sentLens.filter(x => x > 30).length,
    linkers: [...new Set((lc.match(LINKERS)||[]).map(x=>x.toLowerCase()))],
    paragraphs: text.trim().split(/\n\s*\n/).filter(p=>p.trim()).length,
    copyPct: copyPercent(text, t.passage),
    informal: (text.match(INFORMAL)||[]).map(x=>x.trim()),
  };
  ctx.checklist = (t.points||[]).map(p => ({point:p.label, status: safe(()=>p.test(ctx)) ? "done" : "missing"}));
  ctx.offTask = n > 15 && overlap < 2 && !t.custom;
  ctx.ieTips = IE_TIPS.filter(([re]) => re.test(text)).map(([re,msg]) => { const m = text.match(re); return {span:m[0], msg}; });
  return ctx;
}
const safe = f => { try { return f(); } catch { return false; } };

/* =========================================================
   Rubric scorers (0–4 each, with a reason)
   ========================================================= */
const ADVICE = {
  checklist:"Re-read the task and tick off each point. Add the ones that are missing.",
  accuracy:"Read your answer slowly, one sentence at a time, and check the verbs and plurals.",
  ownwords:"Close the passage, then write the main ideas from memory using your own words.",
  concise:"Keep to the word limit: one main idea, two key points, no extra detail.",
  organisation:"Use linking words (firstly, also, however, so) and keep sentences between 8 and 25 words.",
  vocab:"Replace repeated words with different ones, e.g. “like” → enjoy, love, am interested in.",
  position:"Say your opinion clearly in the first sentence, e.g. “I believe that…”.",
  reasons:"Give two separate reasons (Firstly…, Secondly…) and one real example (For example…).",
  emailformat:"Use the email shape: Subject → Dear Sir/Madam → purpose → details → Regards + your name.",
  replytone:"Keep it friendly and natural: “Hi Meera! Yes, I'll be there…”. Avoid “Dear” and “Regards” in a chat.",
  clarity:"Answer each question in its own short sentence, and give exact times.",
  relevance:"Use the key words from the question in your answer and stay on that topic.",
};

const SCORERS = {
  checklist(c){
    const total = c.checklist.length || 1, done = c.checklist.filter(x=>x.status==="done").length;
    let s = clamp(4*done/total); if (c.offTask) s = Math.min(s,1);
    const miss = c.checklist.filter(x=>x.status!=="done").map(x=>x.point);
    return {score:s, reason: miss.length ? `You covered ${done} of ${total} points. Missing: ${miss.join(", ")}.` : `You covered all ${total} required points.`};
  },
  accuracy(c){
    const errs = c.errors.length, per100 = errs*100/Math.max(c.n,1);
    const s = per100 < 1 ? 4 : per100 < 3 ? 3 : per100 < 6 ? 2 : per100 < 10 ? 1 : 0;
    const byType = {}; c.errors.forEach(e => byType[e.type]=(byType[e.type]||0)+1);
    const top = Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${v} ${k}`).join(", ");
    return {score:s, reason: errs ? `${errs} mistake${errs>1?"s":""} in ${c.n} words (${top}).` : "No grammar, spelling or punctuation mistakes found."};
  },
  ownwords(c){
    const p = c.copyPct ?? 0;
    const s = p < 15 ? 4 : p < 25 ? 3 : p < 40 ? 2 : p < 60 ? 1 : 0;
    return {score:s, reason: p < 15 ? `Only ${p}% matches the passage word-for-word. Good paraphrasing.` : `${p}% of your words are copied in long phrases from the passage.`};
  },
  concise(c){
    const {min,max} = c.t; let s = 4; const notes = [];
    if (c.n < min){ s -= c.n < min*0.6 ? 2 : 1; notes.push(`${c.n} words is below the ${min}-word minimum`); }
    if (c.n > max){ s -= c.n > max*1.3 ? 2 : 1; notes.push(`${c.n} words is over the ${max}-word limit`); }
    if (c.longSents){ s -= 1; notes.push(`${c.longSents} sentence${c.longSents>1?"s are":" is"} over 30 words`); }
    if (c.sents.length < 2 && c.n > 20){ s -= 1; notes.push("it is all one sentence"); }
    return {score:clamp(s), reason: notes.length ? cap(notes.join("; ")) + "." : `Good length (${c.n} words) with clear sentences.`};
  },
  organisation(c){
    let s = 4; const notes = [];
    if (c.linkers.length === 0){ s -= 2; notes.push("no linking words"); } else if (c.linkers.length === 1 && c.n > 60){ s -= 1; notes.push("only one linking word"); }
    if (c.longSents){ s -= 1; notes.push(`${c.longSents} very long sentence${c.longSents>1?"s":""}`); }
    if (c.avgLen && c.avgLen < 6){ s -= 1; notes.push("sentences are very short and choppy"); }
    if (c.t.label==="Email" && c.paragraphs < 2){ s -= 1; notes.push("no separate paragraphs"); }
    if (c.t.label==="Opinion" && !c.sents.slice(-2).some(x => CONCLUDE.test(x.text))){ s -= 1; notes.push("no clear concluding sentence"); }
    if (c.n < c.t.min*0.6){ s -= 1; notes.push("too short to show structure"); }
    return {score:clamp(s), reason: notes.length ? cap(notes.join("; ")) + "." : `Ideas flow well, with linking words: ${c.linkers.slice(0,4).join(", ")}.`};
  },
  vocab(c){
    const r = c.ttr; let s = r > .78 ? 4 : r > .68 ? 3 : r > .58 ? 2 : r > .45 ? 1 : 0;
    if (c.repeated.length && s > 2) s -= 1;
    return {score:s, reason: c.repeated.length ? `Some words are repeated a lot: ${c.repeated.slice(0,3).join(", ")}.` : `Good variety: ${Math.round(r*100)}% of your key words are different.`};
  },
  position(c){
    const early = c.sents.slice(0,2).some(s => OPINION.test(s.text)), any = OPINION.test(c.text);
    return early ? {score:4, reason:"You state your opinion clearly at the start."}
      : any ? {score:2, reason:"Your opinion is there, but it comes late. Put it in the first sentence."}
      : {score:0, reason:"I couldn't find a clear opinion (e.g. “I think…”, “In my opinion…”)."};
  },
  reasons(c){
    const r = Math.min(count(c.lc, REASON), 3), ex = EXAMPLE.test(c.lc);
    const s = r >= 2 && ex ? 4 : r >= 2 ? 3 : r === 1 && ex ? 2 : r === 1 ? 1 : 0;
    return {score:s, reason: `${r >= 2 ? "Two or more reasons" : r === 1 ? "Only one reason" : "No clear reasons"} found, ${ex ? "with an example." : "and no example (try “For example…”)."}`};
  },
  emailformat(c){
    const miss = [];
    if (!/^\s*subject\s*:/im.test(c.text)) miss.push("subject line");
    if (!/^\s*(dear|respected|hello|hi|good (morning|afternoon|evening))\b/im.test(c.text)) miss.push("greeting");
    if (!/(regards|sincerely|faithfully|thank(s| you)|yours)/i.test(c.text)) miss.push("closing (e.g. Regards)");
    if (!lastLineIsName(c.text)) miss.push("your name at the end");
    let s = 4 - miss.length;
    const notes = [];
    if (/^\s*(hello|hi)\b/im.test(c.text)) { s -= 1; notes.push("“Hello/Hi” is too casual for the college office; use “Dear Sir/Madam”"); }
    if (c.informal.length){ s -= 1; notes.push(`informal words: ${[...new Set(c.informal)].slice(0,3).join(", ")}`); }
    return {score:clamp(s), reason: [miss.length ? "Missing: " + miss.join(", ") : "", ...notes].filter(Boolean).join(". ") + (miss.length||notes.length ? "." : "Clear email format with a polite, formal tone.")};
  },
  replytone(c){
    let s = 4; const notes = [];
    if (!/^\s*(hi|hey|hello|yes|yeah|sure|ok|okay)\b/i.test(c.text)) { s -= 1; notes.push("start with a friendly word like “Hi Meera!”"); }
    if (FORMAL_IN_CHAT.test(c.text)) { s -= 2; notes.push("words like “Dear” or “Regards” are too formal for a chat"); }
    if (/\b(u|ur|pls|plz)\b/i.test(c.text)) { s -= 1; notes.push("write “you/please” in full, even in chats"); }
    return {score:clamp(s), reason: notes.length ? cap(notes.join("; ")) + "." : "Friendly and natural for a message to a classmate."};
  },
  clarity(c){
    let s = 4; const notes = [];
    if (c.longSents){ s -= 1; notes.push("a sentence is very long"); }
    if (c.avgLen > 22){ s -= 1; notes.push("sentences are long on average"); }
    if (c.t.label==="Reply to a message" && !/\b\d{1,2}([:.]\d{2})?\s*(pm|am)?\b|four|half past/i.test(c.text)) { s -= 1; notes.push("no clear time given"); }
    if (c.sents.length < 2){ s -= 1; notes.push("everything is in one sentence"); }
    return {score:clamp(s), reason: notes.length ? cap(notes.join("; ")) + "." : "Clear and easy to follow."};
  },
  relevance(c){
    const kw = contentWords((c.t.prompt||"") + " " + (c.t.keywords||""));
    const uniq = [...new Set(kw)], used = uniq.filter(w => c.lc.includes(w));
    const r = uniq.length ? used.length / Math.min(uniq.length, 8) : 0;
    const s = clamp(r >= 1 ? 4 : r >= .6 ? 3 : r >= .35 ? 2 : r > 0 ? 1 : 0);
    return {score:s, reason: `Your answer uses ${used.length} of the key words from the task${used.length?": "+used.slice(0,5).join(", "):""}.`};
  },
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Task list helpers ---------- */
/* Best score per task, shown on the task list: key "w:summary" → "12/16" */
const RESULTS = {};
const tabHTML = (k, label, meta, active, best) =>
  `<button class="tab ${active?'active':''}" data-k="${k}"><span class="tab-ico"><i class="ico"></i></span>` +
  `<span class="tab-txt"><b>${esc(label)}</b><small>${esc(meta)}</small>` +
  `<em class="badge ${best?'done':''}">${best ? "Done · best " + esc(best) : "New"}</em></span></button>`;
function renderDone(id, prefix, total){
  const n = Object.keys(RESULTS).filter(k => k.startsWith(prefix)).length, el = $(id); if (!el) return;
  el.querySelector("em").textContent = `${n}/${total}`;
  el.querySelector("i").style.width = (total ? n/total*100 : 0) + "%";
  el.style.setProperty("--p", total ? n/total : 0);
  el.title = `${n} of ${total} tasks done`;
}

/* ---------- Feedback render helpers ---------- */
const showOnPhone = id => { if (window.innerWidth < 900) $(id).closest('.card').scrollIntoView({behavior:'smooth', block:'start'}); };
const ringHTML = (total, max, color) => { const c = 2*Math.PI*30, p = max ? Math.min(1, total/max) : 0;
  return `<div class="ring"><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="30" class="track"/><circle cx="36" cy="36" r="30" class="prog" style="stroke:${color};stroke-dasharray:${(c*p).toFixed(1)} ${c.toFixed(1)}"/></svg><span class="ring-num">${total}<small>/${max}</small></span></div>`; };
const isSerious = e => e.type === "grammar" || e.type === "word choice";

function highlight(text, marks){
  let html = "", pos = 0;
  marks.forEach(m => {
    if (m.start < pos) return;
    html += esc(text.slice(pos, m.start));
    const cls = m.n === null ? "" : isSerious(m) ? "serious" : "";
    const style = m.n === null ? ` style="background:none;border-bottom:2px dotted var(--teal)"` : "";
    const tip = (m.fix && m.fix.length ? "→ " + m.fix[0] + ". " : "") + (m.why || "");
    html += `<mark class="${cls}"${style} title="${esc(tip)}">${esc(text.slice(m.start, m.end))}${m.n?`<sup>${m.n}</sup>`:""}</mark>`;
    pos = m.end;
  });
  return html + esc(text.slice(pos));
}

function applyFixes(text, errs){
  let out = text;
  [...errs].filter(e => e.fix && e.fix.length).sort((a,b)=>b.start-a.start).forEach(e => { out = out.slice(0, e.start) + e.fix[0] + out.slice(e.end); });
  return out;
}

function findPattern(errs){
  const byRule = {}; errs.forEach(e => { if (e.rule) (byRule[e.rule] ||= []).push(e); });
  const rep = Object.values(byRule).filter(a => a.length >= 2).sort((a,b)=>b.length-a.length)[0];
  if (rep) return `You made the same kind of mistake ${rep.length} times (${rep[0].ruleName || rep[0].type}), e.g. “${rep[0].span}” and “${rep[1].span}”. Watch for it in your next answer.`;
  const byType = {}; errs.forEach(e => (byType[e.type] ||= []).push(e));
  const top = Object.entries(byType).filter(([,a]) => a.length >= 3).sort((a,b)=>b[1].length-a[1].length)[0];
  if (top) return `Most of your mistakes are ${top[0]} (${top[1].length}), e.g. “${top[1][0].span}”. Check this first when you revise.`;
  return "";
}


/* Settings sheet */
const openSheet = () => { $("settingsSheet").hidden = false; setTimeout(()=>$("settingsDone").focus(), 50); };
const closeSheet = () => {
  const s = $("settingsSheet"); if (s.hidden || s.classList.contains("closing")) return;
  s.classList.add("closing");
  setTimeout(() => { s.hidden = true; s.classList.remove("closing"); }, 280);
};
$("settingsBtn").onclick = openSheet; $("settingsDone").onclick = closeSheet;
$("settingsSheet").addEventListener("click", e => { if (e.target.id === "settingsSheet") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("settingsSheet").hidden) closeSheet(); });

/* =========================================================
   SPEAK MODE
   Speech-to-text: browser Web Speech API (Chrome → Google, Edge → Microsoft)
   Pauses & timing: microphone level analysis (Web Audio API)
   Read-aloud scoring follows the "Read-Aloud Scoring Rules" doc (16 Nov 2026)
   ========================================================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const STASKS = {
  read1:{
    kind:"read", label:"Read aloud: First day",
    text:`Ananya reached the institute gate at 8:45 on Monday morning. She held her admission papers close to her chest and looked around. A senior with a clipboard smiled and asked, "Are you looking for Room 12?" Ananya nodded. The senior walked with her past the notice board and the neem tree. By the time they reached the registration room, she was not nervous anymore.`,
    sample:`Ananya reached the institute gate at 8:45 on Monday morning. She hold her admission paper close to her chest and looked around. A senior with a clipboard smiled and asked are you looking for room 12. Ananya nodded. The senior walk with her past the the notice board and the tree. By the time they reached the registration room she is not nervous anymore.`,
    sampleSecs:31
  },
  read2:{
    kind:"read", label:"Read aloud: Notice",
    text:`All first-year students must complete their registration by Friday. Please bring two passport-size photographs, a copy of your marksheet and your admission letter. The library will stay open until 6 p.m. this week. If you have any questions, speak to the student help desk near the main gate. Don't forget to collect your ID card before classes begin.`,
    sample:`All first year student must complete their registration by Friday. Please bring two passport size photograph a copy of your mark sheet and your admission letter. The library will stay open till 6 p.m. this week. If you have any question speak to the student help desk near the gate. Do not forget to collect your ID card before the classes begin.`,
    sampleSecs:30
  },
  intro:{
    kind:"speak", label:"Self-introduction", minSec:40, maxSec:90,
    prompt:"Introduce yourself to your new classmates. Say your name, where you are from, what you are studying, one hobby and one goal for this year. Speak for 40–90 seconds.",
    points:[
      P("Name", c => /\b(my name is|i am [A-Z]|i'm [A-Z]|myself [A-Z]|this is [A-Z])/.test(c.text)),
      P("Where you are from", c => has(c.lc, /(\bfrom\b|belong|hometown|live in|grew up|native)/)),
      P("Course", c => has(c.lc, /(studying|study|b\.? ?com|\bba\b|b\.? ?sc|b\.? ?tech|bca|bba|course|degree|pursuing|first year|1st year|semester)/)),
      P("A hobby", c => has(c.lc, /(hobby|hobbies|like to|love to|enjoy|free time|spare time|passion|fond of)/)),
      P("A goal", c => has(c.lc, /(goal|want to|plan to|hope to|aim|dream|wish to|this year i)/)),
    ],
    sample:`hello everyone my name is Ananya Sharma I am from Jaipur in Rajasthan um I am studying BCom first year in this college in my free time I like to read novels and I also enjoy painting my goal for this year is to improve my English speaking and make many new friends thank you`,
    sampleSecs:32
  },
  answer:{
    kind:"speak", label:"Answer a question", minSec:40, maxSec:90,
    prompt:"Tell us about your first day at college. What happened, who did you meet, and how did you feel? Speak for 40–90 seconds.",
    points:[
      P("When / where", c => has(c.lc, /(first day|college|institute|morning|monday|reached|went|campus)/)),
      P("What happened", c => has(c.lc, /(register|class|orientation|gate|room|lecture|form|got|found|lost)/)),
      P("Someone you met", c => has(c.lc, /(met|meet|friend|senior|teacher|professor|classmate|person|girl|boy)/)),
      P("How you felt", c => has(c.lc, /(felt|feel|nervous|happy|excited|scared|confus|worried|relaxed|comfortable|glad)/)),
      P("Ending / what you learned", c => c.sents.length > 0 && has(c.lc, /(learn|realis|realiz|now|after that|in the end|finally|overall|so )/)),
    ],
    sample:`on my first day I reached college very early in the morning I was very nervous because I did not know anyone a senior helped me to find the registration room then I met Meera she was also new and we became friends I felt happy after that now I am comfortable in college`,
    sampleSecs:30
  },
};
const FILLERS = /\b(um+|uh+|er+|erm|hmm+|ah+)\b/gi;
const FILLER_ONE = /^(um+|uh+|er+|erm|hmm+|ah+)$/i;

let sCurrent = "read1", sPrev = null;
const S_COLORS = {read1:"#ff6a3d", read2:"#3ee08f", intro:"#f2e94e", answer:"#6f9bff"};
function sTabHTML(k, t, active){
  const best = RESULTS["s:"+k], [a,b] = best ? best.split("/").map(Number) : [0,1];
  const p = best ? a/b : 0, pct = Math.round(p*100);
  const meta = t.kind==="read" ? `Read aloud · ${words(t.text)} words` : `Speak · ${t.minSec}–${t.maxSec} s`;
  return `<button class="tab ${active?"active":""} ${!active && k===sPrev ? "was" : ""}" data-k="${k}" style="--c:${S_COLORS[k]||"#6f9bff"};--p:${p}" title="${best ? "Best score " + esc(best) : "Not tried yet"}">` +
    `<span class="tab-ico"><i class="ico"></i></span>` +
    `<span class="tab-txt"><b>${esc(t.label.replace(/^Read aloud: /,""))}</b><small>${esc(meta)}</small></span>` +
    `<em class="pct ${best?"on":""}">${best ? pct + "%" : "New"}</em></button>`;
}
function renderSTabs(){
  $("speakView").style.setProperty("--c", S_COLORS[sCurrent] || "#6f9bff");
  $("sTabs").innerHTML = Object.entries(STASKS).map(([k,t]) => sTabHTML(k, t, k===sCurrent)).join("");
  renderDone("sDone", "s:", Object.keys(STASKS).length);
  if ($("recLabel")) $("recLabel").textContent = STASKS[sCurrent].kind==="read" ? "Read the passage aloud" : "Record your answer";
  $("sTabs").querySelectorAll(".tab").forEach(b => b.onclick = () => { if (recState.on || b.dataset.k === sCurrent) return; sPrev = sCurrent; sCurrent = b.dataset.k; renderSTabs(); renderSPrompt(); resetSpeakOut(); });
}
function renderSPrompt(){
  const t = STASKS[sCurrent]; $("sTitle").textContent = t.label.replace(/^Speak: /,"");
  if (t.kind === "read"){
    const n = words(t.text), secs = Math.round(n / 2.1);
    $("sPromptBox").innerHTML = `
      <div class="passage-card">
        <div class="card-top"><span class="tag">Passage</span><span class="meta">${n} words · about ${secs} seconds at a natural pace</span></div>
        <div class="read-passage">${esc(t.text)}</div>
      </div>
      <p class="hint"><b>How it works:</b> press the red button (or <kbd>Space</kbd>), read the passage aloud, then press it again to stop. Words light up as you read.</p>`;
    $("sRubricInfo").innerHTML = `<b>How it's scored:</b> <b>Accuracy</b> /4 · <b>Pace</b> /3 · <b>Phrasing</b> /3 = 10 (Read-Aloud Scoring Rules). Errors count fully, minor errors count partly; pronunciation tips, repeats, fillers and self-corrections never lower the score.`;
  } else {
    const q = esc(t.prompt.replace(/\s*Speak for [^.]*\.\s*$/i, ""));
    $("sPromptBox").innerHTML = `
      <div class="q-card">
        <div class="card-top"><span class="tag">Your question</span><span class="meta q-time">Speak for ${t.minSec}–${t.maxSec} seconds</span></div>
        <div class="q-text">${q}</div>
        <div class="q-cover"><div class="q-sub">Try to cover these ${t.points.length} points</div>
          <ol class="q-points">${t.points.map((p,i)=>`<li><span class="n">${i+1}</span>${esc(p.label)}</li>`).join("")}</ol></div>
      </div>`;
    $("sRubricInfo").innerHTML = `<b>How it's scored:</b> <b>Content</b> · <b>Fluency</b> · <b>Language accuracy</b> · <b>Vocabulary</b>, each 0–4 = 16, the same shape as the written answers.`;
  }
  $("manualText").value = ""; $("manualSecs").value = "";
}
function resetSpeakOut(){ $("sOut").innerHTML = `<div class="empty">Record yourself, then press Stop. Your feedback will appear here.</div>`; $("live").innerHTML = `<span class="sub">What you say will appear here as you speak.</span>`; }

/* ---------- Engine status ---------- */
(function(){
  const el = $("srEngine");
  if (SR){ el.className = "engine on"; el.querySelector("span").textContent = "Speech recognition on"; el.title = "Speech engine: browser speech recognition"; }
  else { el.className = "engine off"; el.querySelector("span").textContent = "Speech not supported"; el.title = "Speech engine: not supported here (use Chrome or Edge, or type the transcript)"; }
})();

/* ---------- Recording ---------- */
const recState = {on:false};
async function startRec(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ $("recStatus").textContent = "This browser can't use the microphone here. Open the page over https, or type the transcript below."; return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}}); }
  catch(e){ $("recStatus").textContent = "Microphone permission was blocked. Allow the microphone, or type the transcript below."; return; }

  const R = recState;
  Object.assign(R, {on:true, stream, t0:performance.now(), levels:[], committed:"", sessFinal:"", sessInterim:"", srError:"", chunks:[], audioUrl:null});
  R.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = R.ctx.createMediaStreamSource(stream);
  R.an = R.ctx.createAnalyser(); R.an.fftSize = 1024; src.connect(R.an);
  const buf = new Float32Array(R.an.fftSize);
  R.timer = setInterval(() => {
    R.an.getFloatTimeDomainData(buf);
    let sum = 0; for (let i=0;i<buf.length;i++) sum += buf[i]*buf[i];
    const rms = Math.sqrt(sum/buf.length), t = (performance.now()-R.t0)/1000;
    R.levels.push({t, rms});
    $("recMeter").style.width = Math.min(100, rms*600) + "%";
    $("recTimer").textContent = fmtTime(t);
    if (t > 180) stopRec();
  }, 50);

  try { R.mr = new MediaRecorder(stream); R.mr.ondataavailable = e => e.data.size && R.chunks.push(e.data); R.mr.start(); } catch { R.mr = null; }

  if (SR){
    const startSR = () => {
      const rec = new SR(); R.rec = rec;
      rec.lang = $("srLang").value; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onresult = e => {
        let fin = "", intr = "";
        for (let i=0;i<e.results.length;i++){ const r = e.results[i]; if (r.isFinal) fin += r[0].transcript + " "; else intr += r[0].transcript + " "; }
        R.sessFinal = fin; R.sessInterim = intr; renderLive();
      };
      rec.onerror = e => { if (["not-allowed","service-not-allowed","network","audio-capture","language-not-supported"].includes(e.error)) R.srError = e.error; };
      rec.onend = () => {
        R.committed += R.sessFinal; R.sessFinal = ""; R.sessInterim = "";
        if (R.on && !R.srError) { try { startSR(); } catch {} }
        else if (R.finish) R.finish();
      };
      try { rec.start(); } catch(e){ R.srError = "start-failed"; }
    };
    startSR();
  }
  $("recBtn").classList.add("on"); $("recBtn").querySelector("span").textContent = "Stop";
  $("recStatus").textContent = SR ? "Listening… press Stop when you finish." : "Recording audio. This browser has no speech recognition, so after you stop, type the transcript below.";
  $("live").innerHTML = `<span class="sub">Listening…</span>`;
}

function renderLive(){
  const R = recState;
  $("live").innerHTML = esc(R.committed + R.sessFinal) + `<span class="interim">${esc(R.sessInterim)}</span>` || `<span class="sub">Listening…</span>`;
}

async function stopRec(){
  const R = recState; if (!R.on) return;
  R.on = false; clearInterval(R.timer);
  const endT = (performance.now()-R.t0)/1000;
  $("recBtn").classList.remove("on"); $("recBtn").querySelector("span").textContent = "Start recording"; $("recMeter").style.width = "0";
  $("recStatus").textContent = "Finishing…";
  if (R.mr && R.mr.state !== "inactive"){ await new Promise(res => { R.mr.onstop = res; R.mr.stop(); }); R.audioUrl = URL.createObjectURL(new Blob(R.chunks, {type:R.mr.mimeType || "audio/webm"})); }
  R.stream.getTracks().forEach(t => t.stop()); try { R.ctx.close(); } catch {}
  if (SR && R.rec){
    await new Promise(res => { R.finish = res; try { R.rec.stop(); } catch { res(); } setTimeout(res, 3000); });
    R.finish = null;
  }
  const transcript = (R.committed + R.sessFinal + " " + R.sessInterim).replace(/\s+/g," ").trim();
  const timing = analyseLevels(R.levels, endT);
  // Guard: if the level meter missed most of the speech (noisy room, quiet mic), use the full recording time
  const tw = words(R.committed + R.sessFinal + " " + R.sessInterim);
  if (timing.speakSecs && tw && (tw / (timing.speakSecs/60) > 260 || timing.speakSecs < endT*0.3)){ timing.speakSecs = endT; timing.measured = false; }
  if (R.srError && !transcript){
    $("recStatus").textContent = srErrorMsg(R.srError);
    $("manualBox").open = true; $("manualSecs").value = Math.round(timing.speakSecs || endT);
    return;
  }
  if (!transcript){
    $("recStatus").textContent = SR ? "No speech was recognised. Speak closer to the microphone and try again." : "Type what was said below to get feedback.";
    if (!SR){ $("manualBox").open = true; $("manualSecs").value = Math.round(timing.speakSecs || endT); }
    return;
  }
  $("recStatus").textContent = "";
  scoreSpeech(transcript, timing, R.audioUrl, "mic");
}
const srErrorMsg = e => ({ "not-allowed":"Speech recognition was blocked. Allow the microphone, or type the transcript below.",
  "service-not-allowed":"This browser doesn't allow speech recognition here. Try Chrome over https, or type the transcript below.",
  "network":"The speech service couldn't be reached (it needs internet). Type the transcript below.",
  "language-not-supported":"This language isn't supported. Change it in Speech settings." }[e] || "Speech recognition failed. Type the transcript below.");
const fmtTime = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;

$("recBtn").onclick = () => recState.on ? stopRec() : startRec();

/* ---------- Pause & timing analysis from mic levels ---------- */
function analyseLevels(levels, endT){
  if (!levels || levels.length < 10) return {measured:false, speakSecs:endT, pauses:[], longPauses:0, pauseRatio:0};
  const sorted = levels.map(l=>l.rms).sort((a,b)=>a-b);
  const peak = sorted[Math.floor(sorted.length*0.95)], floor = sorted[Math.floor(sorted.length*0.1)];
  const thr = Math.max(0.006, floor + (peak-floor)*0.15);
  const voiced = levels.filter(l => l.rms > thr);
  if (!voiced.length) return {measured:false, speakSecs:endT, pauses:[], longPauses:0, pauseRatio:0};
  const start = voiced[0].t, end = voiced[voiced.length-1].t;
  const pauses = []; let silStart = null;
  levels.forEach(l => {
    if (l.t < start || l.t > end) return;
    if (l.rms <= thr){ if (silStart === null) silStart = l.t; }
    else if (silStart !== null){ const d = l.t - silStart; if (d >= 0.4) pauses.push({at:silStart, dur:d}); silStart = null; }
  });
  const speakSecs = Math.max(1, end - start);
  return {measured:true, speakSecs, pauses, longPauses:pauses.filter(p=>p.dur>=2).length,
          pauseRatio: pauses.reduce((a,p)=>a+p.dur,0)/speakSecs};
}

/* ---------- Manual transcript path ---------- */
$("manualSample").onclick = () => { const t = STASKS[sCurrent]; $("manualText").value = t.sample; $("manualSecs").value = t.sampleSecs; };
$("manualGo").onclick = () => {
  const text = $("manualText").value.trim(); if (!text){ $("manualText").focus(); return; }
  const secs = +$("manualSecs").value || 0;
  scoreSpeech(text, {measured:false, typed:true, speakSecs:secs || null, pauses:[], longPauses:0, pauseRatio:0}, recState.audioUrl, "typed");
};

function scoreSpeech(transcript, timing, audioUrl, source){
  const t = STASKS[sCurrent]; showOnPhone('sOut');
  if (t.kind === "read") renderReadFeedback(scoreReadAloud(t, transcript, timing), t, transcript, timing, audioUrl, source);
  else scoreSpoken(t, transcript, timing, audioUrl, source);
}

/* =========================================================
   READ-ALOUD SCORING
   ========================================================= */
const ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
function numWords(n){
  n = +n; if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n/10)] + (n%10 ? " " + ONES[n%10] : "");
  if (n < 1000) return ONES[Math.floor(n/100)] + " hundred" + (n%100 ? " " + numWords(n%100) : "");
  if (n < 10000) return numWords(Math.floor(n/1000)) + " thousand" + (n%1000 ? " " + numWords(n%1000) : "");
  return String(n);
}
const CONTRACT = {"don't":"do not","doesn't":"does not","didn't":"did not","can't":"can not","cannot":"can not","won't":"will not","isn't":"is not","aren't":"are not","wasn't":"was not","weren't":"were not","i'm":"i am","it's":"it is","that's":"that is","they're":"they are","we're":"we are","you're":"you are","i've":"i have","i'll":"i will","we'll":"we will","you'll":"you will","let's":"let us","there's":"there is","what's":"what is","he's":"he is","she's":"she is","couldn't":"could not","shouldn't":"should not","wouldn't":"would not","haven't":"have not","hasn't":"has not"};
const COMPOUND = {"marksheet":"mark sheet","till":"until","ok":"okay"};

/* Normalise text into comparable tokens; keep a pointer to the original word index */
function tokenize(text){
  const out = [];
  const raw = text.replace(/[“”"]/g," ").replace(/’/g,"'").split(/\s+/).filter(Boolean);
  raw.forEach((w, wi) => {
    let x = w.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
    if (!x) return;
    // times like 8:45 and 6 p.m.
    let parts;
    if (/^\d{1,2}:\d{2}$/.test(x)){ const [h,m] = x.split(":"); parts = (numWords(h) + " " + (m === "00" ? "" : numWords(+m))).trim().split(" "); }
    else if (/^\d+$/.test(x)) parts = numWords(x).split(" ");
    else if (CONTRACT[x]) parts = CONTRACT[x].split(" ");
    else if (/^(p|a)\.?m\.?$/.test(x)) parts = [x[0] + "m"];
    else if (COMPOUND[x]) parts = COMPOUND[x].split(" ");
    else parts = x.replace(/'s$/,"s").split(/[-]/).filter(Boolean);
    parts.forEach(p => { if (p === "pm" || p === "am"){ out.push({w:p, wi}); } else if (p) out.push({w:p.replace(/'/g,""), wi}); });
  });
  return out;
}

function lev(a, b){
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({length:n+1}, (_,j)=>j);
  for (let i=1;i<=m;i++){ const cur=[i]; for (let j=1;j<=n;j++) cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1)); prev = cur; }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a,b)/Math.max(a.length, b.length, 1);

/* Word-level alignment (weighted edit distance) */
function align(ref, hyp){
  const m = ref.length, n = hyp.length;
  const D = Array.from({length:m+1}, () => new Float64Array(n+1));
  const B = Array.from({length:m+1}, () => new Uint8Array(n+1)); // 0 diag,1 del,2 ins
  for (let i=1;i<=m;i++){ D[i][0] = i; B[i][0] = 1; }
  for (let j=1;j<=n;j++){ D[0][j] = j; B[0][j] = 2; }
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++){
    const a = ref[i-1].w, b = hyp[j-1].w;
    const sub = a === b ? 0 : 0.45 + 0.55*(1 - sim(a,b));
    const d = D[i-1][j-1] + sub, de = D[i-1][j] + 1, in_ = D[i][j-1] + 1;
    if (d <= de && d <= in_){ D[i][j] = d; B[i][j] = 0; } else if (de <= in_){ D[i][j] = de; B[i][j] = 1; } else { D[i][j] = in_; B[i][j] = 2; }
  }
  const ops = []; let i = m, j = n;
  while (i > 0 || j > 0){
    const b = B[i][j];
    if (i > 0 && j > 0 && b === 0){ ops.push({op: ref[i-1].w === hyp[j-1].w ? "ok" : "sub", r:i-1, h:j-1}); i--; j--; }
    else if (i > 0 && (j === 0 || b === 1)){ ops.push({op:"del", r:i-1}); i--; }
    else { ops.push({op:"ins", h:j-1}); j--; }
  }
  return ops.reverse();
}

const FUNC = new Set("a an the in on at of for to from by with and or but this that these those is are was were his her their its my your our".split(" "));
const SYN = [["kids","children"],["big","large"],["small","little"],["start","begin"],["started","began"],["till","until"],["near","close"],["smiled","grinned"],["looked","glanced"],["quickly","fast"],["photo","photograph"],["photos","photographs"],["walked","went"],["reached","arrived"],["told","said"],["asked","said"],["anymore","now"]];
const IRREG = {go:["went","gone","goes"],went:["go","goes","gone"],hold:["held"],held:["hold","holds"],is:["was"],was:["is"],are:["were"],were:["are"],come:["came"],came:["come","comes"],see:["saw"],saw:["see","sees"],take:["took"],took:["take","takes"],get:["got"],got:["get","gets"],say:["said"],said:["say","says"],have:["had"],had:["have","has"],do:["did"],did:["do","does"],find:["found"],found:["find"],meet:["met"],met:["meet"],begin:["began"],began:["begin"],stay:["stayed"],reach:["reached"],walk:["walked"],look:["looked"],nod:["nodded"],smile:["smiled"]};
const SUFFIX = ["s","es","ed","d","ing","er","est","ly"];
const isSyn = (a,b) => SYN.some(([x,y]) => (x===a&&y===b)||(x===b&&y===a));
function phonKey(w){
  return w.toLowerCase().replace(/ph/g,"f").replace(/ck/g,"k").replace(/q/g,"k").replace(/x/g,"ks").replace(/v/g,"w").replace(/z/g,"s")
    .replace(/th/g,"t").replace(/dh/g,"d").replace(/sh/g,"s").replace(/ee|ea|ie|ei|y$/g,"i").replace(/oo|ou/g,"u")
    .replace(/(.)\1+/g,"$1").replace(/(?!^)[aeiou]/g,"");
}
const looksLikeAttempt = (h, r) => sim(h, r) >= 0.4 || phonKey(h) === phonKey(r) || (h[0] === r[0] && sim(h, r) >= 0.25);
const REPAIR = new Set(["no","sorry","i","mean"]);
const PUNCT_WORDS = new Set(["comma","stop","period","question","mark","fullstop"]);

function classifySub(rTok, hTok, refOrig){
  const r = rTok.w, h = hTok.w;
  const orig = refOrig[rTok.wi] || "";
  const prev = refOrig[rTok.wi-1] || ".";
  if (/^[A-Z]/.test(orig) && !/[.!?"]$/.test(prev) && rTok.wi > 0) return {cls:"none", type:"Name said differently", why:"Names can be said in different ways. Not counted."};
  for (const s of SUFFIX){ if (h + s === r) return {cls:"err", type:"Dropped a word ending", why:`The ending “-${s}” is missing, which changes the meaning (number or tense).`, meaning:true, pattern:"ending"}; }
  for (const s of SUFFIX){ if (r + s === h) return {cls:"err", type:"Added a word ending", why:`You added “-${s}” to the word.`, meaning:true, pattern:"ending"}; }
  if ((IRREG[r]||[]).includes(h)) return {cls:"err", type:"Changed the tense", why:"The verb is in a different tense from the text.", meaning:true, pattern:"tense"};
  if (FUNC.has(r) && FUNC.has(h)) return {cls:"minor", type:"Swapped a small word", why:"Small words like a/the/in/on were swapped. The meaning usually survives.", pattern:"small"};
  if (isSyn(r,h)) return {cls:"minor", type:"Used a word that means the same", why:"Same meaning, but read the word that is written.", pattern:"syn"};
  if (phonKey(r) === phonKey(h)) return {cls:"tip", type:"Pronunciation tip", why:"It sounded like a different word. If listeners still understand you, it is not counted.", pattern:"pron"};
  if (r[0] === h[0] && sim(r,h) < 0.5) return {cls:"err", type:"Guessed from the first letter", why:"The word starts the same but is a different word. Look at the whole word.", meaning:true, pattern:"guess"};
  if (sim(r,h) >= 0.5) return {cls:"err", type:"Swapped for a similar word", why:"This word looks or sounds like the one in the text, but it is different.", meaning:true, pattern:"similar"};
  return {cls:"err", type:"Changed the word", why:"A different word was read.", meaning:true, pattern:"changed"};
}

function scoreReadAloud(t, transcript, timing){
  const refOrig = t.text.split(/\s+/).filter(Boolean);
  const ref = tokenize(t.text), hyp = tokenize(transcript);
  const ops = align(ref, hyp);
  const minorW = +$("minorW").value;

  // last reference position actually reached
  let lastReached = -1; ops.forEach(o => { if (o.op !== "del" && o.op !== "ins") lastReached = o.r; if (o.op==="ins") {} });
  const words = refOrig.map((w,i) => ({w, i, cls:"ok", items:[]}));  // per original word
  const inserts = {};  // inserted words before original word index
  const issues = [];

  // detect adjacent swaps (word order)
  for (let k=0;k+1<ops.length;k++){
    const a = ops[k], b = ops[k+1];
    if (a.op==="sub" && b.op==="sub" && hyp[a.h].w===ref[b.r].w && hyp[b.h].w===ref[a.r].w){
      a.swap = b.swap = true;
      issues.push({cls:"err", type:"Changed the word order", said:`${hyp[a.h].w} ${hyp[b.h].w}`, expected:`${ref[a.r].w} ${ref[b.r].w}`, wi:ref[a.r].wi, why:"Two words were read in a different order.", meaning:true, pattern:"order"});
      words[ref[a.r].wi].cls = "err"; words[ref[b.r].wi].cls = "err";
    }
  }

  const nextRefWi = k => { for (let x=k; x<ops.length; x++) if (ops[x].r !== undefined) return ref[ops[x].r].wi; return refOrig.length; };
  ops.forEach((o, k) => {
    if (o.swap) return;
    if (o.op === "sub"){
      const c = classifySub(ref[o.r], hyp[o.h], refOrig);
      const wi = ref[o.r].wi;
      issues.push({...c, said:hyp[o.h].w, expected:ref[o.r].w, wi});
      if (c.cls !== "none") words[wi].cls = worst(words[wi].cls, c.cls);
    } else if (o.op === "del"){
      const wi = ref[o.r].wi;
      const trailing = o.r > lastReached;
      issues.push({cls:"err", type: trailing ? "Stopped before the end" : "Skipped a word", expected:ref[o.r].w, wi, why: trailing ? "These words at the end were not read." : "This word was not read.", meaning:true, pattern: trailing ? "unread" : "skip"});
      words[wi].cls = worst(words[wi].cls, trailing ? "unread" : "skip");
    } else if (o.op === "ins"){
      const h = hyp[o.h].w, before = nextRefWi(k);
      const prevH = o.h > 0 ? hyp[o.h-1].w : null, nextH = o.h+1 < hyp.length ? hyp[o.h+1].w : null;
      const nextOp = ops.slice(k+1).find(x => x.op !== "ins");
      let c;
      if (FILLER_ONE.test(h)){ c = {cls:"note", type:"Filler", why:"Fillers like “umm” are noted but not counted."}; }
      else if (h === prevH || h === nextH) c = {cls:"note", type:"Repeated a word", why:"Repeating words is noted but not counted."};
      else if (REPAIR.has(h) && nextOp && nextOp.op === "ok") c = {cls:"ok", type:"Corrected yourself", why:"Fixing a mistake straight away is a good habit. Not counted."};
      else if (nextOp && nextOp.op === "ok" && looksLikeAttempt(h, ref[nextOp.r].w) && ops.slice(k+1, ops.indexOf(nextOp)).every(x => x.op==="ins" && REPAIR.has(hyp[x.h].w))) c = {cls:"ok", type:"Corrected yourself", why:"You fixed the word straight away. Not counted."};
      else if (PUNCT_WORDS.has(h)) c = {cls:"minor", type:"Said the punctuation aloud", why:"Punctuation marks are not read aloud.", pattern:"punct"};
      else if (ref.some((r, ri) => r.w === h && Math.abs(r.wi - before) <= 3)) c = {cls:"note", type:"Repeated a word", why:"Going back to re-read is noted but not counted."};
      else c = {cls:"err", type:"Added a word", why:"This word is not in the text.", meaning:false, pattern:"add"};
      FILLERS.lastIndex = 0;
      issues.push({...c, said:h, wi:before, ins:true});
      (inserts[before] ||= []).push({w:h, cls:c.cls, type:c.type});
    }
  });

  // Skipped a whole line: run of ≥6 consecutive skipped words (still one error per word)
  let run = 0; words.forEach((w,i) => { run = w.cls==="skip" ? run+1 : 0; if (run===6) issues.push({cls:"note", type:"Skipped a line", why:"Several words in a row were skipped, as if a line was missed. Each word counts as skipped.", wi:i}); });

  const errs = issues.filter(x => x.cls==="err"), minors = issues.filter(x => x.cls==="minor");
  const weighted = errs.length + minorW*minors.length;
  const refCount = ref.length;
  const accPct = Math.max(0, 100*(1 - weighted/refCount));
  const accScore = accPct >= 97 ? 4 : accPct >= 93 ? 3 : accPct >= 85 ? 2 : accPct >= 70 ? 1 : 0;

  // pace
  const correct = ops.filter(o => o.op==="ok").length;
  let pace = {score:null, reason:"Not measured: no recording time was given."}, wcpm = null, wpm = null;
  if (timing.speakSecs){
    const mins = timing.speakSecs/60; wcpm = Math.round(correct/mins); wpm = Math.round(hyp.filter(h=>!FILLER_ONE.test(h.w)).length/mins);
    const s = (wcpm >= 110 && wpm <= 180) ? 3 : ((wcpm >= 90 && wpm <= 200) ? 2 : (wcpm >= 70 ? 1 : 0));
    const why = wpm > 180 ? `You read at ${wpm} words a minute, which is fast. Slow down so each word is clear.`
      : wcpm < 90 ? `You read ${wcpm} correct words a minute, which is slow. Practise until it flows.`
      : wcpm < 110 ? `You read ${wcpm} correct words a minute, which is a little slow.` : `Good pace: ${wcpm} correct words a minute.`;
    pace = {score:s, reason:why};
  }

  // phrasing (approximate, from pauses)
  let phrasing = {score:null, reason:"Not measured: this needs a microphone recording."};
  const boundaries = (t.text.match(/[,.;:!?]/g)||[]).length - 1;
  if (timing.measured){
    const p = timing.pauses.filter(x => x.dur < 2).length;
    const perWord = p / Math.max(1, hyp.length);
    let s = 3; const notes = [];
    if (perWord > 0.35){ s -= 2; notes.push("you paused after almost every word (word-by-word reading)"); }
    else if (p > boundaries*1.5 + 2){ s -= 1; notes.push(`${p} pauses for ${boundaries} commas and full stops, so some pauses broke up phrases`); }
    if (p < boundaries*0.4){ s -= 1; notes.push("you read through most commas and full stops without pausing"); }
    phrasing = {score:clamp(s,0,3), reason: notes.length ? cap(notes.join("; ")) + "." : `Pauses matched the punctuation well (${p} pauses, ${boundaries} commas and full stops).`};
  }
  if (timing.longPauses) issues.push({cls:"note", type:"Long hesitation", why:`You stopped for 2 seconds or more ${timing.longPauses} time${timing.longPauses>1?"s":""}. Noted, not counted.`, wi:-1});

  return {words, inserts, issues, errs, minors, accPct, accScore, pace, phrasing, wcpm, wpm, correct, refCount, weighted, minorW, hypCount:hyp.length};
}
const RANK = {ok:0, none:0, tip:1, minor:2, err:3, skip:3, unread:3};
const worst = (a,b) => (RANK[b] > RANK[a] ? b : a);

const PATTERN_LINE = {
  ending:"You often drop or add word endings (-s, -ed). Look at the end of each word as you read.",
  tense:"You changed the tense more than once. Watch past-tense verbs like “held” and “walked.”",
  small:"You often swap small words (a, the, in, on). Slow down on these short words.",
  skip:"You skipped several words. Follow the line with your finger or the cursor.",
  add:"You added words that aren't in the text. Read only what is written.",
  guess:"You guessed several words from their first letter. Look at the whole word before saying it.",
  similar:"You swapped several words for similar-looking ones. Slow down and check each word.",
  pron:"A few words sounded like other words. Practise saying them slowly.",
};
function patternOf(list){
  const by = {}; list.forEach(x => { if (x.pattern && x.pattern !== "unread") (by[x.pattern] ||= []).push(x); });
  const top = Object.entries(by).filter(([,a]) => a.length >= 2).sort((a,b)=>b[1].length-a[1].length)[0];
  if (!top || !PATTERN_LINE[top[0]]) return "";
  const ex = top[1].slice(0,2).map(x => x.said ? `“${x.said}” for “${x.expected}”` : `“${x.expected}”`).join(", ");
  return `${PATTERN_LINE[top[0]]} (${top[1].length} times, e.g. ${ex})`;
}

function renderReadFeedback(R, t, transcript, timing, audioUrl, source){
  const parts = [R.accScore, R.pace.score, R.phrasing.score];
  const maxes = [4, 3, 3];
  const measuredMax = maxes.reduce((a,m,i) => a + (parts[i]===null?0:m), 0);
  const total = parts.reduce((a,s) => a + (s||0), 0);
  const ratio = total / measuredMax;
  const band = ratio>=.9?["Excellent","var(--green-dot)","var(--green-soft)"]:ratio>=.7?["Good","var(--accent)","var(--accent-soft)"]:ratio>=.4?["Developing","var(--amber-dot)","var(--amber-soft)"]:["Beginning","var(--red-dot)","var(--red-soft)"];

  const chips = [];
  if (timing.speakSecs) chips.push(["", `Reading time: ${Math.round(timing.speakSecs)} s`]);
  if (R.wcpm !== null) chips.push([R.wcpm<90?"mid":"", `${R.wcpm} correct words/min`]);
  chips.push([R.accPct<85?"bad":R.accPct<93?"mid":"", `Accuracy ${Math.round(R.accPct)}%`]);
  chips.push(["", source==="mic" ? "Transcript: speech recognition" : "Transcript: typed"]);

  let h = `<div class="checks">${chips.map(([c,m])=>`<span class="chk ${c}">${esc(m)}</span>`).join("")}</div>`;
  h += `<div class="scorecard"><div class="score-head">${ringHTML(total, measuredMax, band[1])}
        <div><div class="band">${band[0]}</div><div class="sub">${esc(t.label)} · ${R.errs.length} error${R.errs.length===1?"":"s"}, ${R.minors.length} minor</div></div></div>`;
  const crit = [
    ["Accuracy", R.accScore, 4, `${R.errs.length} error${R.errs.length===1?"":"s"} and ${R.minors.length} minor error${R.minors.length===1?"":"s"} (each minor error counts as ${R.minorW}) in ${R.refCount} words. ${Math.round(R.accPct)}% accurate.`],
    ["Pace", R.pace.score, 3, R.pace.reason],
    ["Phrasing", R.phrasing.score, 3, R.phrasing.reason + (R.phrasing.score!==null ? " (Estimated from pauses. Intonation isn't measured.)" : "")],
  ];
  h += crit.map(([n,s,m,why]) => `<div class="crit"><div><div class="name">${n}</div><div class="bar">${Array.from({length:m},(_,k)=>`<span class="${s!==null&&k<s?"on":""}"></span>`).join("")}</div><div class="sub">${s===null?"—":s}/${m}</div></div><div>${esc(why)}</div></div>`).join("") + `</div>`;

  // passage with marks
  let n = 0; const numbered = new Map();
  R.issues.filter(x => x.cls==="err"||x.cls==="minor").forEach(x => { if (!numbered.has(x)) numbered.set(x, ++n); });
  const byWord = {}; R.issues.forEach(x => { if (!x.ins && x.wi >= 0) (byWord[x.wi] ||= []).push(x); });
  let passage = "";
  R.words.forEach((w, i) => {
    (R.inserts[i]||[]).forEach(ins => { passage += `<span class="ins ${ins.cls==="note"?"note":ins.cls==="ok"?"ok":""}" title="${esc(ins.type)}">+${esc(ins.w)}</span> `; });
    const its = byWord[i] || [];
    const tip = its.map(x => `${x.type}${x.said?`: you said “${x.said}”`:""}`).join("; ");
    const num = its.map(x => numbered.get(x)).filter(Boolean)[0];
    const cls = w.cls === "ok" ? "" : `rw r-${w.cls}`;
    passage += cls ? `<span class="${cls}" title="${esc(tip)}">${esc(w.w)}${num?`<sup>${num}</sup>`:""}</span> ` : esc(w.w) + " ";
  });
  (R.inserts[R.words.length]||[]).forEach(ins => { passage += `<span class="ins ${ins.cls==="note"?"note":""}" title="${esc(ins.type)}">+${esc(ins.w)}</span> `; });
  h += `<div class="section"><h3>The passage, marked</h3><div class="answer-view" style="white-space:normal">${passage}</div>
    <div class="legend"><span><span class="rw r-err">word</span> error</span><span><span class="rw r-minor">word</span> minor</span><span><span class="rw r-skip">word</span> skipped</span><span><span class="rw r-tip">word</span> pronunciation tip</span><span><span class="ins">+word</span> added</span><span><span class="ins note">+word</span> repeat or filler</span></div></div>`;

  const list = (title, arr, numberedList) => arr.length ? `<div class="section"><h3>${title} (${arr.length})</h3>${arr.map(x => `
     <div class="err ${x.cls==="err"?"serious":""}"><div class="n ${x.cls==="tip"||x.cls==="note"||x.cls==="ok"||x.cls==="none"?"info":""}">${numberedList ? (numbered.get(x)||"•") : "•"}</div><div>
       <span class="tag">${esc(x.type)}</span>${x.meaning?`<span class="tag mean">changes meaning</span>`:""}<br>
       ${x.said && x.expected ? `You said <s>${esc(x.said)}</s> for <span class="fix">${esc(x.expected)}</span>` : x.expected ? `<span class="fix">${esc(x.expected)}</span> was not read` : x.said ? `You said “${esc(x.said)}”` : ""}
       <div class="sub">${esc(x.why)}</div></div></div>`).join("")}</div>` : "";
  const trailing = R.errs.filter(x => x.type==="Stopped before the end");
  const errsShown = R.errs.filter(x => x.type!=="Stopped before the end");
  h += list("Errors", errsShown, true);
  if (trailing.length) h += `<div class="callout warn"><b>Stopped before the end:</b> ${trailing.length} word${trailing.length>1?"s":""} at the end were not read and count as skipped.</div>`;
  h += list("Minor errors", R.minors, true);
  h += list("Pronunciation tips (not counted)", R.issues.filter(x=>x.cls==="tip"), false);
  h += list("Noted, not counted", R.issues.filter(x=>x.cls==="note"||x.cls==="ok"||x.cls==="none"), false);

  const pat = patternOf(R.errs.concat(R.minors, R.issues.filter(x=>x.cls==="tip")));
  if (pat) h += `<div class="callout pattern"><b>Repeated mistake:</b> ${esc(pat)}</div>`;
  const weakest = crit.filter(c => c[1] !== null).sort((a,b) => a[1]/a[2] - b[1]/b[2])[0];
  const NEXT = {Accuracy:"Read the passage once silently, then aloud, pointing at each word. Pay attention to the word endings.",
    Pace:"Read it again aloud 2–3 times. Aim for the speed you would use to tell a friend a story.",
    Phrasing:"Pause briefly at commas and a little longer at full stops. Read words that belong together in one breath."};
  h += weakest[1] === weakest[2] ? `<div class="callout next"><b>Great reading.</b> Try the other passage, or read this one with more expression.</div>` : `<div class="callout next"><b>Your next step (${weakest[0]}):</b> ${NEXT[weakest[0]]}</div>`;

  if (audioUrl) h += `<div class="section"><h3>Your recording</h3><audio controls src="${audioUrl}"></audio></div>`;
  h += `<div class="section"><details><summary>What the speech engine heard</summary><div class="improved" style="margin-top:8px">${esc(transcript)}</div>
    <div class="sub" style="margin-top:6px">Speech recognition sometimes “fixes” small mistakes, such as a dropped “-s”, so some errors may be missed. It can also mishear a clear word.</div></details></div>`;
  h += `<details class="section settings"><summary>How this was scored</summary><table class="metrics">
    <tr><td>Words in passage / words heard</td><td>${R.refCount} / ${R.hypCount}</td></tr>
    <tr><td>Read correctly</td><td>${R.correct}</td></tr>
    <tr><td>Errors / minor errors (weight)</td><td>${R.errs.length} / ${R.minors.length} (×${R.minorW})</td></tr>
    <tr><td>Accuracy</td><td>${Math.round(R.accPct)}%  →  97% = 4, 93% = 3, 85% = 2, 70% = 1</td></tr>
    <tr><td>Correct words / words per minute</td><td>${R.wcpm ?? "—"} / ${R.wpm ?? "—"}</td></tr>
    <tr><td>Pace bands</td><td>3: ≥110 correct and ≤180 total words/min</td></tr>
    <tr><td>Pauses (0.4–2 s) / long hesitations (≥2 s)</td><td>${timing.measured ? timing.pauses.filter(p=>p.dur<2).length + " / " + timing.longPauses : "—"}</td></tr></table>
    <p>The thresholds are first guesses. Agree them with the language expert, as listed at the end of the Read-Aloud Scoring Rules.</p></details>`;
  $("sOut").innerHTML = h;
}

/* =========================================================
   SPOKEN ANSWER SCORING (self-intro, answer a question)
   ========================================================= */
async function scoreSpoken(t, transcript, timing, audioUrl, source){
  $("sOut").innerHTML = `<div class="empty"><span class="spinner"></span> Checking your answer…</div>`;
  const clean = transcript.replace(/\s+/g," ").trim();
  const fillers = (clean.match(FILLERS)||[]).length; FILLERS.lastIndex = 0;
  const forGrammar = clean.replace(FILLERS, "").replace(/\s+/g," ").trim(); FILLERS.lastIndex = 0;
  const pseudoTask = {label:t.label, prompt:t.prompt, points:t.points, min:0, max:9999};
  const ctx = buildCtx(forGrammar, pseudoTask);
  // spoken transcripts have no full stops: treat the whole answer as one "sentence" for points that check sentences
  if (ctx.sents.length <= 1) ctx.sents = [{text:forGrammar, start:0, end:forGrammar.length}];

  const g = await grammarCheck(forGrammar);
  // Only real grammar/word-choice issues: transcripts have no punctuation or capitals, and recognised words are always spelled right
  const errors = g.issues.filter(i => (i.type === "grammar" || i.type === "word choice") && !/SENT_START|UPPERCASE|COMMA|PUNCT|CAPITAL|WHITESPACE|RUN_ON|MISSING_.*_PUNCT/i.test(i.rule));
  ctx.errors = errors;

  const nWords = words(forGrammar);
  // Content
  const content = SCORERS.checklist(ctx);
  // Fluency
  let fluency = {score:null, reason:"Not measured: no recording time was given."};
  let wpm = null;
  if (timing.speakSecs){
    wpm = Math.round(nWords / (timing.speakSecs/60));
    let s = 4; const notes = [];
    if (wpm < 80){ s -= 2; notes.push(`your pace was slow (${wpm} words a minute)`); }
    else if (wpm < 100){ s -= 1; notes.push(`your pace was a little slow (${wpm} words a minute)`); }
    else if (wpm > 190){ s -= 1; notes.push(`you spoke very fast (${wpm} words a minute)`); }
    if (timing.longPauses >= 3){ s -= 1; notes.push(`you stopped for 2 seconds or more ${timing.longPauses} times`); }
    if (timing.measured && timing.pauseRatio > 0.4){ s -= 1; notes.push(`you were silent for ${Math.round(timing.pauseRatio*100)}% of the time`); }
    if (t.minSec && timing.speakSecs < t.minSec){ s -= 1; notes.push(`your answer was short (${Math.round(timing.speakSecs)} s; aim for ${t.minSec}–${t.maxSec} s)`); }
    if (fillers / (timing.speakSecs/60) > 6){ s -= 1; notes.push(`you used many fillers (${fillers})`); }
    fluency = {score:clamp(s), reason: notes.length ? cap(notes.join("; ")) + "." : `Smooth and steady at ${wpm} words a minute.`};
  }
  const accuracy = SCORERS.accuracy({...ctx, n:nWords, errors});
  if (!errors.length) accuracy.reason = "No grammar or word-choice mistakes found.";
  const vocab = SCORERS.vocab(ctx);
  const crit = [["Content",content,4],["Fluency",fluency,4],["Language accuracy",accuracy,4],["Vocabulary",vocab,4]];
  const measured = crit.filter(c => c[1].score !== null);
  const total = measured.reduce((a,c)=>a+c[1].score,0), max = measured.length*4;
  const ratio = total/max;
  const band = ratio>=.875?["Excellent","var(--green-dot)","var(--green-soft)"]:ratio>=.625?["Good","var(--accent)","var(--accent-soft)"]:ratio>=.375?["Developing","var(--amber-dot)","var(--amber-soft)"]:["Beginning","var(--red-dot)","var(--red-soft)"];

  const chips = [];
  if (timing.speakSecs){ const s = Math.round(timing.speakSecs); chips.push([s<t.minSec?"mid":s>t.maxSec?"mid":"", `Speaking time: ${s} s (target ${t.minSec}–${t.maxSec})`]); }
  if (wpm !== null) chips.push(["", `${wpm} words/min`]);
  chips.push([fillers>4?"mid":"", `Fillers heard: ${fillers}`]);
  chips.push(["", source==="mic" ? "Transcript: speech recognition" : "Transcript: typed"]);
  chips.push([g.source==="lt"?"":"mid", g.source==="lt" ? "Grammar: LanguageTool" : "Grammar: basic offline checks"]);

  let h = `<div class="checks">${chips.map(([c,m])=>`<span class="chk ${c}">${esc(m)}</span>`).join("")}</div>`;
  if (ctx.offTask) h += `<div class="callout warn"><b>This answer may be off-topic.</b> It uses very few of the question's key words.</div>`;
  h += `<div class="scorecard"><div class="score-head">${ringHTML(total, max, band[1])}
        <div><div class="band">${band[0]}</div><div class="sub">${esc(t.label)} · ${nWords} words</div></div></div>`;
  h += crit.map(([n,s,m]) => `<div class="crit"><div><div class="name">${n}</div><div class="bar">${[1,2,3,4].map(k=>`<span class="${s.score!==null&&k<=s.score?"on":""}"></span>`).join("")}</div><div class="sub">${s.score===null?"—":s.score}/${m}</div></div><div>${esc(s.reason)}</div></div>`).join("") + `</div>`;

  h += `<div class="section"><h3>Points covered</h3><div class="cl">${ctx.checklist.map(i => `<span class="${i.status}">${i.status==="done"?"✓":"○"} ${esc(i.point)}</span>`).join("")}</div></div>`;

  const marks = errors.map((e,i)=>({...e, n:i+1}));
  h += `<div class="section"><h3>What you said</h3><div class="answer-view">${highlight(forGrammar, marks)}</div>
        <div class="sub" style="margin-top:6px">Grammar and word choice only: spoken answers aren't marked for punctuation or spelling.</div></div>`;
  if (errors.length) h += `<div class="section"><h3>Fix these (${errors.length})</h3>${errors.slice(0,10).map((e,i)=>`
      <div class="err serious"><div class="n">${i+1}</div><div><span class="tag">${esc(e.type)}</span><br>
      <s>${esc(e.span)}</s>${e.fix&&e.fix.length?` → <span class="fix">${esc(e.fix[0])}</span>`:""}<div class="sub">${esc(e.why)}</div></div></div>`).join("")}</div>`;
  const tips = [...ctx.ieTips.map(x=>x.msg)];
  if (ctx.repeated.length) tips.push(`You repeat some words a lot: ${ctx.repeated.slice(0,3).join(", ")}. Try a synonym.`);
  if (fillers) tips.push(`You used ${fillers} filler${fillers>1?"s":""} (umm, uh). A short silent pause sounds more confident.`);
  if (tips.length) h += `<div class="section"><h3>Tips (not counted as mistakes)</h3><ul class="clean">${tips.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`;
  const pat = findPattern(errors);
  if (pat) h += `<div class="callout pattern"><b>Repeated mistake:</b> ${esc(pat)}</div>`;
  const weakest = measured.sort((a,b)=>a[1].score-b[1].score)[0];
  const NEXT = {Content:"Before you speak, list the points on your fingers (name, place, course…) and say each one.",
    Fluency:"Practise the answer 2–3 times. Aim for a steady pace with short pauses, not long stops.",
    "Language accuracy":"Record yourself, listen back, and check your verbs: “I am studying,” not “I am belonging.”",
    Vocabulary:"Swap repeated words for different ones, e.g. “like” → enjoy, love, am interested in."};
  h += weakest[1].score === 4 ? `<div class="callout next"><b>Great work.</b> Next time, add one more detail or example to make your answer even richer.</div>` : `<div class="callout next"><b>Your next step (${weakest[0]}):</b> ${NEXT[weakest[0]]}</div>`;
  if (audioUrl) h += `<div class="section"><h3>Your recording</h3><audio controls src="${audioUrl}"></audio></div>`;
  h += `<details class="section settings"><summary>How this was scored</summary><table class="metrics">
    <tr><td>Words spoken</td><td>${nWords}</td></tr>
    <tr><td>Words per minute</td><td>${wpm ?? "—"} (100–190 natural)</td></tr>
    <tr><td>Long hesitations (≥2 s)</td><td>${timing.measured ? timing.longPauses : "—"}</td></tr>
    <tr><td>Silent time</td><td>${timing.measured ? Math.round(timing.pauseRatio*100)+"%" : "—"}</td></tr>
    <tr><td>Grammar issues per 100 words</td><td>${(errors.length*100/Math.max(nWords,1)).toFixed(1)}</td></tr>
    <tr><td>Word variety</td><td>${Math.round(ctx.ttr*100)}%</td></tr>
    <tr><td>Points covered</td><td>${ctx.checklist.filter(c=>c.status==="done").length}/${ctx.checklist.length}</td></tr></table>
    <p>Pronunciation and intonation aren't scored for spoken answers. Browser speech recognition doesn't report how clearly each word was said.</p></details>`;
  $("sOut").innerHTML = h;
}

renderSTabs(); renderSPrompt();


/* ---------- Feedback pop-up: opens once there is feedback ---------- */
(function(){
  const view = $("speakView"), out = $("sOut"), modal = $("fbModal");
  const isEmpty = () => out.children.length === 1 && out.firstElementChild.classList.contains("empty") && !out.querySelector(".spinner");
  let had = false;
  const open = () => {
    $("fbTitle").textContent = STASKS[sCurrent].label;
    const keys = Object.keys(STASKS), i = keys.indexOf(sCurrent);
    $("fbNext").textContent = i < keys.length - 1 ? `Next: ${STASKS[keys[i+1]].label.replace(/^Read aloud: /,"")} →` : "Back to the first task →";
    view.classList.add("fb-on"); modal.classList.add("show"); modal.setAttribute("aria-hidden","false");
    setTimeout(() => $("fbClose").focus({preventScroll:true}), 60);
  };
  const close = () => { view.classList.remove("fb-on"); modal.classList.remove("show"); modal.setAttribute("aria-hidden","true"); };
  // a short warning (e.g. "write a few sentences first") isn't feedback: show it as a note, keep the pop-up shut
  const note = msg => {
    let n = document.getElementById("inlineNote");
    if (!n){ n = document.createElement("div"); n.id = "inlineNote"; n.className = "inline-note"; n.setAttribute("role","status"); document.body.appendChild(n); }
    n.textContent = msg; n.classList.add("show"); clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove("show"), 3800);
  };
  function sync(){
    if (out.children.length === 1 && out.firstElementChild.matches(".callout.warn")){
      note(out.firstElementChild.textContent.trim());
      out.innerHTML = `<div class="empty">Your feedback will appear here.</div>`;
      return;
    }
    const has = !isEmpty();
    view.classList.toggle("has-fb", has);
    if (has && !had) open();
    if (!has) close();
    had = has;
  }
  new MutationObserver(sync).observe(out, {childList:true});
  $("fbClose").onclick = close;
  $("fbOpen").onclick = open;
  $("fbRetry").onclick = () => { close(); resetSpeakOut(); };
  $("fbNext").onclick = () => {
    const keys = Object.keys(STASKS), next = keys[(keys.indexOf(sCurrent) + 1) % keys.length];
    close(); document.querySelector(`#sTabs .tab[data-k="${next}"]`)?.click();
  };
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && modal.classList.contains("show") && $("settingsSheet").hidden) close(); });
  sync();
})();

/* ---------- Phone: task rail opens on tap / hover ---------- */
(function(){
  const rail = document.querySelector(".sidebar"), tb = document.querySelector(".toolbar");
  if (!rail || !tb) return;
  const phone = () => innerWidth < 900;
  const setH = () => document.documentElement.style.setProperty("--tb-h", tb.offsetHeight + "px");
  const open = () => { if (phone()) rail.classList.add("open"); };
  const close = () => rail.classList.remove("open");
  setH(); addEventListener("resize", () => { setH(); if (!phone()) close(); });
  // first tap on the closed rail only opens it; it doesn't switch task
  rail.addEventListener("click", e => {
    if (phone() && !rail.classList.contains("open")){ e.preventDefault(); e.stopPropagation(); open(); }
  }, true);
  // choosing a task closes the rail again
  rail.addEventListener("click", e => { if (phone() && e.target.closest(".tab")) setTimeout(close, 280); });
  document.addEventListener("click", e => { if (rail.classList.contains("open") && !rail.contains(e.target)) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  if (matchMedia("(hover:hover)").matches){ rail.addEventListener("mouseenter", open); rail.addEventListener("mouseleave", close); }
})();

/* ---------- Type-instead pop-up (no microphone) ---------- */
(function(){
  const box = $("manualBox");
  const openType = () => { box.classList.add("show"); box.setAttribute("aria-hidden","false"); setTimeout(() => $("manualText").focus(), 80); };
  const closeType = () => { box.classList.remove("show"); box.setAttribute("aria-hidden","true"); };
  // older code opens it with manualBox.open = true
  Object.defineProperty(box, "open", { get: () => box.classList.contains("show"), set: v => v ? openType() : closeType() });
  $("typeBtn").onclick = () => { if (!recState.on) openType(); };
  $("typeClose").onclick = closeType;
  box.addEventListener("click", e => { if (e.target === box) closeType(); });
  $("manualGo").addEventListener("click", () => { if ($("manualText").value.trim()) setTimeout(closeType, 50); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && box.classList.contains("show")) closeType(); });
})();
