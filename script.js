/* =========================================================================
   CONFIGURAÇÃO DO FIREBASE
   Troque os valores abaixo pelos dados do SEU projeto Firebase.
   Veja o README.md para o passo a passo completo.
   ========================================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyCiyrnmMGL_ZG7Gn1sij5lwMvyV1BT3Tu8",
  authDomain: "chamados-esim.firebaseapp.com",
  projectId: "chamados-esim",
  storageBucket: "chamados-esim.firebasestorage.app",
  messagingSenderId: "254861458351",
  appId: "1:254861458351:web:a662d5606f785ddefbcd5a"
};

/* Quem recebe os chamados para resolver. Os chamados aparecem destacados
   como "para você" na tela dessa pessoa, e com uma etiqueta pra todo mundo. */
const RESPONSAVEL_EMAIL = "agnes.angelim@igreenenergy.com.br";
const RESPONSAVEL_NOME = "Agnes";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, setDoc, getDoc, updateDoc,
  onSnapshot, query, orderBy, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* A sessão fica só na aba atual — fechou a aba ou o navegador, precisa logar de novo.
   Isso evita que logar em outra conta em outra aba derrube a sessão da atual. */
setPersistence(auth, browserSessionPersistence);

/* ---------------- Helpers ---------------- */
const $ = (id) => document.getElementById(id);
const STATUS_LABEL = { aberto: "Em aberto", analise: "Em análise", feito: "Feito" };
const STATUS_ORDER = ["aberto", "analise", "feito"];

function fmtData(ts){
  if(!ts) return "agora";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function initials(name){
  if(!name) return "?";
  return name.trim().split(/\s+/).slice(0,2).map(w=>w[0].toUpperCase()).join("");
}
function beep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 740;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.35);
    o.start(); o.stop(ctx.currentTime+0.36);
  }catch(e){}
}
function toast(title, body, kind="aberto"){
  const el = document.createElement("div");
  el.className = "toast";
  el.style.borderLeftColor = kind==="aberto" ? "var(--aberto)" : kind==="analise" ? "var(--analise)" : "var(--feito)";
  el.innerHTML = `<b>${title}</b>${body}`;
  $("toastStack").appendChild(el);
  setTimeout(()=>el.remove(), 6000);
}

/* ---------------- Estado ---------------- */
let currentUser = null;
let currentUserProfile = null;
let activeFilter = "todos";
let allTickets = [];
let unreadCount = 0;
let uploadedEvidence = null; // {url, tipo}
let commentCounts = {}; // { ticketId: quantidade de comentários na última renderização }
let unsubscribeTickets = null;

/* ---------------- LOGIN ---------------- */
$("loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("loginError").textContent = "";
  const email = $("loginEmail").value.trim();
  const senha = $("loginSenha").value;
  $("loginSubmit").disabled = true;
  try{
    await signInWithEmailAndPassword(auth, email, senha);
  }catch(err){
    $("loginError").textContent = traduzErro(err.code);
  }
  $("loginSubmit").disabled = false;
});

function traduzErro(code){
  const map = {
    "auth/invalid-email":"E-mail inválido.",
    "auth/user-not-found":"Usuário não encontrado.",
    "auth/wrong-password":"Senha incorreta.",
    "auth/invalid-credential":"E-mail ou senha incorretos.",
    "auth/email-already-in-use":"Este e-mail já está cadastrado.",
    "auth/weak-password":"A senha precisa ter ao menos 6 caracteres.",
    "auth/configuration-not-found":"Configuração do Firebase inválida — confira o firebaseConfig no script.js.",
    "auth/invalid-api-key":"Chave de API do Firebase inválida — confira o firebaseConfig no script.js.",
    "auth/operation-not-allowed":"Login por e-mail/senha não está ativado no Firebase (Authentication → Sign-in method).",
    "auth/unauthorized-domain":"Este domínio não está autorizado no Firebase (Authentication → Settings → Authorized domains).",
    "auth/network-request-failed":"Falha de conexão. Verifique a internet e tente novamente."
  };
  return map[code] || `Não foi possível concluir. (${code||"erro desconhecido"})`;
}

