// ── SCAMPER 定义 ──────────────────────────────────────────
const SCAMPER = [
  { letter: "S", name: "Substitute 替换", desc: "什么可以被替换？" },
  { letter: "C", name: "Combine 组合",    desc: "可以合并什么？" },
  { letter: "A", name: "Adapt 适配",      desc: "可以借鉴什么？" },
  { letter: "M", name: "Modify 修改",     desc: "可以放大/缩小/改变什么？" },
  { letter: "P", name: "Put to Other Use 另作他用", desc: "可以用在别处？" },
  { letter: "E", name: "Eliminate 删减",  desc: "可以去掉什么？" },
  { letter: "R", name: "Rearrange 重排",  desc: "可以换顺序/翻转？" },
];

// ── 状态 ──────────────────────────────────────────────────
let state = {
  topic: "",
  questions: [],   // [{letter, name, desc, type:"open"|"choice", text, choices?:[]}]
  answers: {},     // { index: { answer, skipped } }
  currentIndex: 0,
  hintCache: {},   // { index: hintText }
  phase: "input",  // input | loading-q | questions | loading-summary | summary
  ideas: [],
};

const STORAGE_KEY = "scamper_state";

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  flashSave();
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch { /* corrupt, ignore */ }
}

function flashSave() {
  const el = document.getElementById("save-indicator");
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1500);
}

// ── Mock 数据 ─────────────────────────────────────────────
const MOCK_QUESTIONS = [
  { letter:"S", name:"Substitute 替换", desc:"什么可以被替换？", type:"choice", text:"水杯的材质可以被什么替换，同时保持保温性能？", choices:["可降解植物纤维","相变材料外壳","气凝胶隔热层","纳米陶瓷涂层"] },
  { letter:"C", name:"Combine 组合",    desc:"可以合并什么？", type:"open",   text:"水杯还能和哪些日常物品合并，创造新的使用场景？" },
  { letter:"A", name:"Adapt 适配",      desc:"可以借鉴什么？", type:"choice", text:"哪个领域的设计可以借鉴到学生水杯上？", choices:["航天员饮水装置","咖啡馆外带杯","运动员补水背包","医院输液瓶"] },
  { letter:"M", name:"Modify 修改",     desc:"可以放大/缩小/改变什么？", type:"open", text:"水杯的哪些参数（大小、重量、口径）可以夸张化改动以解决某个痛点？" },
  { letter:"P", name:"Put to Other Use 另作他用", desc:"可以用在别处？", type:"choice", text:"这款水杯除了喝水，还能用在哪些场景？", choices:["课堂计时沙漏","笔筒/收纳","小型加湿器","应急照明灯"] },
  { letter:"E", name:"Eliminate 删减",  desc:"可以去掉什么？", type:"open",   text:"水杯上哪些结构或功能是多余的，去掉之后反而更好用？" },
  { letter:"R", name:"Rearrange 重排",  desc:"可以换顺序/翻转？", type:"choice", text:"如果把水杯的结构上下翻转或重新组合，可以解决什么问题？", choices:["防漏：吸管从底部进水","保温：隔热层移到最外侧","清洁：杯底可拆卸刷洗","携带：把手改到杯盖"] },
];

const MOCK_IDEAS = [
  { title:"智能保温随行杯", description:"结合相变材料外壳与航天饮水装置的密封结构，去掉传统杯盖锁扣，改用磁吸密封。底部可拆卸方便清洗，侧面集成简单计时提醒功能，帮助学生养成规律补水习惯。" },
  { title:"模块化多功能学习杯", description:"以气凝胶隔热层保温，杯身模块化设计：上半部分是水杯，下半部分可替换为笔筒或小收纳盒。课桌场景两用，减少学生桌面杂物，同时降低水杯遗忘率。" },
  { title:"极简轻量减压杯", description:"采用纳米陶瓷涂层替代传统不锈钢内胆，大幅降低重量。去掉多余的刻度线和装饰，口径放大方便加冰，吸管从侧壁斜插设计防止倾倒漏水，专为书包夹层携带优化。" },
];

async function mockDelay(data) {
  await new Promise(r => setTimeout(r, 1200));
  return data;
}

