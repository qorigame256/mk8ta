// マリカTA記録 本体。画面の切り替えは URL の # 以降で行う（#/course/c01 など）。
// 記録は iPhone の中（localStorage）だけに保存する。外部へは送らない。
"use strict";

const STORE_KEY = "mk8ta.v1";
const PLATFORMS = ["SFC", "N64", "GBA", "GC", "DS", "Wii", "3DS", "Tour"];
const COMBO_FIELDS = [
  ["driver", "キャラ"],
  ["body", "車体"],
  ["tires", "タイヤ"],
  ["glider", "グライダー"],
];

/* ---------- 保存 ---------- */

function loadData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.records)) {
        d.settings = Object.assign({ cc: "150", scope: "all", sort: "cup", pick: "random" }, d.settings);
        if (!d.targets || typeof d.targets !== "object") d.targets = {};
        if (!d.targetLaps || typeof d.targetLaps !== "object") d.targetLaps = {};
        if (!Array.isArray(d.battles)) d.battles = [];
        if (!Array.isArray(d.pickExclude)) d.pickExclude = [];
        return d;
      }
    }
  } catch (e) {
    console.error(e);
  }
  return { version: 1, records: [], targets: {}, targetLaps: {}, battles: [], pickExclude: [], settings: { cc: "150", scope: "all", sort: "cup", pick: "random" } };
}

let data = loadData();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(e);
    toast("保存に失敗しました。容量不足の可能性があります");
    return false;
  }
}

// 目標タイムはコース×排気量ごと。キーは "c01|150"
function targetOf(courseId, cc) {
  return data.targets[`${courseId}|${cc}`] ?? null;
}

// 目標ラップ（任意）。目標タイムと同じキーで、値はラップの配列（途中の空欄は null）。無ければ null
function targetLapsOf(courseId, cc) {
  return data.targetLaps[`${courseId}|${cc}`] ?? null;
}

// ラップごとの目標との差。どちらかが空の周は「—」。比べられる周が1つも無ければ ""
function lapGapText(laps, tLaps) {
  if (!laps || !tLaps) return "";
  const n = Math.max(laps.length, tLaps.length);
  const parts = [];
  let any = false;
  for (let i = 0; i < n; i++) {
    const a = laps[i], t = tLaps[i];
    if (Number.isInteger(a) && Number.isInteger(t)) { parts.push(fmtDiff(a - t)); any = true; }
    else parts.push("—");
  }
  return any ? parts.join(" / ") : "";
}

/* ---------- 対戦の評価 ---------- */
// 対戦で走ったコースに「良い／普通／悪い」を付けた記録。排気量は分けない。TA の記録とは別に持つ。
// 1件 = { id, courseId, rating: 1（良い）| 0（普通）| -1（悪い）, date, createdAt }

const RATINGS = [
  [1, "良い", "良", "good"],
  [0, "普通", "普", "normal"],
  [-1, "悪い", "悪", "bad"],
];
const RATING_BY_VALUE = Object.fromEntries(RATINGS.map((r) => [r[0], r]));
const BATTLE_RECENT = 5; // 苦手の判定に使う「最近の回数」

function battlesOf(courseId) {
  return data.battles.filter((b) => b.courseId === courseId).sort((a, b) => a.createdAt - b.createdAt);
}

// 直近5回の評価の合計（良い+1・普通0・悪い-1）。評価が無ければ null。マイナスなら「練習すべき」
function battleScore(courseId) {
  const all = battlesOf(courseId);
  if (!all.length) return null;
  const recent = all.slice(-BATTLE_RECENT);
  return { score: recent.reduce((s, b) => s + b.rating, 0), recent, total: all.length, lastAt: all[all.length - 1].createdAt };
}

// 練習すべきコース：合計がマイナスのものを、低い順（同点は最後に評価したのが新しい順）
function weakCourses() {
  const out = [];
  for (const c of COURSES) {
    const bs = battleScore(c.id);
    if (bs && bs.score < 0) out.push({ c, ...bs });
  }
  return out.sort((a, b) => a.score - b.score || b.lastAt - a.lastAt);
}

// 評価の小さな札。並びは古い→新しい
function ratingChips(list) {
  return list.map((b) => {
    const r = RATING_BY_VALUE[b.rating];
    return `<span class="rt rt-${r[3]}">${r[2]}</span>`;
  }).join("");
}

function scoreText(score) {
  return score > 0 ? `+${score}` : score < 0 ? `−${-score}` : "±0";
}

/* ---------- コース画像 ---------- */
// 画像は大きいので localStorage ではなく IndexedDB（＝ブラウザ内の大きめの保存場所）に入れる。
// 中身は縮小した JPEG の data URL 文字列。キーはコースの id。端末の外へは出さない（書き出しファイルには含める）。

const IMG_DB = "mk8ta-images";
const images = {}; // courseId → data URL（起動時に全部読み込んでおく）

function imgDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IMG_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("img");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function imgTx(mode, fn) {
  const db = await imgDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("img", mode);
    const result = fn(tx.objectStore("img"));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

async function loadImages() {
  const all = {};
  await imgTx("readonly", (st) => {
    st.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) return;
      all[cur.key] = cur.value;
      cur.continue();
    };
  });
  Object.assign(images, all);
}

async function setImage(courseId, dataUrl) {
  await imgTx("readwrite", (st) => (dataUrl ? st.put(dataUrl, courseId) : st.delete(courseId)));
  if (dataUrl) images[courseId] = dataUrl;
  else delete images[courseId];
}

// 選んだ写真を横 640px 以内の JPEG に縮める（そのままだと1枚数 MB になるため）
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 640 / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読めません")); };
    img.src = url;
  });
}

/* ---------- タイムの変換 ---------- */

// 123456 → "1:23.456"
function fmt(ms) {
  if (ms == null || isNaN(ms)) return "";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(t).padStart(3, "0")}`;
}

// ラップ用。1分未満なら "37.123" と短く書く
function fmtLap(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}`;
  return fmt(ms);
}

// 差分。-512 → "-0.512"
function fmtDiff(ms) {
  const sign = ms < 0 ? "-" : "+";
  const a = Math.abs(ms);
  return sign + (a >= 60000 ? fmt(a) : fmtLap(a));
}

// 数字だけの入力を読む。末尾3桁＝1/1000秒、その前2桁＝秒、残り＝分。
// "152345" → 1:52.345、"37123" → 37.123。読めなければ null
function parseDigits(str) {
  const d = String(str).replace(/\D/g, "");
  if (d.length < 5 || d.length > 7) return null;
  const ms = Number(d.slice(-3));
  const s = Number(d.slice(-5, -3));
  const m = d.length > 5 ? Number(d.slice(0, -5)) : 0;
  if (s >= 60) return null;
  return m * 60000 + s * 1000 + ms;
}

// ms → 入力欄に戻すときの数字列（"152345"）
function toDigits(ms) {
  if (ms == null) return "";
  return fmt(ms).replace(/\D/g, "").replace(/^0+(?=\d{5})/, "");
}

/* ---------- 小物 ---------- */