$("btnLogout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if(user){
    currentUser = user;
    let snap = await getDoc(doc(db,"usuarios",user.uid));
    if(!snap.exists()){
      await setDoc(doc(db,"usuarios",user.uid), { nome: user.email, email: user.email, criadoEm: serverTimestamp() });
      snap = await getDoc(doc(db,"usuarios",user.uid));
    }
    currentUserProfile = snap.data();
    $("userLabel").textContent = currentUserProfile.nome;
    $("userAv").textContent = initials(currentUserProfile.nome);
    $("loginScreen").classList.add("hidden");
    $("mainScreen").classList.remove("hidden");
    startTicketsListener();
  } else {
    currentUser = null;
    currentUserProfile = null;
    if(unsubscribeTickets){ unsubscribeTickets(); unsubscribeTickets = null; }
    $("mainScreen").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
  }
});

/* ---------------- TABS ---------------- */
document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    $("tabNovo").classList.toggle("hidden", target!=="novo");
    $("tabChamados").classList.toggle("hidden", target!=="chamados");
    if(target === "chamados"){
      unreadCount = 0;
      updateBadges();
    }
  });
});

/* ---------------- PAINEL DE NOTIFICAÇÕES (sininho) ---------------- */
$("btnNotify").onclick = async () => {
  if("Notification" in window && Notification.permission === "default"){
    Notification.requestPermission();
  }
  $("notifPanel").classList.toggle("hidden");
  if(!$("notifPanel").classList.contains("hidden")){
    renderNotifPanel();
    unreadCount = 0;
    updateBadges();
  }
};
document.addEventListener("click", (e)=>{
  if(!$("notifPanel").contains(e.target) && e.target !== $("btnNotify") && !$("btnNotify").contains(e.target)){
    $("notifPanel").classList.add("hidden");
  }
});

function renderNotifPanel(){
  const abertos = allTickets.filter(t=>t.status === "aberto");
  const el = $("notifList");
  if(abertos.length === 0){
    el.innerHTML = `<div class="notif-empty">Nenhum chamado em aberto no momento.</div>`;
    return;
  }
  el.innerHTML = abertos.map(t=>`
    <div class="notif-item" data-notif-id="${t.id}">
      <div class="notif-name">${t.nomeLicenciado}</div>
      <div class="notif-meta">Aberto por ${t.criadoPor?.nome||"—"} · ${fmtData(t.criadoEm)}</div>
    </div>
  `).join("");
  document.querySelectorAll("[data-notif-id]").forEach(item=>{
    item.onclick = () => {
      $("notifPanel").classList.add("hidden");
      document.querySelector('.tab[data-tab="chamados"]').click();
      document.querySelector('.filter-chip[data-status="aberto"]').click();
    };
  });
}

/* ---------------- RESPONSÁVEL PELOS CHAMADOS ---------------- */
function souGestor(){
  return currentUser && currentUser.email === RESPONSAVEL_EMAIL;
}

function updateBadges(){
  const nb = $("notifBadge"), tb = $("tabBadge");
  if(unreadCount > 0){
    nb.textContent = unreadCount > 9 ? "9+" : unreadCount;
    nb.classList.remove("hidden");
    tb.textContent = unreadCount > 9 ? "9+" : unreadCount;
    tb.classList.remove("hidden");
  } else {
    nb.classList.add("hidden");
    tb.classList.add("hidden");
  }
}

/* ---------------- FOTO DE EVIDÊNCIA (comprimida e guardada direto no Firestore) ---------------- */
const EVIDENCIA_LIMITE_BYTES = 700000; // ~700KB de base64, com folga dentro do limite de 1MB do documento