// ── API 调用 ──────────────────────────────────────────────
async function callLLM(messages) {
  const res = await fetch(`${CONFIG.apiBase}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages,
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ── Prompt：生成 SCAMPER 问题 ─────────────────────────────
async function generateQuestions(topic) {
  if (CONFIG.mock) return mockDelay(MOCK_QUESTIONS);
  const prompt = `你是一位创意思维引导师。用户的创新题目是："${topic}"。

请针对 SCAMPER 七个维度，每个维度生成 1 道启发性问题。
格式要求（严格按 JSON 返回，不要加任何其他文字）：
[
  {
    "letter": "S",
    "type": "open",
    "text": "问题内容"
  },
  {
    "letter": "C",
    "type": "choice",
    "text": "问题内容",
    "choices": ["选项A", "选项B", "选项C", "选项D"]
  },
  ...
]

要求：
- 7 道题，顺序 S C A M P E R
- 至少 3 道选择题（type="choice"，含 4 个选项），其余为开放题（type="open"）
- 问题要具体针对题目"${topic}"，有启发性
- 中文回答`;

  const raw = await callLLM([{ role: "user", content: prompt }]);
  const json = raw.match(/\[[\s\S]*\]/)?.[0];
  if (!json) throw new Error("解析问题失败");
  const questions = JSON.parse(json);
  // 补全 name/desc
  return questions.map(q => {
    const meta = SCAMPER.find(s => s.letter === q.letter) || {};
    return { ...meta, ...q };
  });
}

// ── Prompt：生成提示 ──────────────────────────────────────
async function generateHint(topic, question) {
  if (CONFIG.mock) return mockDelay("提示：试着从用户的使用痛点出发，想象一个具体场景——比如学生上课时最常遇到什么不便？从这个角度切入会更有说服力。");
  const prompt = `题目："${topic}"
问题（${question.letter} - ${question.name}）：${question.text}

请给出 2-3 句简短的答题提示，帮助用户从"${question.name}"角度展开思考。不要直接给出答案，而是提供思路方向。中文。`;
  return callLLM([{ role: "user", content: prompt }]);
}

// ── Prompt：汇总创意方案 ──────────────────────────────────
async function generateSummary(topic, questions, answers) {
  if (CONFIG.mock) return mockDelay(MOCK_IDEAS);
  const qa = questions.map((q, i) => {
    const a = answers[i];
    if (!a || a.skipped) return `${q.letter}（${q.name}）：[跳过]`;
    return `${q.letter}（${q.name}）：${a.answer}`;
  }).join("\n");

  const prompt = `用户正在用 SCAMPER 方法对题目"${topic}"进行创意发散。
以下是用户的回答：

${qa}

请基于以上内容，综合提炼出 3 套不同方向的创意备选方案。
格式（严格按 JSON 返回，不加其他文字）：
[
  { "title": "方案名称", "description": "100字左右的方案描述" },
  { "title": "方案名称", "description": "..." },
  { "title": "方案名称", "description": "..." }
]
中文，方案之间要有明显差异。`;

  const raw = await callLLM([{ role: "user", content: prompt }]);
  const json = raw.match(/\[[\s\S]*\]/)?.[0];
  if (!json) throw new Error("解析方案失败");
  return JSON.parse(json);
}

// ── 渲染工具函数 ──────────────────────────────────────────
function show(screenId) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

function renderNavDots() {
  const wrap = document.getElementById("nav-dots");
  wrap.innerHTML = state.questions.map((q, i) => {
    const a = state.answers[i];
    let cls = "nav-dot";
    if (a?.skipped) cls += " skipped";
    else if (a?.answer) cls += " done";
    if (i === state.currentIndex) cls += " current";
    return `<div class="${cls}" onclick="jumpTo(${i})" title="${q.name}">${q.letter}</div>`;
  }).join("");
}

function renderProgress() {
  const total = state.questions.length;
  const done = Object.values(state.answers).filter(a => a).length;
  document.getElementById("progress-fill").style.width = `${(done / total) * 100}%`;
  document.getElementById("progress-label").textContent = `${done} / ${total}`;
}

// ── 渲染当前问题 ──────────────────────────────────────────
function renderQuestion(index) {
  state.currentIndex = index;
  const q = state.questions[index];
  const a = state.answers[index];

  document.getElementById("q-letter").textContent = q.letter;
  document.getElementById("q-name").textContent = q.name;
  document.getElementById("q-desc").textContent = q.desc || "";
  document.getElementById("q-text").textContent = q.text;

  // 选择题 vs 开放题
  const choicesWrap = document.getElementById("choices-wrap");
  const openWrap = document.getElementById("open-wrap");

  if (q.type === "choice" && q.choices?.length) {
    choicesWrap.style.display = "flex";
    openWrap.style.display = "none";
    choicesWrap.innerHTML = q.choices.map((c, ci) =>
      `<button class="choice-btn${a?.answer === c ? " selected" : ""}" onclick="selectChoice(${ci})">${c}</button>`
    ).join("");
  } else {
    choicesWrap.style.display = "none";
    openWrap.style.display = "block";
    document.getElementById("answer-area").value = a?.answer || "";
  }

  // 提示
  const hintBox = document.getElementById("hint-box");
  const cachedHint = state.hintCache[index];
  hintBox.textContent = cachedHint || "";
  hintBox.classList.toggle("visible", !!cachedHint);
  document.getElementById("hint-btn").disabled = false;
  document.getElementById("hint-btn").textContent = "💡 获取提示";

  renderNavDots();
  renderProgress();
}

// ── 事件处理 ──────────────────────────────────────────────
function selectChoice(ci) {
  const q = state.questions[state.currentIndex];
  const chosen = q.choices[ci];
  state.answers[state.currentIndex] = { answer: chosen, skipped: false };
  save();
  renderQuestion(state.currentIndex);
}

function jumpTo(index) {
  // 先保存当前开放题答案
  saveCurrentOpenAnswer();
  state.currentIndex = index;
  renderQuestion(index);
}

function saveCurrentOpenAnswer() {
  const q = state.questions[state.currentIndex];
  if (!q || q.type === "choice") return;
  const val = document.getElementById("answer-area").value.trim();
  if (val) {
    state.answers[state.currentIndex] = { answer: val, skipped: false };
    save();
  }
}

async function getHint() {
  const index = state.currentIndex;
  if (state.hintCache[index]) {
    document.getElementById("hint-box").classList.add("visible");
    return;
  }
  const btn = document.getElementById("hint-btn");
  btn.disabled = true;
  btn.textContent = "获取中…";
  try {
    const hint = await generateHint(state.topic, state.questions[index]);
    state.hintCache[index] = hint;
    save();
    const hintBox = document.getElementById("hint-box");
    hintBox.textContent = hint;
    hintBox.classList.add("visible");
  } catch (e) {
    alert("获取提示失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "💡 获取提示";
  }
}

function nextQuestion() {
  saveCurrentOpenAnswer();
  const next = state.currentIndex + 1;
  if (next < state.questions.length) {
    renderQuestion(next);
  } else {
    startSummary();
  }
}

function skipQuestion() {
  state.answers[state.currentIndex] = { skipped: true };
  save();
  nextQuestion();
}

async function startSummary() {
  state.phase = "loading-summary";
  show("screen-loading");
  document.getElementById("loading-msg").textContent = "AI 正在综合你的想法，生成创意方案…";
  try {
    state.ideas = await generateSummary(state.topic, state.questions, state.answers);
    state.phase = "summary";
    save();
    renderSummary();
  } catch (e) {
    alert("生成方案失败：" + e.message);
    show("screen-questions");
  }
}

function renderSummary() {
  document.getElementById("summary-topic").textContent = `题目：${state.topic}`;
  const container = document.getElementById("ideas-container");
  container.innerHTML = state.ideas.map((idea, i) =>
    `<div class="idea-card">
      <h3>${i + 1}. ${idea.title}</h3>
      <p>${idea.description}</p>
    </div>`
  ).join("");
  show("screen-summary");
}

function restart() {
  if (!confirm("确定重新开始？当前进度将被清除。")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = { topic: "", questions: [], answers: {}, currentIndex: 0, hintCache: {}, phase: "input", ideas: [] };
  document.getElementById("topic-input").value = "";
  show("screen-input");
}

// ── 入口：开始生成问题 ────────────────────────────────────
async function startSession() {
  const topic = document.getElementById("topic-input").value.trim();
  if (!topic) { alert("请先输入你的创新题目"); return; }

  state.topic = topic;
  state.phase = "loading-q";
  state.questions = [];
  state.answers = {};
  state.hintCache = {};
  state.currentIndex = 0;
  save();

  show("screen-loading");
  document.getElementById("loading-msg").textContent = "AI 正在为你生成 SCAMPER 问题…";

  try {
    state.questions = await generateQuestions(topic);
    state.phase = "questions";
    save();
    show("screen-questions");
    renderQuestion(0);
  } catch (e) {
    alert("生成问题失败：" + e.message);
    show("screen-input");
  }
}

// ── 初始化 ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadSaved();

  // 恢复上次进度
  if (state.phase === "questions" && state.questions.length) {
    show("screen-questions");
    renderQuestion(state.currentIndex);
  } else if (state.phase === "summary" && state.ideas.length) {
    renderSummary();
  } else {
    show("screen-input");
    if (state.topic) document.getElementById("topic-input").value = state.topic;
  }
});