const $view = document.getElementById("view");
const $title = document.getElementById("title");
const $back = document.getElementById("back");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// "SFC ドーナツへいや3" → 機種を小さく添えた HTML
function courseLabel(name) {
  const i = name.indexOf(" ");
  if (i > 0 && PLATFORMS.includes(name.slice(0, i))) {
    return `<span class="plat">${esc(name.slice(0, i))}</span>${esc(name.slice(i + 1))}`;
  }
  return esc(name);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${y}/${Number(m)}/${Number(d)}`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let toastTimer;
function toast(msg, gold) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (gold ? " gold" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = gold ? "gold" : ""), 2600);
}

function go(hash) {
  location.hash = hash;
}

function recordsOf(courseId, cc) {
  return data.records.filter((r) => r.courseId === courseId && r.cc === cc);
}

function bestOf(records) {
  let best = null;
  for (const r of records) if (!best || r.timeMs < best.timeMs) best = r;
  return best;
}

// 日付順（同じ日は登録順）に並べる
function byDate(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt;
}

// 自己ベストと目標の差。プラス＝まだ遅い（あと何秒）、0以下＝達成
function targetGap(best, target) {
  if (!best || target == null) return null;
  return best.timeMs - target;
}

function gapText(gap) {
  if (gap == null) return "";
  return gap > 0 ? `目標まで ${fmtDiff(gap)}` : `目標達成 ${fmtDiff(gap)}`;
}

// 日付順に見て、その時点の自己ベストを縮めた記録 → 縮めた差（マイナスの ms）
function improvements(recsByDate) {
  const out = {};
  let run = null;
  for (const r of recsByDate) {
    if (run != null && r.timeMs < run) out[r.id] = r.timeMs - run;
    if (run == null || r.timeMs < run) run = r.timeMs;
  }
  return out;
}

// 検索用に表記ゆれを吸収する：カタカナ→ひらがな、英字は小文字、空白は無視
function norm(str) {
  return String(str)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");
}

function ccSwitch() {
  const cc = data.settings.cc;
  return `<div class="seg" id="cc-seg">
    <button data-cc="150" class="${cc === "150" ? "on" : ""}">150cc</button>
    <button data-cc="200" class="${cc === "200" ? "on" : ""}">200cc</button>
  </div>`;
}

function bindCcSwitch(rerender) {
  document.querySelectorAll("#cc-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      data.settings.cc = b.dataset.cc;
      save();
      rerender();
    })
  );
}

/* ---------- 画面：コース一覧 ---------- */

let searchText = ""; // 検索欄の文字（アプリを閉じるまで覚えておく）

function renderHome() {
  $title.textContent = "マリカTA記録";
  $back.hidden = true;
  const scope = data.settings.scope; // all / done / todo
  const sort = data.settings.sort; // cup / target

  $view.innerHTML = `<div class="toolbar">${ccSwitch()}</div>
    <button class="btn pick-btn" id="pick-btn">🎲 おまかせで次のコースを決める</button>
    <button class="btn pick-btn" id="battle-btn">⚔ 対戦の記録・練習すべきコース</button>
    <div class="toolbar"><div class="seg" id="scope-seg">
      <button data-v="all" class="${scope === "all" ? "on" : ""}">すべて</button>
      <button data-v="done" class="${scope === "done" ? "on" : ""}">記録あり</button>
      <button data-v="todo" class="${scope === "todo" ? "on" : ""}">未記録</button>
    </div></div>
    <div class="toolbar"><div class="seg" id="sort-seg">
      <button data-v="cup" class="${sort === "cup" ? "on" : ""}">カップ順</button>
      <button data-v="target" class="${sort === "target" ? "on" : ""}">目標に近い順</button>
    </div></div>
    <div class="search"><input id="search" class="input" type="search" placeholder="コース名で検索" autocomplete="off" value="${esc(searchText)}"></div>
    <div id="home-list"></div>`;

  bindCcSwitch(renderHome);
  document.getElementById("pick-btn").addEventListener("click", () => {
    pickedId = null; // 一覧から入るたびに新しく選ぶ
    go("#/pick");
  });
  document.getElementById("battle-btn").addEventListener("click", () => go("#/battle"));
  for (const [id, key] of [["scope-seg", "scope"], ["sort-seg", "sort"]]) {
    document.querySelectorAll(`#${id} button`).forEach((b) =>
      b.addEventListener("click", () => {
        data.settings[key] = b.dataset.v;
        save();
        renderHome();
      })
    );
  }
  // 検索は一覧の部分だけ描き直す（全体を描き直すと入力中のキーボードが閉じるため）
  document.getElementById("search").addEventListener("input", (e) => {
    searchText = e.target.value;
    renderHomeList();
  });
  renderHomeList();
}

function renderHomeList() {
  const cc = data.settings.cc;
  const scope = data.settings.scope;
  const q = norm(searchText);

  let doneCount = 0;
  const info = {};
  for (const c of COURSES) {
    const recs = recordsOf(c.id, cc);
    const best = bestOf(recs);
    if (best) doneCount++;
    info[c.id] = { best, n: recs.length, gap: targetGap(best, targetOf(c.id, cc)) };
  }

  const shown = COURSES.filter((c) =>
    (scope === "done" ? info[c.id].best : scope === "todo" ? !info[c.id].best : true) &&
    (!q || norm(c.name).includes(q) || norm(c.cup).includes(q))
  );

  const row = (c, withCup) => {
    const { best, n, gap } = info[c.id];
    const sub = [withCup ? esc(c.cup) : "", n ? `${n}件` : ""].filter(Boolean).join("・");
    return `<button class="row" data-id="${c.id}">
      ${images[c.id] ? `<img class="thumb" src="${images[c.id]}" alt="">` : ""}
      <span class="name">${courseLabel(c.name)}${sub ? `<small>${sub}</small>` : ""}</span>
      <span class="right"><span class="pb ${best ? "" : "none"}">${best ? fmt(best.timeMs) : "—"}</span>
        ${gap != null ? `<span class="gap ${gap > 0 ? "" : "ok"}">${gapText(gap)}</span>` : ""}</span>
      <span class="chev">›</span></button>`;
  };
  const group = (title, list, withCup) =>
    list.length ? `<section class="cup"><h2>${title}</h2><div class="list">${list.map((c) => row(c, withCup)).join("")}</div></section>` : "";

  let html = `<p class="summary">${cc}cc：${COURSES.length}コース中 ${doneCount}コースに記録あり</p>`;
  if (data.settings.sort === "target") {
    // 未達成（あと少しの順）→ 達成済み（目標に近い順）→ 目標か記録がないもの（カップ順）
    const notYet = shown.filter((c) => info[c.id].gap > 0).sort((a, b) => info[a.id].gap - info[b.id].gap);
    const done = shown.filter((c) => info[c.id].gap != null && info[c.id].gap <= 0).sort((a, b) => info[b.id].gap - info[a.id].gap);
    const none = shown.filter((c) => info[c.id].gap == null);
    html += group("目標まで あと少しの順", notYet, true) + group("目標達成", done, true) + group("目標または記録なし", none, true);
  } else {
    for (const cup of CUPS) {
      const rows = shown.filter((c) => c.cup === cup.name);
      html += group(`${esc(cup.name)}${cup.dlc ? '<span class="dlc">追加</span>' : ""}`, rows, false);
    }
  }
  if (!shown.length) {
    html += `<p class="empty">${q ? "見つかりません" : scope === "done" ? "まだ記録がありません" : "全コースに記録があります"}</p>`;
  }
  const $list = document.getElementById("home-list");
  $list.innerHTML = html;
  $list.querySelectorAll(".row").forEach((r) => r.addEventListener("click", () => go(`#/course/${r.dataset.id}`)));
}

/* ---------- 画面：おまかせ ---------- */
// 選び方に応じて「出やすさ（重み）」を付け、重みに比例した確率で1コースを引く。
// 対象は絞り込み・検索に関係なく全96コース（目標の2つは「目標あり・未達成」のコースだけ、
// 対戦で苦手は「練習すべきコース」だけ）。除外したコース（data.pickExclude）はどの選び方でも出さない。

const PICK_MODES = [
  ["random", "ランダム", "全コースから同じ確率で選びます"],
  ["stale", "久しぶり", "未記録・しばらく記録していないコースほど出やすくなります"],
  ["near", "目標に近い", "目標まであと少しのコースほど出やすくなります（目標を達成したコースは出ません）"],
  ["far", "目標に遠い", "目標まで遠いコースほど出やすくなります（目標を達成したコースは出ません）"],
  ["weak", "対戦で苦手", "対戦の「練習すべきコース」から、苦手なコースほど出やすくなります（排気量は関係ありません）"],
];

let pickedId = null; // いま表示中のおまかせ結果（コース画面から戻ったときに引き直さないため）