function comprimirImagem(file, maxDim, qualidade){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if(width > height && width > maxDim){ height = Math.round(height*(maxDim/width)); width = maxDim; }
      else if(height > maxDim){ width = Math.round(width*(maxDim/height)); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", qualidade));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function prepararEvidencia(file){
  // tenta níveis decrescentes de qualidade/tamanho até caber no limite
  const tentativas = [ [1280,0.7], [1024,0.6], [800,0.5], [640,0.4], [480,0.35] ];
  for(const [maxDim, qualidade] of tentativas){
    const dataUrl = await comprimirImagem(file, maxDim, qualidade);
    if(dataUrl.length <= EVIDENCIA_LIMITE_BYTES) return dataUrl;
  }
  return null; // não coube em nenhuma tentativa
}

$("fileDrop").onclick = () => $("fFile").click();
$("fFile").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  $("fileDrop").textContent = "Processando foto…";
  try{
    const dataUrl = await prepararEvidencia(file);
    if(!dataUrl){
      uploadedEvidence = null;
      $("fileDrop").textContent = "Foto muito pesada — escolha outra foto e toque para tentar de novo.";
      $("fileDrop").classList.remove("has-file");
      $("previewWrap").classList.add("hidden");
      return;
    }
    uploadedEvidence = { url: dataUrl, tipo: "imagem" };
    $("fileDrop").textContent = `Evidência anexada: ${file.name}`;
    $("fileDrop").classList.add("has-file");
    const wrap = $("previewWrap");
    wrap.classList.remove("hidden");
    wrap.innerHTML = `<img src="${dataUrl}" alt="Evidência">`;
  }catch(err){
    uploadedEvidence = null;
    $("fileDrop").textContent = "Não foi possível processar a foto. Toque para tentar novamente.";
  }
});

/* ---------------- ABRIR CHAMADO ---------------- */
$("ticketForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("ticketError").textContent = "";
  if(!uploadedEvidence){
    $("ticketError").textContent = "Anexe uma foto da evidência antes de enviar.";
    return;
  }
  $("ticketSubmit").disabled = true;
  try{
    await addDoc(collection(db,"chamados"), {
      idLicenciado: $("fId").value.trim(),
      nomeLicenciado: $("fNome").value.trim(),
      descricao: $("fDesc").value.trim(),
      evidenciaUrl: uploadedEvidence.url,
      evidenciaTipo: uploadedEvidence.tipo,
      status: "aberto",
      criadoPor: { uid: currentUser.uid, nome: currentUserProfile.nome },
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp(),
      historico: [{ status:"aberto", por: currentUserProfile.nome, em: new Date().toISOString() }]
    });
    $("ticketForm").reset();
    uploadedEvidence = null;
    $("fileDrop").textContent = "Toque para selecionar uma foto";
    $("fileDrop").classList.remove("has-file");
    $("previewWrap").classList.add("hidden");
    toast("Chamado aberto", "Seu chamado foi enviado com sucesso.", "feito");
  }catch(err){
    $("ticketError").textContent = "Não foi possível abrir o chamado. Tente novamente.";
  }
  $("ticketSubmit").disabled = false;
});

/* ---------------- LISTA / TEMPO REAL ---------------- */
function startTicketsListener(){
  if(unsubscribeTickets){ unsubscribeTickets(); unsubscribeTickets = null; }
  let primeiraCarga = true;
  const q = query(collection(db,"chamados"), orderBy("criadoEm","desc"));
  unsubscribeTickets = onSnapshot(q, (snap)=>{
    allTickets = snap.docs.map(d=>({ id:d.id, ...d.data() }));

    if(!primeiraCarga){
      snap.docChanges().forEach(change=>{
        if(change.type === "added"){
          const t = change.doc.data();
          if(souGestor() && t.criadoPor && t.criadoPor.uid !== currentUser.uid){
            unreadCount++;
            beep();
            toast("Novo chamado", `<b>${t.nomeLicenciado}</b> aberto por ${t.criadoPor.nome} às ${fmtData(t.criadoEm)}`, "aberto");
            if("Notification" in window && Notification.permission === "granted"){
              new Notification("Novo chamado", { body: `${t.nomeLicenciado} — aberto por ${t.criadoPor.nome}` });
            }
            updateBadges();
          }
        }
        if(change.type === "modified"){
          const t = change.doc.data();
          const comentarios = t.comentarios || [];
          const contagemAnterior = commentCounts[change.doc.id] ?? comentarios.length;
          if(comentarios.length > contagemAnterior && t.criadoPor && t.criadoPor.uid === currentUser.uid){
            const ultimo = comentarios[comentarios.length-1];
            beep();
            toast("Novo comentário", `<b>${ultimo.por}</b> comentou no chamado de <b>${t.nomeLicenciado}</b>: "${ultimo.texto}"`, "analise");
            if("Notification" in window && Notification.permission === "granted"){
              new Notification("Novo comentário no seu chamado", { body: `${ultimo.por}: ${ultimo.texto}` });
            }
          }
        }
      });
    }
    allTickets.forEach(t=>{ commentCounts[t.id] = (t.comentarios||[]).length; });
    primeiraCarga = false;
    renderTickets();
    renderMyHistory();
    if(!$("notifPanel").classList.contains("hidden")) renderNotifPanel();
  });
}

