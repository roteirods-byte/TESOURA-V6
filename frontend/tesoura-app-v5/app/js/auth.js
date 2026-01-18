function requirePinGate() {
  const cfg = window.TESOURA_CONFIG || {};
  const saved = localStorage.getItem("TESOURA_PIN_OK");
  if (saved === "1") return;

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.75)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "99999";

  const box = document.createElement("div");
  box.style.width = "320px";
  box.style.background = "#0b1622";
  box.style.border = "1px solid rgba(255,255,255,.12)";
  box.style.borderRadius = "14px";
  box.style.padding = "18px";
  box.style.color = "#fff";
  box.style.boxShadow = "0 14px 60px rgba(0,0,0,.5)";

  box.innerHTML = `
    <h2 style="margin:0 0 6px 0;">Acesso</h2>
    <p style="margin:0 0 12px 0; opacity:.85;">Digite o PIN para usar o app.</p>

    <div style="margin:0 0 10px 0;">
      <div style="font-size:12px; opacity:.8; margin:0 0 6px 0;">PIN</div>
      <input id="pinInput" placeholder="Ex: 123456"
        style="width:100%; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.18); background:#0f2235; color:#fff;" />
      <div id="pinMsg" style="margin-top:8px; color:#ffb3b3; font-size:13px;"></div>
    </div>

    <div style="display:flex; gap:10px;">
      <button id="pinOk" style="flex:1; padding:10px; border-radius:10px; border:0; background:#1dd1a1; font-weight:700; cursor:pointer;">ENTRAR</button>
      <button id="pinCancel" style="flex:1; padding:10px; border-radius:10px; border:0; background:#ff9f43; font-weight:700; cursor:pointer;">SAIR</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const pinInput = box.querySelector("#pinInput");
  const msg = box.querySelector("#pinMsg");

  box.querySelector("#pinCancel").onclick = () => location.reload();

  box.querySelector("#pinOk").onclick = () => {
    const pin = (pinInput.value || "").trim();
    if (pin === (cfg.APP_PIN || "")) {
      localStorage.setItem("TESOURA_PIN_OK", "1");
      overlay.remove();
      return;
    }
    msg.textContent = "PIN incorreto.";
    pinInput.focus();
    pinInput.select();
  };

  setTimeout(() => pinInput.focus(), 50);
}
window.requirePinGate = requirePinGate;