function daysSince(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(y, m - 1, d)) / 86400000);
}

// [{ c: コース, w: 重み }] を返す。重み0以下のコースは入れない
function pickCandidates(mode, cc) {
  // 対戦で苦手：直近5回の合計がマイナスのコース。重み＝マイナスの大きさ（−3 なら 3）
  if (mode === "weak") return weakCourses().map((x) => ({ c: x.c, w: -x.score }));
  const out = [];
  for (const c of COURSES) {
    const recs = recordsOf(c.id, cc);
    let w = 1;
    if (mode === "stale") {
      // 未記録＝61、記録あり＝最後の記録からの日数＋1（60日で頭打ち）
      const last = recs.reduce((a, r) => (!a || r.date > a ? r.date : a), null);
      w = last ? Math.min(Math.max(daysSince(last), 0), 60) + 1 : 61;
    } else if (mode === "near" || mode === "far") {
      const gap = targetGap(bestOf(recs), targetOf(c.id, cc));
      if (gap == null || gap <= 0) continue;
      // 近い：差が小さいほど重い（0.5秒を足して極端な偏りを防ぐ）／遠い：差に比例
      w = mode === "near" ? 1 / (gap + 500) : gap;
    }
    out.push({ c, w });
  }
  return out;
}

function pickOne(cands, avoidId) {
  // 候補が2つ以上なら、直前に出たコースは避ける
  const list = cands.length > 1 ? cands.filter((x) => x.c.id !== avoidId) : cands;
  const total = list.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of list) if ((r -= x.w) < 0) return x.c.id;
  return list.length ? list[list.length - 1].c.id : null;
}

function isExcluded(courseId) {
  return data.pickExclude.includes(courseId);
}

function renderPick() {
  $title.textContent = "おまかせ";
  $back.hidden = false;
  const cc = data.settings.cc;
  const mode = data.settings.pick;
  const raw = pickCandidates(mode, cc);
  const cands = raw.filter((x) => !isExcluded(x.c.id));
  if (!pickedId || !cands.some((x) => x.c.id === pickedId)) pickedId = pickOne(cands, null);

  let html = `<div class="toolbar">${ccSwitch()}</div>
    <div class="toolbar"><div class="seg pick-seg" id="pick-seg">
      ${PICK_MODES.map(([v, label]) => `<button data-v="${v}" class="${mode === v ? "on" : ""}">${label}</button>`).join("")}
    </div></div>
    <p class="summary">${PICK_MODES.find((m) => m[0] === mode)[2]}</p>
    <button class="btn pick-btn" id="pick-exclude">🚫 除外するコース（${data.pickExclude.length}）</button>`;

  if (!pickedId) {
    html += raw.length
      ? `<p class="empty">選べるコースがすべて除外されています。<br>「除外するコース」で戻すと選べるようになります。</p>`
      : mode === "weak"
      ? `<p class="empty">対戦で練習すべきコースがありません。<br>対戦の記録で「悪い」が続いたコースが選ばれるようになります。</p>`
      : `<p class="empty">目標タイムを決めていて、まだ達成していない ${cc}cc のコースがありません。<br>コースの画面で目標タイムを入れると選べるようになります。</p>`;
  } else {
    const c = COURSE_BY_ID[pickedId];
    const recs = recordsOf(c.id, cc);
    const best = bestOf(recs);
    const gap = targetGap(best, targetOf(c.id, cc));
    const last = recs.reduce((a, r) => (!a || r.date > a ? r.date : a), null);
    const ago = last ? daysSince(last) : null;
    const bs = battleScore(c.id);
    html += `<div class="pick-card">
      ${images[c.id] ? `<img src="${images[c.id]}" alt="">` : ""}
      <div class="cupname">${esc(c.cup)}</div>
      <div class="cname">${courseLabel(c.name)}</div>
      <div class="pb ${best ? "" : "none"}">${best ? `自己ベスト ${fmt(best.timeMs)}` : "まだ記録がありません"}</div>
      ${gap != null ? `<div class="gap-big ${gap > 0 ? "" : "ok"}">${gapText(gap)}</div>` : ""}
      ${last ? `<div class="sub">最後の記録 ${fmtDate(last)}（${ago <= 0 ? "今日" : `${ago}日前`}）・${recs.length}件</div>` : ""}
      ${bs ? `<div class="sub">対戦の評価（直近${bs.recent.length}回）${ratingChips(bs.recent)} 合計 ${scoreText(bs.score)}</div>` : ""}
    </div>
    <button class="btn primary" id="pick-go">このコースへ</button>
    <button class="btn" id="pick-again">🎲 もう一回</button>
    <button class="btn" id="pick-ex-one">🚫 このコースを除外</button>`;
  }
  $view.innerHTML = html;

  bindCcSwitch(() => { pickedId = null; renderPick(); });
  document.getElementById("pick-exclude").addEventListener("click", () => go("#/exclude"));
  document.querySelectorAll("#pick-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      data.settings.pick = b.dataset.v;
      save();
      pickedId = null;
      renderPick();
    })
  );
  if (pickedId) {
    document.getElementById("pick-go").addEventListener("click", () => go(`#/course/${pickedId}`));
    document.getElementById("pick-again").addEventListener("click", () => {
      pickedId = pickOne(cands, pickedId);
      renderPick();
    });
    document.getElementById("pick-ex-one").addEventListener("click", () => {
      const c = COURSE_BY_ID[pickedId];
      data.pickExclude.push(c.id);
      if (!save()) return;
      toast(`${c.name} を除外しました`);
      pickedId = null; // 除外したので引き直す
      renderPick();
    });
  }
}

/* ---------- 画面：おまかせで除外するコース ---------- */
// 行をタップするたびに「除外する／しない」が切り替わり、その場で保存する。150cc・200cc 共通。

let excludeSearch = "";

function renderExclude() {
  $title.textContent = "除外するコース";
  $back.hidden = false;
  $view.innerHTML = `<p class="summary">ここで除外したコースは、おまかせのどの選び方でも出なくなります（150cc・200cc 共通）。タップで切り替えます。</p>
    <div class="search"><input id="ex-search" class="input" type="search" placeholder="コース名で検索" autocomplete="off" value="${esc(excludeSearch)}"></div>
    <div id="ex-head"></div>
    <div id="ex-list"></div>`;
  document.getElementById("ex-search").addEventListener("input", (e) => {
    excludeSearch = e.target.value;
    renderExcludeList();
  });
  renderExcludeList();
}

function renderExcludeList() {
  const n = data.pickExclude.length;
  const $head = document.getElementById("ex-head");
  $head.innerHTML = `<div class="toolbar"><span class="summary" style="flex:1;margin:0 2px">除外中 ${n}コース</span>
    <button class="btn small" id="ex-clear" ${n ? "" : "disabled"}>すべて戻す</button></div>`;
  document.getElementById("ex-clear").addEventListener("click", () => {
    if (!confirm(`除外中の ${n}コースをすべて戻します。`)) return;
    data.pickExclude = [];
    save();
    renderExcludeList();
  });

  const q = norm(excludeSearch);
  const shown = COURSES.filter((c) => !q || norm(c.name).includes(q) || norm(c.cup).includes(q));
  let html = "";
  for (const cup of CUPS) {
    const rows = shown.filter((c) => c.cup === cup.name);
    if (!rows.length) continue;
    html += `<section class="cup"><h2>${esc(cup.name)}${cup.dlc ? '<span class="dlc">追加</span>' : ""}</h2><div class="list">${rows.map((c) => {
      const ex = isExcluded(c.id);
      return `<button class="row ex-row ${ex ? "ex" : ""}" data-id="${c.id}">
        <span class="name">${courseLabel(c.name)}</span>
        <span class="ex-mark">${ex ? "除外中" : "対象"}</span></button>`;
    }).join("")}</div></section>`;
  }
  if (!shown.length) html = `<p class="empty">見つかりません</p>`;
  const $list = document.getElementById("ex-list");
  $list.innerHTML = html;
  $list.querySelectorAll(".row").forEach((r) => r.addEventListener("click", () => {
    const id = r.dataset.id;
    data.pickExclude = isExcluded(id) ? data.pickExclude.filter((x) => x !== id) : [...data.pickExclude, id];
    save();
    renderExcludeList();
  }));
}