function renderTickets(){
  const counts = { todos: allTickets.length, aberto:0, analise:0, feito:0 };
  allTickets.forEach(t=>counts[t.status]!==undefined && counts[t.status]++);
  $("cAll").textContent = counts.todos;
  $("cAberto").textContent = counts.aberto;
  $("cAnalise").textContent = counts.analise;
  $("cFeito").textContent = counts.feito;

  const filtered = activeFilter === "todos" ? allTickets : allTickets.filter(t=>t.status===activeFilter);
  const list = $("ticketList");
  if(filtered.length === 0){
    list.innerHTML = `<div class="card empty"><div class="glyph">🗒️</div>Nenhum chamado encontrado.</div>`;
    return;
  }
  list.innerHTML = filtered.map(t=>ticketCard(t)).join("");
  attachCardHandlers();
}

function abrirImagem(ticketId){
  const t = allTickets.find(x=>x.id === ticketId);
  if(!t) return;
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `<img src="${t.evidenciaUrl}" alt="Evidência do bloqueio"><button type="button" class="lightbox-close" aria-label="Fechar">✕</button>`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}
window.abrirImagem = abrirImagem;

function ticketCard(t){
  const hist = (t.historico||[]).slice().reverse().map(h=>
    `<div class="hist-item"><b>${STATUS_LABEL[h.status]||h.status}</b> — ${h.por} · ${new Date(h.em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>`
  ).join("") || `<div class="hist-item">Sem histórico.</div>`;

  const comentarios = t.comentarios || [];
  const comentariosHtml = comentarios.length
    ? comentarios.map(c=>`
        <div class="comment-item">
          ${c.texto}
          <div class="comment-meta">${c.por} · ${new Date(c.em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
        </div>`).join("")
    : `<div class="comment-empty">Nenhum comentário ainda.</div>`;
  const comentarioForm = souGestor()
    ? `<div class="comment-form">
         <input type="text" placeholder="Escrever um comentário para o colaborador…" data-comment-input="${t.id}">
         <button type="button" data-comment-send="${t.id}">Enviar</button>
       </div>`
    : "";

  const gestorTag = `<span class="gestor-tag">📌 ${RESPONSAVEL_NOME}</span>`;
  const highlight = (souGestor() && t.status !== "feito") ? "is-highlight" : "";

  return `
  <div class="card ticket ${highlight}" data-id="${t.id}">
    <div class="ticket-head">
      <div>
        <div class="ticket-id mono">ID ${t.idLicenciado}</div>
        <div class="ticket-name">${t.nomeLicenciado}</div>
      </div>
      <div style="text-align:right">
        <span class="status-tag ${t.status}">${STATUS_LABEL[t.status]||t.status}</span>
        ${gestorTag}
      </div>
    </div>
    <div class="ticket-desc">${t.descricao}</div>
    <div class="ticket-meta">
      <span>Aberto por <b>${t.criadoPor?.nome||"—"}</b></span>
      <span>Em <b>${fmtData(t.criadoEm)}</b></span>
    </div>
    <div class="ticket-evidence"><img src="${t.evidenciaUrl}" alt="Evidência do bloqueio" style="max-width:180px;max-height:140px;border-radius:8px;border:1px solid var(--line);cursor:pointer;" onclick="abrirImagem('${t.id}')"></div>
    <div class="ticket-body-pad">
      ${statusRail(t.status, souGestor())}
      <button class="hist-toggle" data-toggle="${t.id}">▾ Ver histórico</button>
      <div class="hist-list" id="hist-${t.id}">${hist}</div>
      <div class="comments">
        <div class="comments-title">Comentários${comentarios.length ? ` (${comentarios.length})` : ""}</div>
        <div id="comments-${t.id}">${comentariosHtml}</div>
        ${comentarioForm}
      </div>
    </div>
  </div>`;
}

