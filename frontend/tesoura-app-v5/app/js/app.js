(function(){
  function byId(id){ return document.getElementById(id); }

  function nowVer(){ return Date.now(); }

  function setActive(btns, idx){
    btns.forEach((b,i)=>{
      if(i===idx) b.classList.add("active");
      else b.classList.remove("active");
    });
  }

  function getRoute(){
    var h = (location.hash || "").replace("#","");
    if(!h) return "jogadores";
    return h;
  }

  function load(route){
    var frame = byId("frame");
    if(!frame) return;

    var routes = ["jogadores","presenca_escalacao","controle_geral","mensalidade","caixa","gols"];
    var idx = routes.indexOf(route);
    if(idx < 0){ route = "jogadores"; idx = 0; }

    var btns = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    if(btns.length) setActive(btns, idx);

    frame.src = "/panels/" + route + ".html?v=" + nowVer();
  }

  function bindTabs(){
    var btns = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    var routes = ["jogadores","presenca_escalacao","controle_geral","mensalidade","caixa","gols"];

    btns.forEach(function(btn, i){
      btn.addEventListener("click", function(){
        location.hash = "#" + routes[i];
      });
    });
  }

  window.addEventListener("hashchange", function(){
    load(getRoute());
  });

  document.addEventListener("DOMContentLoaded", function(){
    bindTabs();
    load(getRoute());
  });
})();
