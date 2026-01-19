/* TESOURA - app.js (remove 404 e mantém roteamento seguro) */
(function () {
  "use strict";

  const PANEL_MAP = {
    jogadores: "panels/jogadores.html",
    "presenca-escalacao": "panels/presenca_escalacao.html",
    presenca: "panels/presenca_escalacao.html",
    escalacao: "panels/presenca_escalacao.html",
    "controle-geral": "panels/controle_geral.html",
    controle: "panels/controle_geral.html",
    mensalidade: "panels/mensalidade.html",
    caixa: "panels/caixa.html",
    gols: "panels/gols.html",
    "banco-de-dados": "panels/banco_de_dados.html",
    banco: "panels/banco_de_dados.html",
  };

  function getHashPanel() {
    const h = (location.hash || "").replace("#", "").trim().toLowerCase();
    return h || "jogadores";
  }

  function setActiveMenu(panelKey) {
    const links = document.querySelectorAll("a[href^='#'], [data-hash]");
    links.forEach((el) => {
      const target = (el.getAttribute("href") || el.getAttribute("data-hash") || "")
        .replace("#", "")
        .trim()
        .toLowerCase();
      if (!target) return;
      el.classList.toggle("active", target === panelKey);
    });
  }

  async function loadPanel(panelKey) {
    const path = PANEL_MAP[panelKey] || PANEL_MAP["jogadores"];
    setActiveMenu(panelKey);

    // 1) Se existir iframe de painel, usa ele (mais seguro)
    const iframe =
      document.getElementById("panelFrame") ||
      document.querySelector("iframe.panel-frame") ||
      document.querySelector("iframe[data-panel-frame]");

    if (iframe) {
      const cb = "cb=" + Date.now();
      iframe.src = path + (path.includes("?") ? "&" : "?") + cb;
      return;
    }

    // 2) Se existir host div, injeta HTML (fallback)
    const host =
      document.getElementById("panelHost") ||
      document.querySelector("[data-panel-host]") ||
      document.getElementById("conteudo") ||
      document.getElementById("content");

    if (!host) return;

    try {
      const cb = "cb=" + Date.now();
      const res = await fetch(path + (path.includes("?") ? "&" : "?") + cb, { cache: "no-store" });
      const html = await res.text();
      host.innerHTML = html;
    } catch (e) {
      // Não quebra o app
      console.warn("Falha ao carregar painel:", panelKey, e);
    }
  }

  function route() {
    loadPanel(getHashPanel());
  }

  window.addEventListener("hashchange", route);
  document.addEventListener("DOMContentLoaded", route);
})();
