(function(){
  const frame = document.getElementById("frame");
  const btns = document.querySelectorAll("[data-panel]");

  function openPanel(key){
    const map = {
      jogadores: "panels/jogadores.html",
      presenca_escalacao: "panels/presenca_escalacao.html",
      controle_geral: "panels/controle_geral.html",
      mensalidade: "panels/mensalidade.html",
      caixa: "panels/caixa.html",
      gols: "panels/gols.html",
    };
    frame.src = (map[key] || map.jogadores) + "?v=" + Date.now();
  }

  btns.forEach(b => b.addEventListener("click", () => openPanel(b.dataset.panel)));
  openPanel("jogadores");
})();
