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
        d.settings = Object.assign({ cc: "150", scope: "all", sort: "cup" }, d.settings);
        if (!d.targets || typeof d.targets !== "object") d.targets = {};
        return d;
      }
    }
  } catch (e) {
    console.error(e);
  }
  return { version: 1, records: [], targets: {}, settings: { cc: "150", scope: "all", sort: "cup" } };
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
  html += `</div>`;

  html += `<div class="card target"><h2>${cc}cc 目標タイム</h2>
    <div class="target-edit">
      <input id="t-in" class="input" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="150000" value="${toDigits(target)}">
      <button class="btn small" id="t-save" disabled>決定</button>
      ${target != null ? '<button class="btn small" id="t-clear">消す</button>' : ""}
    </div>
    <p class="hint" id="t-hint">${target != null ? `いまの目標：${fmt(target)}` : "数字だけ入力（150000 → 1:50.000）"}</p></div>`;

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
  $tIn.addEventListener("input", () => {
    const ms = parseDigits($tIn.value);
    $tSave.disabled = ms == null || ms === target;
    if (!$tIn.value.trim()) $tHint.textContent = target != null ? `いまの目標：${fmt(target)}` : "数字だけ入力（150000 → 1:50.000）";
    else if (ms == null) $tHint.textContent = "読み取れません（分・秒2桁・1/1000秒3桁の順で数字を入力）";
    else $tHint.textContent = fmt(ms) + (best ? `　自己ベストとの差 ${fmtDiff(best.timeMs - ms)}` : "");
  });
  $tSave.addEventListener("click", () => {
    const ms = parseDigits($tIn.value);
    if (ms == null) return;
    data.targets[`${courseId}|${cc}`] = ms;
    save();
    toast(`目標を ${fmt(ms)} にしました`);
    renderCourse(courseId);
  });
  const $tClear = document.getElementById("t-clear");
  if ($tClear) $tClear.addEventListener("click", () => {
    delete data.targets[`${courseId}|${cc}`];
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
      <p class="hint">目標タイムとコース画像も一緒に書き出します。読み込みは「足し合わせ」です。今ある記録は消えず、同じ記録は二重になりません（目標・画像は、まだ無いコースにだけ入ります）。</p>
    </div>
    <div class="card"><h2>保存の状態</h2><p id="persist">確認中…</p></div>
    <div class="card"><h2>全コースの記録をリセット</h2>
      <p>150cc・200cc の記録 ${n} 件をすべて消します。目標タイムとコース画像は残ります。先に書き出しておくと、読み込みで元に戻せます。</p>
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
    records: data.records, targets: data.targets, images,
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
    // 目標と画像は、まだ無いコースにだけ入れる（今あるものは上書きしない）
    let tAdded = 0, iAdded = 0;
    if (d.targets && typeof d.targets === "object") {
      for (const [k, v] of Object.entries(d.targets)) {
        const [cid, tcc] = k.split("|");
        if (!COURSE_BY_ID[cid] || (tcc !== "150" && tcc !== "200") || !Number.isInteger(v) || v <= 0) continue;
        if (data.targets[k] == null) { data.targets[k] = v; tAdded++; }
      }
    }
    save();
    if (d.images && typeof d.images === "object") {
      for (const [cid, url] of Object.entries(d.images)) {
        if (!COURSE_BY_ID[cid] || images[cid] || typeof url !== "string" || !url.startsWith("data:image/")) continue;
        try { await setImage(cid, url); iAdded++; } catch (e) { console.error(e); }
      }
    }
    toast(`${added}件を読み込みました` + (tAdded || iAdded ? `（目標${tAdded}・画像${iAdded}）` : "") + (skipped ? `（読めない記録 ${skipped}件は飛ばしました）` : ""));
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