/* ---------- 画面：対戦の記録 ---------- */
// 「入力」：コースをタップ → 下から出る評価ボタンを押した時点で保存。続けて次のコースへ。
// 「練習すべきコース」：直近5回の合計がマイナスのコースを苦手な順に。

let battleTab = "input"; // input / weak（アプリを閉じるまで覚えておく）
let battleSearch = "";

function renderBattle() {
  $title.textContent = "対戦の記録";
  $back.hidden = false;
  const weakN = weakCourses().length;

  let html = `<div class="toolbar"><div class="seg" id="battle-seg">
      <button data-v="input" class="${battleTab === "input" ? "on" : ""}">入力</button>
      <button data-v="weak" class="${battleTab === "weak" ? "on" : ""}">練習すべきコース${weakN ? `（${weakN}）` : ""}</button>
    </div></div>`;

  if (battleTab === "input") {
    html += `<p class="summary">対戦で走ったコースをタップして、走りを3段階で評価します。押した時点で保存されます。</p>
      <div class="search"><input id="b-search" class="input" type="search" placeholder="コース名で検索" autocomplete="off" value="${esc(battleSearch)}"></div>
      <div id="battle-list"></div>
      <div id="battle-recent"></div>
      <div class="sheet-bg" id="sheet-bg" hidden></div>
      <div class="sheet" id="sheet" hidden></div>`;
  } else {
    html += `<p class="summary">直近${BATTLE_RECENT}回の評価（良い＋1・普通0・悪い−1）の合計がマイナスのコースです。苦手な順に並べています。良い評価が付けば自然に外れます。</p>`;
    const weak = weakCourses();
    if (weak.length) {
      html += `<button class="btn pick-btn" id="weak-pick">🎲 この中からおまかせで選ぶ</button>
        <div class="list" style="margin-top:12px">${weak.map((x) => `<button class="row" data-id="${x.c.id}">
          <span class="name">${courseLabel(x.c.name)}<small>${esc(x.c.cup)}・評価 ${x.total}回</small></span>
          <span class="right"><span class="score bad">${scoreText(x.score)}</span><span class="chips">${ratingChips(x.recent)}</span></span>
          <span class="chev">›</span></button>`).join("")}</div>`;
    } else {
      html += `<p class="empty">いま練習すべきコースはありません。<br>「入力」で対戦の評価を付けると、悪い評価が続いたコースがここに出ます。</p>`;
    }
  }
  $view.innerHTML = html;

  document.querySelectorAll("#battle-seg button").forEach((b) =>
    b.addEventListener("click", () => {
      battleTab = b.dataset.v;
      renderBattle();
    })
  );

  if (battleTab === "weak") {
    $view.querySelectorAll(".row").forEach((r) => r.addEventListener("click", () => go(`#/course/${r.dataset.id}`)));
    const $wp = document.getElementById("weak-pick");
    if ($wp) $wp.addEventListener("click", () => {
      data.settings.pick = "weak";
      save();
      pickedId = null;
      go("#/pick");
    });
    return;
  }

  // 検索は一覧の部分だけ描き直す（キーボードが閉じないように）
  document.getElementById("b-search").addEventListener("input", (e) => {
    battleSearch = e.target.value;
    renderBattleList();
  });
  document.getElementById("sheet-bg").addEventListener("click", closeSheet);
  renderBattleList();
  renderBattleRecent();
}

function renderBattleList() {
  const q = norm(battleSearch);
  const t = today();
  const shown = COURSES.filter((c) => !q || norm(c.name).includes(q) || norm(c.cup).includes(q));
  let html = "";
  for (const cup of CUPS) {
    const rows = shown.filter((c) => c.cup === cup.name);
    if (!rows.length) continue;
    html += `<section class="cup"><h2>${esc(cup.name)}${cup.dlc ? '<span class="dlc">追加</span>' : ""}</h2><div class="list">${rows.map((c) => {
      const todays = data.battles.filter((b) => b.courseId === c.id && b.date === t).sort((a, b) => a.createdAt - b.createdAt);
      return `<button class="row" data-id="${c.id}">
        <span class="name">${courseLabel(c.name)}${todays.length ? `<small>今日 ${ratingChips(todays)}</small>` : ""}</span>
        <span class="chev">＋</span></button>`;
    }).join("")}</div></section>`;
  }
  if (!shown.length) html = `<p class="empty">見つかりません</p>`;
  const $list = document.getElementById("battle-list");
  $list.innerHTML = html;
  $list.querySelectorAll(".row").forEach((r) => r.addEventListener("click", () => openSheet(r.dataset.id)));
}

// 最近の入力（新しい順に20件）。間違えたものはここで消せる
function renderBattleRecent() {
  const recent = data.battles.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  const $box = document.getElementById("battle-recent");
  if (!recent.length) { $box.innerHTML = ""; return; }
  const t = today();
  $box.innerHTML = `<div class="section-title">最近の入力（新しい順）</div><div class="list">${recent.map((b) => {
    const c = COURSE_BY_ID[b.courseId];
    return `<div class="row brec">
      <span class="name">${courseLabel(c.name)}<small>${b.date === t ? "今日" : fmtDate(b.date)}</small></span>
      ${ratingChips([b])}
      <button class="btn small del" data-id="${b.id}" aria-label="この評価を消す">消す</button></div>`;
  }).join("")}</div>`;
  $box.querySelectorAll(".del").forEach((btn) => btn.addEventListener("click", () => {
    const b = data.battles.find((x) => x.id === btn.dataset.id);
    if (!b || !confirm(`${COURSE_BY_ID[b.courseId].name} の「${RATING_BY_VALUE[b.rating][1]}」を消します。`)) return;
    data.battles = data.battles.filter((x) => x !== b);
    save();
    renderBattleList();
    renderBattleRecent();
  }));
}

function openSheet(courseId) {
  const c = COURSE_BY_ID[courseId];
  const $sheet = document.getElementById("sheet");
  $sheet.innerHTML = `<div class="cupname">${esc(c.cup)}</div>
    <div class="cname">${courseLabel(c.name)}</div>
    <div class="rate-btns">${RATINGS.map(([v, label, , cls]) => `<button class="rate rt-${cls}" data-v="${v}">${label}</button>`).join("")}</div>
    <button class="btn" id="sheet-cancel">やめる</button>`;
  $sheet.hidden = false;
  document.getElementById("sheet-bg").hidden = false;
  document.getElementById("sheet-cancel").addEventListener("click", closeSheet);
  $sheet.querySelectorAll(".rate").forEach((btn) => btn.addEventListener("click", () => {
    const rating = Number(btn.dataset.v);
    data.battles.push({ id: newId(), courseId, rating, date: today(), createdAt: Date.now() });
    if (!save()) return;
    const bs = battleScore(courseId);
    toast(`${c.name}：${RATING_BY_VALUE[rating][1]}` + (bs.score < 0 ? "（練習すべきコース）" : ""));
    closeSheet();
    // 検索して選んだときは、次のコースを探しやすいよう検索欄を空にする
    if (battleSearch) {
      battleSearch = "";
      const $s = document.getElementById("b-search");
      $s.value = "";
      $s.blur();
      window.scrollTo(0, 0);
    }
    renderBattleList();
    renderBattleRecent();
    // タブの件数を更新
    const n = weakCourses().length;
    document.querySelector('#battle-seg button[data-v="weak"]').textContent = `練習すべきコース${n ? `（${n}）` : ""}`;
  }));
}

function closeSheet() {
  document.getElementById("sheet").hidden = true;
  document.getElementById("sheet-bg").hidden = true;
}

