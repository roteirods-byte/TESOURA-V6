(function(){
  function qs(obj){
    if(!obj) return "";
    var u = new URLSearchParams();
    Object.keys(obj).forEach(function(k){
      if(obj[k] === undefined || obj[k] === null) return;
      u.append(k, String(obj[k]));
    });
    var s = u.toString();
    return s ? ("?" + s) : "";
  }

  async function req(method, path, params, body){
    var base = (window.TESOURA_CONFIG && window.TESOURA_CONFIG.apiBase) ? window.TESOURA_CONFIG.apiBase : "/api";
    var url = base + path + qs(params);
    var opt = { method: method, headers: { "Accept":"application/json" } };
    if(method !== "GET"){
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body || {});
    }
    var r = await fetch(url, opt);
    var txt = await r.text();
    var j = null;
    try{ j = txt ? JSON.parse(txt) : null; }catch(e){}

    if(!r.ok){
      var msg = (j && (j.error?.message || j.message)) ? (j.error?.message || j.message) : ("HTTP "+r.status);
      throw new Error(msg);
    }
    return j;
  }

  window.TESOURA_API = {
    get: function(path, params){ return req("GET", path, params); },
    post: function(path, body){ return req("POST", path, null, body); }
  };
})();