function statusRail(current, editavel){
  const idx = STATUS_ORDER.indexOf(current);
  return `<div class="rail">
    ${STATUS_ORDER.map((s,i)=>{
      const state = i < idx ? "done" : i === idx ? "current" : "pending";
      const conteudo = `
          <span class="rail-dot">${i+1}</span>
          <span class="rail-label">${STATUS_LABEL[s]}</span>`;
      return `
      <div class="rail-node" data-state="${state}" data-status="${s}">
        ${i>0 ? `<div class="rail-line left"></div>`:""}
        ${i<STATUS_ORDER.length-1 ? `<div class="rail-line right"></div>`:""}
        ${editavel
          ? `<button type="button" data-set-status="${s}">${conteudo}</button>`
          : `<div class="rail-node-view">${conteudo}</div>`}
      </div>`;
    }).join("")}
  </div>`;
}

function attachCardHandlers(){
  document.querySelectorAll("[data-toggle]").forEach(btn=>{
    btn.onclick = () => {
      const el = $("hist-"+btn.dataset.toggle);
      el.classList.toggle("open");
      btn.textContent = (el.classList.contains("open") ? "▴ Ocultar histórico" : "▾ Ver histórico");
    };
  });
  document.querySelectorAll("[data-set-status]").forEach(btn=>{
    btn.onclick = async () => {
      const card = btn.closest(".ticket");
      const ticketId = card.dataset.id;
      const newStatus = btn.dataset.setStatus;
      await updateDoc(doc(db,"chamados",ticketId), {
        status: newStatus,
        atualizadoEm: serverTimestamp(),
        historico: arrayUnion({ status:newStatus, por: currentUserProfile.nome, em: new Date().toISOString() })
      });
    };
  });
  document.querySelectorAll("[data-comment-send]").forEach(btn=>{
    const ticketId = btn.dataset.commentSend;
    const input = document.querySelector(`[data-comment-input="${ticketId}"]`);
    const enviar = async () => {
      const texto = input.value.trim();
      if(!texto) return;
      btn.disabled = true;
      try{
        await updateDoc(doc(db,"chamados",ticketId), {
          comentarios: arrayUnion({ texto, por: currentUserProfile.nome, em: new Date().toISOString() }),
          atualizadoEm: serverTimestamp()
        });
        input.value = "";
      }catch(err){
        toast("Erro", "Não foi possível enviar o comentário.", "aberto");
      }
      btn.disabled = false;
    };
    btn.onclick = enviar;
    input.addEventListener("keydown", (e)=>{ if(e.key === "Enter"){ e.preventDefault(); enviar(); } });
  });
}

function renderMyHistory(){
  const mine = allTickets.filter(t=>t.criadoPor?.uid === currentUser.uid).slice(0,5);
  const el = $("myHistory");
  if(mine.length===0){ el.innerHTML = `<div class="card empty" style="padding:24px"><div class="glyph">📭</div>Você ainda não abriu chamados.</div>`; return; }
  el.innerHTML = mine.map(t=>ticketCard(t)).join("");
  attachCardHandlers();
}

/* ---------------- FILTROS ---------------- */
document.querySelectorAll(".filter-chip").forEach(chip=>{
  chip.addEventListener("click", ()=>{
    document.querySelectorAll(".filter-chip").forEach(c=>c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.status;
    renderTickets();
  });
});