/* ---------- 画面：コース詳細 ---------- */

function renderCourse(courseId) {
  const course = COURSE_BY_ID[courseId];
  if (!course) return go("#/");
  $title.textContent = course.name;
  $back.hidden = false;
  const cc = data.settings.cc;
  const recs = recordsOf(courseId, cc).sort(byDate);
  const best = bestOf(recs);
  const target = targetOf(courseId, cc);
  const gap = targetGap(best, target);
  const tLaps = targetLapsOf(courseId, cc);
  const imp = improvements(recs);

  let html = images[courseId]
    ? `<div class="course-img"><img src="${images[courseId]}" alt="${esc(course.name)}">
        <div class="img-btns"><button class="btn small" id="img-pick">画像を変更</button><button class="btn small" id="img-del">画像を外す</button></div></div>`
    : `<button class="img-empty" id="img-pick">＋ コースの画像を選ぶ</button>`;
  html += `<input type="file" id="img-file" accept="image/*" hidden>`;
  html += `<div class="toolbar">${ccSwitch()}</div>`;
  html += `<div class="pb-card"><div class="label">${cc}cc 自己ベスト</div>`;
  if (best) {
    html += `<div class="big">${fmt(best.timeMs)}</div>`;
    if (imp[best.id] != null) html += `<div class="up">前のベストから ${fmtDiff(imp[best.id])}</div>`;
    html += `<div class="sub">${fmtDate(best.date)}`;
    const combo = comboText(best);
    if (combo) html += `<br>${esc(combo)}`;
    html += `</div>`;
  } else {
    html += `<div class="big none">まだ記録がありません</div>`;
  }
  if (gap != null) html += `<div class="gap-big ${gap > 0 ? "" : "ok"}">${gapText(gap)}</div>`;
  const pbLapGap = best ? lapGapText(best.laps, tLaps) : "";
  if (pbLapGap) html += `<div class="sub lap-gap">ラップの目標との差：${pbLapGap}</div>`;
  html += `</div>`;

  html += `<div class="card target"><h2>${cc}cc 目標タイム</h2>
    <div class="target-edit">
      <input id="t-in" class="input" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="150000" value="${toDigits(target)}">
      <button class="btn small" id="t-save" disabled>決定</button>
      ${target != null ? '<button class="btn small" id="t-clear">消す</button>' : ""}
    </div>
    <p class="hint" id="t-hint">${targetHintText(target, tLaps)}</p>
    <details class="t-more" ${tLaps ? "open" : ""}><summary>詳細設定（目標ラップ・任意）</summary>
      <div class="laps" id="t-laps">${targetLapSlots(tLaps).map((l, i) => lapInput(l, i)).join("")}</div>
      <p class="hint" id="t-lap-hint">入れた周だけ目標になります。空欄のままでもかまいません</p>
      <button type="button" class="btn small" id="t-add-lap" style="margin-top:8px">＋ ラップ欄を増やす</button>
    </details></div>`;

  html += `<div class="card" id="course-battle"></div>`;

  if (recs.length >= 2) html += chartSvg(recs, target);

  html += `<div class="section-title">記録（新しい順）</div>`;
  if (recs.length) {
    html += `<div class="list">`;
    for (const r of recs.slice().reverse()) {
      const isBest = best && r.id === best.id;
      const meta = [fmtDate(r.date), comboText(r), r.memo].filter(Boolean).join("　");
      html += `<button class="row rec" data-id="${r.id}">
        <span class="name"><span class="time">${fmt(r.timeMs)}</span>${isBest ? '<span class="badge">PB</span>' : ""}${imp[r.id] != null ? `<span class="upd">更新 ${fmtDiff(imp[r.id])}</span>` : ""}
        <span class="meta">${esc(meta)}</span></span>
        <span class="chev">›</span></button>`;
    }
    html += `</div>`;
    html += `<button class="btn danger" id="reset-course">このコースの ${cc}cc の記録をリセット</button>`;
  } else {
    html += `<p class="empty">右下の ＋ から記録を追加できます</p>`;
  }
  html += `<button class="fab" id="add" aria-label="記録を追加">＋</button>`;
  $view.innerHTML = html;

  bindCcSwitch(() => renderCourse(courseId));
  renderCourseBattle(courseId);
  document.getElementById("add").addEventListener("click", () => go(`#/add/${courseId}`));
  $view.querySelectorAll(".rec").forEach((r) => r.addEventListener("click", () => go(`#/edit/${r.dataset.id}`)));

  // 画像
  const $file = document.getElementById("img-file");
  document.getElementById("img-pick").addEventListener("click", () => $file.click());
  $file.addEventListener("change", async () => {
    const f = $file.files[0];
    $file.value = "";
    if (!f) return;
    try {
      await setImage(courseId, await shrinkImage(f));
      renderCourse(courseId);
    } catch (e) {
      console.error(e);
      toast("画像を保存できませんでした");
    }
  });
  const $imgDel = document.getElementById("img-del");
  if ($imgDel) $imgDel.addEventListener("click", async () => {
    if (!confirm("このコースの画像を外します。")) return;
    await setImage(courseId, null);
    renderCourse(courseId);
  });

  // 目標タイム
  const $tIn = document.getElementById("t-in");
  const $tSave = document.getElementById("t-save");
  const $tHint = document.getElementById("t-hint");
  const $tLapHint = document.getElementById("t-lap-hint");
  // 目標ラップの欄の値。空欄＝undefined、読めない＝null。後ろの空欄は除いて返す
  const tLapValues = () => {
    const v = [...document.querySelectorAll("#t-laps input")].map((i) => (i.value.trim() ? parseDigits(i.value) : undefined));
    while (v.length && v[v.length - 1] === undefined) v.pop();
    return v;
  };
  const tCheck = () => {
    const ms = parseDigits($tIn.value);
    const lv = tLapValues();
    const lapBad = lv.some((x) => x === null);
    const newLaps = lv.length ? lv.map((x) => (x === undefined ? null : x)) : null;
    const lapsChanged = JSON.stringify(newLaps) !== JSON.stringify(tLaps);
    $tSave.disabled = ms == null || lapBad || (ms === target && !lapsChanged);
    if (!$tIn.value.trim()) $tHint.textContent = targetHintText(target, tLaps);
    else if (ms == null) $tHint.textContent = "読み取れません（分・秒2桁・1/1000秒3桁の順で数字を入力）";
    else $tHint.textContent = fmt(ms) + (best ? `　自己ベストとの差 ${fmtDiff(best.timeMs - ms)}` : "");
    tLapCheck(ms, lv);
  };
  // 目標ラップの下の説明（合計と、目標タイムとの差）
  const tLapCheck = (ms, lv) => {
    const lapBad = lv.some((x) => x === null);
    const filled = lv.filter((x) => typeof x === "number");
    if (lapBad) {
      $tLapHint.textContent = "読み取れないラップがあります";
      $tLapHint.className = "hint err";
    } else if (filled.length) {
      const sum = filled.reduce((a, b) => a + b, 0);
      $tLapHint.textContent = `ラップ合計 ${fmt(sum)}` + (ms != null && sum !== ms ? `（目標タイムとの差 ${fmtDiff(sum - ms)}）` : "")
        + (ms == null ? "　※ 決定するには上の目標タイムも入れてください" : "");
      $tLapHint.className = "hint";
    } else {
      $tLapHint.textContent = "入れた周だけ目標になります。空欄のままでもかまいません";
      $tLapHint.className = "hint";
    }
  };
  tLapCheck(target, tLapValues());
  $tIn.addEventListener("input", tCheck);
  document.getElementById("t-laps").addEventListener("input", tCheck);
  document.getElementById("t-add-lap").addEventListener("click", () => {
    const box = document.getElementById("t-laps");
    box.insertAdjacentHTML("beforeend", lapInput(null, box.children.length));
  });
  $tSave.addEventListener("click", () => {
    const ms = parseDigits($tIn.value);
    const lv = tLapValues();
    if (ms == null || lv.some((x) => x === null)) return;
    const key = `${courseId}|${cc}`;
    data.targets[key] = ms;
    // 目標ラップは入力があったときだけ持つ。全部空なら持たない
    if (lv.length) data.targetLaps[key] = lv.map((x) => (x === undefined ? null : x));
    else delete data.targetLaps[key];
    save();
    toast(`目標を ${fmt(ms)} にしました` + (lv.length ? "（ラップも）" : ""));
    renderCourse(courseId);
  });
  const $tClear = document.getElementById("t-clear");
  if ($tClear) $tClear.addEventListener("click", () => {
    delete data.targets[`${courseId}|${cc}`];
    delete data.targetLaps[`${courseId}|${cc}`];
    save();
    toast("目標を消しました");
    renderCourse(courseId);
  });

  // 1コースのリセット（表示中の排気量の記録だけ。目標と画像は残す）
  const $reset = document.getElementById("reset-course");
  if ($reset) $reset.addEventListener("click", () => {
    if (!confirm(`${course.name} の ${cc}cc の記録 ${recs.length}件をすべて消します。元に戻せません。`)) return;
    if (!confirm("本当に消しますか？（目標タイムと画像は残ります）")) return;
    data.records = data.records.filter((r) => !(r.courseId === courseId && r.cc === cc));
    save();
    toast(`${cc}cc の記録をリセットしました`);
    renderCourse(courseId);
  });
}

// コース画面の「対戦の評価」の枠。ここからも評価を付けられ、今日付けた分は消せる。
// 押すたびに画面全体ではなくこの枠だけ描き直す（目標タイムの入力中の値やスクロール位置を崩さないため）
function renderCourseBattle(courseId) {
  const $box = document.getElementById("course-battle");
  const bs = battleScore(courseId);
  const t = today();
  let html = `<h2>対戦の評価（排気量共通）</h2>`;
  if (bs) {
    const cnt = (v) => battlesOf(courseId).filter((b) => b.rating === v).length;
    html += `<p>直近${bs.recent.length}回 ${ratingChips(bs.recent)}　合計 <b class="score ${bs.score < 0 ? "bad" : ""}">${scoreText(bs.score)}</b>${bs.score < 0 ? "（練習すべきコース）" : ""}</p>
      <p>これまで ${bs.total}回：良い ${cnt(1)}・普通 ${cnt(0)}・悪い ${cnt(-1)}</p>`;
  } else {
    html += `<p>対戦でこのコースを走ったら、走りを3段階で評価できます。</p>`;
  }
  html += `<div class="rate-btns course-rate">${RATINGS.map(([v, label, , cls]) => `<button class="rate rt-${cls}" data-v="${v}">${label}</button>`).join("")}</div>`;
  const todays = battlesOf(courseId).filter((b) => b.date === t).reverse();
  if (todays.length) {
    html += `<div class="list today-rates">${todays.map((b) => `<div class="row brec">
      <span class="name"><small>今日 ${new Date(b.createdAt).toTimeString().slice(0, 5)}</small></span>
      ${ratingChips([b])}
      <button class="btn small del" data-id="${b.id}" aria-label="この評価を消す">消す</button></div>`).join("")}</div>`;
  }
  $box.innerHTML = html;
  const name = COURSE_BY_ID[courseId].name;
  $box.querySelectorAll(".rate").forEach((btn) => btn.addEventListener("click", () => {
    const rating = Number(btn.dataset.v);
    data.battles.push({ id: newId(), courseId, rating, date: today(), createdAt: Date.now() });
    if (!save()) return;
    const s = battleScore(courseId);
    toast(`${name}：${RATING_BY_VALUE[rating][1]}` + (s.score < 0 ? "（練習すべきコース）" : ""));
    renderCourseBattle(courseId);
  }));
  $box.querySelectorAll(".del").forEach((btn) => btn.addEventListener("click", () => {
    const b = data.battles.find((x) => x.id === btn.dataset.id);
    if (!b || !confirm(`${name} の「${RATING_BY_VALUE[b.rating][1]}」を消します。`)) return;
    data.battles = data.battles.filter((x) => x !== b);
    save();
    renderCourseBattle(courseId);
  }));
}

function comboText(r) {
  const c = r.combo || {};
  return COMBO_FIELDS.map(([k]) => c[k]).filter(Boolean).join(" / ");
}

// タイムの推移グラフ。灰色の点＝各記録、金色の線＝その時点までの自己ベスト
// 目標タイムがあれば緑の点線で引く
function chartSvg(recs, target) {
  const W = 340, H = 170, L = 52, R = 10, T = 10, B = 24;
  const times = recs.map((r) => r.timeMs);
  if (target != null) times.push(target);
  let lo = Math.min(...times), hi = Math.max(...times);
  if (hi - lo < 200) { const mid = (hi + lo) / 2; lo = mid - 100; hi = mid + 100; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = (i) => L + (recs.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (recs.length - 1));
  // 短いタイム（速い）ほど上に描く
  const yy = (t) => H - B - ((t - lo) * (H - T - B)) / (hi - lo);

  let grid = "";
  for (let k = 0; k <= 3; k++) {
    const t = lo + ((hi - lo) * k) / 3;
    const gy = yy(t);
    grid += `<line x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}" stroke="#333845" stroke-width="1"/>
      <text x="${L - 6}" y="${gy + 4}" fill="#9aa0ad" font-size="10" text-anchor="end">${fmtLap(Math.round(t))}</text>`;
  }

  let run = Infinity;
  const pbPts = recs.map((r, i) => { run = Math.min(run, r.timeMs); return `${x(i).toFixed(1)},${yy(run).toFixed(1)}`; });
  const dots = recs.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${yy(r.timeMs).toFixed(1)}" r="3.5" fill="#9aa0ad"/>`).join("");
  const first = fmtDate(recs[0].date), last = fmtDate(recs[recs.length - 1].date);

  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="タイムの推移">
    ${grid}
    ${target != null ? `<line x1="${L}" x2="${W - R}" y1="${yy(target).toFixed(1)}" y2="${yy(target).toFixed(1)}" stroke="#4cc38a" stroke-width="1.5" stroke-dasharray="5 4"/>` : ""}
    <polyline points="${pbPts.join(" ")}" fill="none" stroke="#f4c542" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}
    <text x="${L}" y="${H - 6}" fill="#9aa0ad" font-size="10">${first}</text>
    <text x="${W - R}" y="${H - 6}" fill="#9aa0ad" font-size="10" text-anchor="end">${last}</text>
  </svg><div class="legend"><span><i style="background:#9aa0ad"></i>各記録</span><span><i style="background:#f4c542"></i>自己ベストの推移</span>${target != null ? '<span><i style="background:#4cc38a"></i>目標</span>' : ""}</div></div>`;
}

/* ---------- 画面：記録の追加・修正 ---------- */

function renderForm(courseId, recordId) {
  const editing = recordId ? data.records.find((r) => r.id === recordId) : null;
  if (recordId && !editing) return go("#/");
  if (editing) courseId = editing.courseId;
  const course = COURSE_BY_ID[courseId];
  if (!course) return go("#/");

  $title.textContent = editing ? "記録を修正" : "記録を追加";
  $back.hidden = false;

  // 新規のときは、前回入れた組み合わせを最初から入れておく
  const last = data.records.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
  const src = editing || { cc: data.settings.cc, date: today(), combo: last ? last.combo : {}, laps: [], memo: "" };
  const laps = (src.laps || []).slice();
  while (laps.length < 3) laps.push(null);

  // 過去に入れた値を候補として出す
  const datalists = COMBO_FIELDS.map(([k]) => {
    const vals = [...new Set(data.records.map((r) => (r.combo || {})[k]).filter(Boolean))];
    return `<datalist id="dl-${k}">${vals.map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;
  }).join("");

  $view.innerHTML = `
    <div class="card" style="margin-top:4px"><h2>${courseLabel(course.name)}</h2><p>${esc(course.cup)}</p></div>
    <div class="field"><div class="label">排気量</div>
      <div class="seg" id="f-cc">
        <button type="button" data-cc="150" class="${src.cc === "150" ? "on" : ""}">150cc</button>
        <button type="button" data-cc="200" class="${src.cc === "200" ? "on" : ""}">200cc</button>
      </div></div>
    <div class="field"><label for="f-time">タイム（数字だけ入力）</label>
      <input id="f-time" class="input time-input" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="152345" value="${toDigits(src.timeMs)}">
      <p class="hint time-hint" id="time-hint">例：152345 と打つと 1:52.345</p></div>
    <div class="field"><div class="label">ラップ（任意・数字だけ。37123 → 37.123）</div>
      <div class="laps" id="laps">${laps.map((l, i) => lapInput(l, i)).join("")}</div>
      <p class="hint" id="lap-hint"></p>
      <button type="button" class="btn small" id="add-lap" style="margin-top:8px">＋ ラップ欄を増やす</button></div>
    <div class="field"><label for="f-date">日付</label>
      <input id="f-date" class="input" type="date" value="${esc(src.date)}"></div>
    <div class="field"><div class="label">組み合わせ（任意）</div>
      <div class="grid2">${COMBO_FIELDS.map(([k, label]) =>
        `<input class="input" id="f-${k}" list="dl-${k}" placeholder="${label}" autocomplete="off" value="${esc((src.combo || {})[k])}">`).join("")}</div>
      ${datalists}</div>
    <div class="field"><label for="f-memo">メモ（任意）</label>
      <textarea id="f-memo" class="input" rows="3">${esc(src.memo)}</textarea></div>
    <button class="btn primary" id="save" disabled>保存</button>
    ${editing ? '<button class="btn danger" id="del">この記録を削除</button>' : ""}
  `;

  let cc = src.cc;
  document.querySelectorAll("#f-cc button").forEach((b) =>
    b.addEventListener("click", () => {
      cc = b.dataset.cc;
      document.querySelectorAll("#f-cc button").forEach((x) => x.classList.toggle("on", x === b));
      check();
    })
  );

  const $time = document.getElementById("f-time");
  const $hint = document.getElementById("time-hint");
  const $save = document.getElementById("save");
  const $lapHint = document.getElementById("lap-hint");

  function lapValues() {
    return [...document.querySelectorAll("#laps input")].map((i) => (i.value.trim() ? parseDigits(i.value) : undefined));
  }

  function check() {
    const ms = parseDigits($time.value);
    if (!$time.value.trim()) {
      $hint.textContent = "例：152345 と打つと 1:52.345";
      $hint.className = "hint time-hint";
    } else if (ms == null) {
      $hint.textContent = "読み取れません（分・秒2桁・1/1000秒3桁の順で数字を入力）";
      $hint.className = "hint time-hint err";
    } else {
      // 同じコース・排気量の自己ベストとの差も見せる
      const others = recordsOf(courseId, cc).filter((r) => !editing || r.id !== editing.id);
      const b = bestOf(others);
      $hint.textContent = fmt(ms) + (b ? `　自己ベスト ${fmt(b.timeMs)} との差 ${fmtDiff(ms - b.timeMs)}` : "");
      $hint.className = "hint time-hint";
    }
    const lv = lapValues();
    const lapBad = lv.some((v) => v === null);
    const filled = lv.filter((v) => typeof v === "number");
    if (lapBad) {
      $lapHint.textContent = "読み取れないラップがあります";
      $lapHint.className = "hint err";
    } else if (filled.length) {
      const sum = filled.reduce((a, b) => a + b, 0);
      $lapHint.textContent = `ラップ合計 ${fmt(sum)}` + (ms != null && sum !== ms ? `（タイムとの差 ${fmtDiff(sum - ms)}）` : "");
      const lg = lapGapText(lv.map((v) => (typeof v === "number" ? v : null)), targetLapsOf(courseId, cc));
      if (lg) $lapHint.textContent += `　目標ラップとの差：${lg}`;
      $lapHint.className = "hint";
    } else {
      $lapHint.textContent = "";
    }
    $save.disabled = ms == null || lapBad;
  }

  $time.addEventListener("input", check);
  document.getElementById("laps").addEventListener("input", check);
  document.getElementById("add-lap").addEventListener("click", () => {
    const box = document.getElementById("laps");
    box.insertAdjacentHTML("beforeend", lapInput(null, box.children.length));
  });
  check();
  if (!editing) $time.focus();

  $save.addEventListener("click", () => {
    const ms = parseDigits($time.value);
    if (ms == null) return;
    const lv = lapValues();
    while (lv.length && lv[lv.length - 1] === undefined) lv.pop(); // 後ろの空欄は捨てる
    const rec = {
      id: editing ? editing.id : newId(),
      courseId,
      cc,
      timeMs: ms,
      date: document.getElementById("f-date").value || today(),
      laps: lv.map((v) => (typeof v === "number" ? v : null)),
      combo: Object.fromEntries(COMBO_FIELDS.map(([k]) => [k, document.getElementById(`f-${k}`).value.trim()]).filter(([, v]) => v)),
      memo: document.getElementById("f-memo").value.trim(),
      createdAt: editing ? editing.createdAt : Date.now(),
    };
    const prevBest = bestOf(recordsOf(courseId, cc).filter((r) => r.id !== rec.id));
    if (editing) data.records[data.records.indexOf(editing)] = rec;
    else data.records.push(rec);
    if (!save()) return;
    data.settings.cc = cc;
    save();
    const gap = targetGap({ timeMs: ms }, targetOf(courseId, cc));
    const gapNote = gap != null ? `（${gapText(gap)}）` : "";
    if (!prevBest) toast(`${cc}cc 初記録 ${fmt(ms)}${gapNote}`, true);
    else if (ms < prevBest.timeMs) toast(`自己ベスト更新！ 前回から ${fmtDiff(ms - prevBest.timeMs)}${gapNote}`, true);
    else toast("保存しました");
    history.back();
  });

  if (editing) {
    document.getElementById("del").addEventListener("click", () => {
      if (!confirm(`${fmt(editing.timeMs)}（${fmtDate(editing.date)}）を削除します。元に戻せません。`)) return;
      data.records = data.records.filter((r) => r.id !== editing.id);
      save();
      toast("削除しました");
      history.back();
    });
  }
}

// 目標タイムの下の説明。目標ラップがあれば並べて出す
function targetHintText(target, tLaps) {
  if (target == null) return "数字だけ入力（150000 → 1:50.000）";
  let t = `いまの目標：${fmt(target)}`;
  if (tLaps) t += `（ラップ ${tLaps.map((l) => (l == null ? "—" : fmtLap(l))).join(" / ")}）`;
  return t;
}

// 目標ラップの入力欄に入れる値。最低3欄
function targetLapSlots(tLaps) {
  const slots = (tLaps || []).slice();
  while (slots.length < 3) slots.push(null);
  return slots;
}

function lapInput(ms, i) {
  return `<input class="input" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="${i + 1}周" value="${ms == null ? "" : toDigits(ms)}">`;
}

/* ---------- 画面：設定・バックアップ ---------- */

function renderSettings() {
  $title.textContent = "設定とバックアップ";
  $back.hidden = false;
  const n = data.records.length;
  const lastExport = data.settings.lastExport;

  $view.innerHTML = `
    <div class="card"><h2>バックアップ</h2>
      <p>記録はこの iPhone の中だけにあります。機種変更や Safari のデータ消去に備えて、ときどき書き出してください。</p>
      <p>記録 ${n} 件 ／ 最後に書き出した日：${lastExport ? fmtDate(lastExport) : "まだありません"}</p>
      <button class="btn primary" id="export">記録を書き出す</button>
      <button class="btn" id="import">書き出したファイルを読み込む</button>
      <input type="file" id="import-file" accept=".json,application/json" hidden>
      <p class="hint">目標タイム（目標ラップを含む）・コース画像・対戦の評価も一緒に書き出します。読み込みは「足し合わせ」です。今ある記録は消えず、同じ記録は二重になりません（目標・画像は、まだ無いコースにだけ入ります）。</p>
    </div>
    <div class="card"><h2>保存の状態</h2><p id="persist">確認中…</p></div>
    <div class="card"><h2>全コースの記録をリセット</h2>
      <p>150cc・200cc の記録 ${n} 件をすべて消します。目標タイム・コース画像・対戦の評価は残ります。先に書き出しておくと、読み込みで元に戻せます。</p>
      <button class="btn danger" id="reset-all" ${n ? "" : "disabled"}>全コースの記録をリセット</button>
    </div>
    <div class="card"><h2>このアプリについて</h2>
      <p>マリオカート8 デラックスのタイムアタック記録用（個人利用）。全96コース・150cc／200cc。</p>
    </div>`;

  document.getElementById("export").addEventListener("click", exportData);
  document.getElementById("reset-all").addEventListener("click", () => {
    if (!confirm(`全コースの記録 ${n} 件をすべて消します。元に戻せません。`)) return;
    if (!confirm(`本当に消しますか？${lastExport ? `（最後に書き出したのは ${fmtDate(lastExport)}）` : "（まだ一度も書き出していません）"}`)) return;
    data.records = [];
    save();
    toast("全コースの記録をリセットしました");
    renderSettings();
  });
  const $file = document.getElementById("import-file");
  document.getElementById("import").addEventListener("click", () => $file.click());
  $file.addEventListener("change", () => {
    if ($file.files[0]) importData($file.files[0]);
    $file.value = "";
  });

  const $p = document.getElementById("persist");
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((ok) => {
      $p.textContent = ok
        ? "消されにくい保存になっています。"
        : "通常の保存です。ホーム画面に追加したアプリから使うと消えにくくなります。念のためバックアップも取ってください。";
    });
  } else {
    $p.textContent = "このブラウザでは確認できません。バックアップを取ってください。";
  }
}

async function exportData() {
  const payload = JSON.stringify({
    app: "mk8ta", version: 1, exportedAt: new Date().toISOString(),
    records: data.records, targets: data.targets, targetLaps: data.targetLaps, battles: data.battles, pickExclude: data.pickExclude, images,
  }, null, 1);
  const name = `マリカTA記録_${today()}.json`;
  const file = new File([payload], name, { type: "application/json" });
  try {
    // iPhone では共有シートが開き、「"ファイル"に保存」や AirDrop で逃がせる
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    data.settings.lastExport = today();
    save();
    renderSettings();
  } catch (e) {
    if (e.name !== "AbortError") toast("書き出しに失敗しました");
  }
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let incoming, d;
    try {
      d = JSON.parse(reader.result);
      incoming = d.records;
      if (!Array.isArray(incoming)) throw new Error("records がない");
    } catch (e) {
      toast("このファイルは読み込めません");
      return;
    }
    const have = new Set(data.records.map((r) => r.id));
    let added = 0, skipped = 0;
    for (const r of incoming) {
      const ok = r && typeof r.id === "string" && COURSE_BY_ID[r.courseId] && (r.cc === "150" || r.cc === "200")
        && Number.isInteger(r.timeMs) && r.timeMs > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date);
      if (!ok) { skipped++; continue; }
      if (have.has(r.id)) continue;
      data.records.push({
        id: r.id, courseId: r.courseId, cc: r.cc, timeMs: r.timeMs, date: r.date,
        laps: Array.isArray(r.laps) ? r.laps.map((v) => (Number.isInteger(v) ? v : null)) : [],
        combo: r.combo && typeof r.combo === "object" ? r.combo : {},
        memo: typeof r.memo === "string" ? r.memo : "",
        createdAt: Number(r.createdAt) || Date.now(),
      });
      have.add(r.id);
      added++;
    }
    // 対戦の評価も同じ id のものは追加しない
    let bAdded = 0;
    if (Array.isArray(d.battles)) {
      const haveB = new Set(data.battles.map((b) => b.id));
      for (const b of d.battles) {
        const ok = b && typeof b.id === "string" && COURSE_BY_ID[b.courseId] && RATING_BY_VALUE[b.rating]
          && /^\d{4}-\d{2}-\d{2}$/.test(b.date);
        if (!ok) { skipped++; continue; }
        if (haveB.has(b.id)) continue;
        data.battles.push({ id: b.id, courseId: b.courseId, rating: b.rating, date: b.date, createdAt: Number(b.createdAt) || Date.now() });
        haveB.add(b.id);
        bAdded++;
      }
    }
    // おまかせの除外は、ファイルにあって今は除外していないコースを足す（今の除外は外さない）
    if (Array.isArray(d.pickExclude)) {
      for (const cid of d.pickExclude) if (COURSE_BY_ID[cid] && !isExcluded(cid)) data.pickExclude.push(cid);
    }
    // 目標と画像は、まだ無いコースにだけ入れる（今あるものは上書きしない）
    let tAdded = 0, iAdded = 0;
    if (d.targets && typeof d.targets === "object") {
      for (const [k, v] of Object.entries(d.targets)) {
        const [cid, tcc] = k.split("|");
        if (!COURSE_BY_ID[cid] || (tcc !== "150" && tcc !== "200") || !Number.isInteger(v) || v <= 0) continue;
        if (data.targets[k] == null) { data.targets[k] = v; tAdded++; }
      }
    }
    // 目標ラップも、まだ無いものだけ入れる（ファイルと今の目標タイムが同じものに限る。別の目標にラップだけ付くのを防ぐ）
    if (d.targetLaps && typeof d.targetLaps === "object" && d.targets && typeof d.targets === "object") {
      for (const [k, v] of Object.entries(d.targetLaps)) {
        if (data.targets[k] == null || data.targets[k] !== d.targets[k] || data.targetLaps[k] != null) continue;
        if (!Array.isArray(v) || !v.length || !v.some((x) => Number.isInteger(x) && x > 0)) continue;
        data.targetLaps[k] = v.map((x) => (Number.isInteger(x) && x > 0 ? x : null));
      }
    }
    save();
    if (d.images && typeof d.images === "object") {
      for (const [cid, url] of Object.entries(d.images)) {
        if (!COURSE_BY_ID[cid] || images[cid] || typeof url !== "string" || !url.startsWith("data:image/")) continue;
        try { await setImage(cid, url); iAdded++; } catch (e) { console.error(e); }
      }
    }
    toast(`${added}件を読み込みました` + (bAdded ? `（対戦の評価${bAdded}件）` : "") + (tAdded || iAdded ? `（目標${tAdded}・画像${iAdded}）` : "") + (skipped ? `（読めない記録 ${skipped}件は飛ばしました）` : ""));
    renderSettings();
  };
  reader.readAsText(file);
}

/* ---------- 画面の切り替え ---------- */

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  window.scrollTo(0, 0);
  switch (parts[0]) {
    case "course": return renderCourse(parts[1]);
    case "add": return renderForm(parts[1], null);
    case "edit": return renderForm(null, parts[1]);
    case "settings": return renderSettings();
    case "pick": return renderPick();
    case "exclude": return renderExclude();
    case "battle": return renderBattle();
    default: return renderHome();
  }
}

$back.addEventListener("click", () => history.back());
document.getElementById("settings-btn").addEventListener("click", () => go("#/settings"));
window.addEventListener("hashchange", route);
route();
// 画像は読み込みに少し時間がかかるので、読み終えたら今の画面を描き直す（記録の入力中は邪魔しない）
loadImages()
  .then(() => { if (Object.keys(images).length && !/^#\/(add|edit)/.test(location.hash)) route(); })
  .catch((e) => console.error(e));

// 消されにくい保存をお願いする（iPhone ではホーム画面から開いたときに効く）
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// 電波がなくても開けるようにする仕組み（サービスワーカー）を登録
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.error(e));
}
