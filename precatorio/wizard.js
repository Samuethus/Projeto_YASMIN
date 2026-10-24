/*
 * Motor do wizard de análise (modal em etapas com validação e aprovação).
 *
 * O motor não conhece regras de negócio: ele renderiza um "fluxo" registrado em
 * window.FluxosPrecatorio (ver fluxo-rpv.js). Para criar um novo processo de análise,
 * basta registrar outro fluxo com o mesmo formato e abrir com WizardPrecatorio.abrir('id').
 *
 * Formato de um fluxo:
 *   { id, titulo, subtitulo, versao, exemplo: {dados},
 *     etapas: [{ id, titulo, curto, descricao, manual: {ref, itens[]},
 *                campos: [campo], painel(d, ctx) -> html, validar(d, ctx) -> {erros[], alertas[]},
 *                revisao: true (etapa final) }] }
 * Formato de um campo:
 *   { id, tipo: texto|moeda|numero|data|selecao|simnao|area|checkbox|lista|aviso,
 *     rotulo, ajuda, obrigatorio, opcoes: [{valor, rotulo}], padrao: valor | fn(d),
 *     se: fn(d) -> bool, largura: 'inteira'|'meia'|'terco', colunas: [campo] (para lista) }
 */
(function (global) {
  'use strict';

  var R = global.RegrasPrecatorio;
  var ARMAZENAMENTO = 'analise-precatorio:';

  var estado = null;   // { fluxo, dados, aprovadas, atual, concluida }
  var el = {};          // referências do DOM do modal
  var ultimoFoco = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Persistência (rascunho por navegador) ---------- */

  function salvar() {
    try {
      localStorage.setItem(ARMAZENAMENTO + estado.fluxo.id, JSON.stringify({
        dados: estado.dados, aprovadas: estado.aprovadas, atual: estado.atual, concluida: estado.concluida
      }));
    } catch (e) {}
  }

  function carregar(fluxo) {
    try {
      var s = JSON.parse(localStorage.getItem(ARMAZENAMENTO + fluxo.id));
      if (s && s.dados) return s;
    } catch (e) {}
    return null;
  }

  /* ---------- Contexto e valores ---------- */

  function ctx() {
    return { R: R, fluxo: estado.fluxo, dados: estado.dados };
  }

  function visivel(campo) {
    return !campo.se || !!campo.se(estado.dados, ctx());
  }

  function aplicarPadroes(etapa) {
    etapa.campos.forEach(function (c) {
      if (c.padrao === undefined) return;
      var atual = estado.dados[c.id];
      if (atual === undefined || atual === '' || atual === null) {
        var v = typeof c.padrao === 'function' ? c.padrao(estado.dados, ctx()) : c.padrao;
        if (v !== undefined && v !== null && v !== '') estado.dados[c.id] = v;
      }
    });
  }

  function vazio(campo, v) {
    if (campo.tipo === 'lista') return !v || !v.length;
    if (campo.tipo === 'checkbox') return !v;
    return v === undefined || v === null || String(v).trim() === '';
  }

  function validarEtapa(etapa) {
    var erros = [];
    var alertas = [];
    etapa.campos.forEach(function (c) {
      if (c.tipo === 'aviso' || !visivel(c)) return;
      var obrig = typeof c.obrigatorio === 'function' ? c.obrigatorio(estado.dados, ctx()) : c.obrigatorio;
      if (obrig && vazio(c, estado.dados[c.id])) erros.push({ campo: c.id, msg: 'Preencha: ' + c.rotulo });
      if (c.tipo === 'lista' && estado.dados[c.id]) {
        estado.dados[c.id].forEach(function (item, i) {
          c.colunas.forEach(function (col) {
            if (col.obrigatorio && vazio(col, item[col.id])) erros.push({ campo: c.id, msg: c.rotulo + ' — item ' + (i + 1) + ': preencha ' + col.rotulo });
          });
        });
      }
    });
    if (etapa.validar) {
      var r = etapa.validar(estado.dados, ctx()) || {};
      (r.erros || []).forEach(function (m) { erros.push(typeof m === 'string' ? { msg: m } : m); });
      (r.alertas || []).forEach(function (m) { alertas.push(typeof m === 'string' ? { msg: m } : m); });
    }
    return { erros: erros, alertas: alertas };
  }

  function primeiraPendente() {
    var etapas = estado.fluxo.etapas;
    for (var i = 0; i < etapas.length; i++) if (!estado.aprovadas[etapas[i].id]) return i;
    return etapas.length - 1;
  }

  function desaprovarAPartirDe(indice) {
    var etapas = estado.fluxo.etapas;
    for (var i = indice; i < etapas.length; i++) delete estado.aprovadas[etapas[i].id];
    estado.concluida = false;
  }

  /* ---------- Renderização de campos ---------- */

  function htmlCampo(c, valor, prefixo) {
    var id = (prefixo || 'pw-') + c.id;
    var nome = c.id;
    var ajuda = c.ajuda ? '<small class="pw-ajuda">' + c.ajuda + '</small>' : '';
    var obrig = c.obrigatorio ? ' <span class="pw-obrig" aria-hidden="true">*</span>' : '';
    var largura = 'pw-l-' + (c.largura || 'inteira');
    var v = valor == null ? '' : valor;

    if (c.tipo === 'aviso') {
      return '<div class="pw-campo ' + largura + ' pw-aviso-campo" data-campo="' + c.id + '">' + (typeof c.html === 'function' ? c.html(estado.dados, ctx()) : c.html) + '</div>';
    }
    if (c.tipo === 'checkbox') {
      return '<div class="pw-campo ' + largura + '" data-campo="' + c.id + '"><label class="pw-check"><input type="checkbox" id="' + id + '" data-id="' + nome + '"' + (v ? ' checked' : '') + '><span>' + c.rotulo + obrig + '</span></label>' + ajuda + '</div>';
    }
    if (c.tipo === 'simnao') {
      return '<div class="pw-campo ' + largura + '" data-campo="' + c.id + '"><span class="pw-rotulo" id="' + id + '-r">' + c.rotulo + obrig + '</span>' +
        '<div class="pw-segmentado" role="radiogroup" aria-labelledby="' + id + '-r">' +
        ['S', 'N'].map(function (op) {
          return '<label><input type="radio" name="' + id + '" data-id="' + nome + '" value="' + op + '"' + (v === op ? ' checked' : '') + '><span>' + (op === 'S' ? 'Sim' : 'Não') + '</span></label>';
        }).join('') + '</div>' + ajuda + '</div>';
    }

    var controle;
    if (c.tipo === 'selecao') {
      controle = '<select id="' + id + '" data-id="' + nome + '"><option value="">Selecione…</option>' +
        c.opcoes.map(function (o) { return '<option value="' + esc(o.valor) + '"' + (String(v) === String(o.valor) ? ' selected' : '') + '>' + esc(o.rotulo) + '</option>'; }).join('') + '</select>';
    } else if (c.tipo === 'area') {
      controle = '<textarea id="' + id + '" data-id="' + nome + '" rows="3" placeholder="' + esc(c.placeholder || '') + '">' + esc(v) + '</textarea>';
    } else {
      var tipo = c.tipo === 'data' ? 'date' : 'text';
      var modo = (c.tipo === 'moeda' || c.tipo === 'numero') ? ' inputmode="decimal"' : '';
      var pref = c.tipo === 'moeda' ? '<span class="pw-prefixo">R$</span>' : '';
      var suf = c.sufixo ? '<span class="pw-sufixo">' + c.sufixo + '</span>' : '';
      controle = '<div class="pw-input' + (pref ? ' com-prefixo' : '') + (suf ? ' com-sufixo' : '') + '">' + pref +
        '<input type="' + tipo + '" id="' + id + '" data-id="' + nome + '" data-tipo="' + c.tipo + '" value="' + esc(v) + '"' + modo +
        ' placeholder="' + esc(c.placeholder || '') + '" autocomplete="off">' + suf + '</div>';
    }
    return '<div class="pw-campo ' + largura + '" data-campo="' + c.id + '"><label class="pw-rotulo" for="' + id + '">' + c.rotulo + obrig + '</label>' + controle + ajuda + '</div>';
  }

  function htmlLista(c) {
    var itens = estado.dados[c.id] || [];
    var corpo = itens.map(function (item, i) {
      return '<div class="pw-item" data-lista="' + c.id + '" data-indice="' + i + '">' +
        '<div class="pw-item-topo"><strong>' + esc(c.rotuloItem || 'Item') + ' ' + (i + 1) + '</strong>' +
        '<button type="button" class="pw-link" data-acao="remover-item" data-lista="' + c.id + '" data-indice="' + i + '">Remover</button></div>' +
        '<div class="pw-grade">' + c.colunas.map(function (col) {
          return htmlCampo(col, item[col.id], 'pw-' + c.id + '-' + i + '-');
        }).join('') + '</div></div>';
    }).join('');
    return '<div class="pw-campo pw-l-inteira" data-campo="' + c.id + '"><span class="pw-rotulo">' + c.rotulo + (c.obrigatorio ? ' <span class="pw-obrig">*</span>' : '') + '</span>' +
      (c.ajuda ? '<small class="pw-ajuda">' + c.ajuda + '</small>' : '') +
      '<div class="pw-lista">' + (corpo || '<p class="pw-vazio">Nenhum item adicionado.</p>') + '</div>' +
      '<button type="button" class="pw-btn pw-btn-sec pw-btn-peq" data-acao="adicionar-item" data-lista="' + c.id + '">+ Adicionar ' + esc((c.rotuloItem || 'item').toLowerCase()) + '</button></div>';
  }

  /* ---------- Renderização do modal ---------- */

  function renderStepper() {
    var pendente = primeiraPendente();
    el.stepper.innerHTML = estado.fluxo.etapas.map(function (e, i) {
      var classe = i === estado.atual ? 'atual' : (estado.aprovadas[e.id] ? 'aprovada' : '');
      var bloqueada = i > pendente;
      return '<li class="' + classe + '"><button type="button" data-ir="' + i + '"' + (bloqueada ? ' disabled' : '') + ' aria-current="' + (i === estado.atual ? 'step' : 'false') + '">' +
        '<span class="pw-num">' + (estado.aprovadas[e.id] ? '✓' : i + 1) + '</span><span class="pw-curto">' + esc(e.curto || e.titulo) + '</span></button></li>';
    }).join('');
    var aprovadas = estado.fluxo.etapas.filter(function (e) { return estado.aprovadas[e.id]; }).length;
    el.progresso.style.width = (aprovadas / estado.fluxo.etapas.length * 100) + '%';
  }

  function renderEtapa() {
    var etapa = estado.fluxo.etapas[estado.atual];
    aplicarPadroes(etapa);

    var manual = etapa.manual ? '<aside class="pw-manual"><div class="pw-manual-topo"><span class="pw-selo">Manual RPV</span><span>' + esc(etapa.manual.ref) + '</span></div><ul>' +
      etapa.manual.itens.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></aside>' : '';

    var campos = etapa.campos.map(function (c) {
      return c.tipo === 'lista' ? htmlLista(c) : htmlCampo(c, estado.dados[c.id]);
    }).join('');

    el.corpo.innerHTML =
      '<div class="pw-cabecalho-etapa"><span class="pw-eyebrow">Etapa ' + (estado.atual + 1) + ' de ' + estado.fluxo.etapas.length + '</span>' +
      '<h3 id="pw-titulo-etapa" tabindex="-1">' + esc(etapa.titulo) + '</h3>' + (etapa.descricao ? '<p>' + etapa.descricao + '</p>' : '') + '</div>' +
      '<div class="pw-colunas' + (!etapa.manual && !etapa.painel ? ' unica' : '') + '"><form class="pw-form" novalidate><div class="pw-grade">' + campos + '</div></form>' +
      '<div class="pw-lateral">' + manual + '<div class="pw-painel" aria-live="polite"></div></div></div>' +
      '<div class="pw-validacao" aria-live="polite"></div>';

    atualizarDinamico();
    renderStepper();
    el.corpo.scrollTop = 0;
  }

  function atualizarDinamico() {
    var etapa = estado.fluxo.etapas[estado.atual];
    var form = el.corpo.querySelector('.pw-form');

    // Visibilidade condicional
    etapa.campos.forEach(function (c) {
      var bloco = form.querySelector('[data-campo="' + c.id + '"]');
      if (bloco) bloco.hidden = !visivel(c);
      if (bloco && c.tipo === 'aviso' && typeof c.html === 'function') bloco.innerHTML = c.html(estado.dados, ctx());
    });

    var painel = el.corpo.querySelector('.pw-painel');
    painel.innerHTML = etapa.painel ? etapa.painel(estado.dados, ctx()) : '';
    painel.hidden = !painel.innerHTML;

    var v = validarEtapa(etapa);
    var html = '';
    if (v.erros.length) html += '<div class="pw-msg pw-erro"><strong>Pendências que impedem o avanço</strong><ul>' + v.erros.map(function (e) { return '<li>' + e.msg + '</li>'; }).join('') + '</ul></div>';
    if (v.alertas.length) html += '<div class="pw-msg pw-alerta"><strong>Pontos de atenção</strong><ul>' + v.alertas.map(function (e) { return '<li>' + e.msg + '</li>'; }).join('') + '</ul></div>';
    if (!v.erros.length && !v.alertas.length) html = '<div class="pw-msg pw-ok"><strong>Etapa validada.</strong> Nenhuma pendência encontrada.</div>';
    el.corpo.querySelector('.pw-validacao').innerHTML = html;

    // Rodapé: aprovação e botões
    var aprovada = !!estado.aprovadas[etapa.id];
    var final = !!etapa.revisao;
    el.aprovar.checked = aprovada;
    el.aprovar.disabled = v.erros.length > 0;
    el.aprovarTexto.textContent = final
      ? 'Declaro que revisei toda a análise e aprovo o resultado'
      : 'Revisei os dados desta etapa e aprovo para seguir';
    el.voltar.disabled = estado.atual === 0;
    el.avancar.textContent = final ? (estado.concluida ? 'Análise concluída ✓' : 'Concluir análise') : 'Avançar';
    el.avancar.disabled = v.erros.length > 0 || !aprovada || (final && estado.concluida);
    el.status.textContent = v.erros.length ? v.erros.length + ' pendência(s)' : (aprovada ? 'Etapa aprovada' : 'Aguardando sua aprovação');
    el.status.className = 'pw-status ' + (v.erros.length ? 'erro' : aprovada ? 'ok' : '');
  }

  /* ---------- Eventos ---------- */

  function lerCampo(input) {
    if (input.type === 'checkbox') return input.checked;
    return input.value;
  }

  function aoAlterar(ev) {
    var input = ev.target;
    var id = input.getAttribute('data-id');
    if (!id) return;
    var item = input.closest('.pw-item');
    if (item) {
      var lista = item.getAttribute('data-lista');
      estado.dados[lista][+item.getAttribute('data-indice')][id] = lerCampo(input);
    } else {
      estado.dados[id] = lerCampo(input);
    }
    if (estado.aprovadas[estado.fluxo.etapas[estado.atual].id] || estado.concluida) {
      desaprovarAPartirDe(estado.atual);
      renderStepper();
    }
    salvar();
    atualizarDinamico();
  }

  function aoSairCampo(ev) {
    var input = ev.target;
    if (input.getAttribute && input.getAttribute('data-tipo') === 'moeda' && input.value.trim()) {
      input.value = R.numero(input.value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      aoAlterar({ target: input });
    }
  }

  function aoClicar(ev) {
    var alvo = ev.target.closest('[data-acao], [data-ir]');
    if (!alvo) return;
    var etapa = estado.fluxo.etapas[estado.atual];

    if (alvo.hasAttribute('data-ir')) {
      irPara(+alvo.getAttribute('data-ir'));
      return;
    }
    var acao = alvo.getAttribute('data-acao');
    var lista = alvo.getAttribute('data-lista');
    if (acao === 'adicionar-item' || acao === 'remover-item') {
      var campo = etapa.campos.filter(function (c) { return c.id === lista; })[0];
      estado.dados[lista] = estado.dados[lista] || [];
      if (acao === 'adicionar-item') {
        var novo = {};
        campo.colunas.forEach(function (col) { if (col.padrao !== undefined) novo[col.id] = col.padrao; });
        estado.dados[lista].push(novo);
      } else {
        estado.dados[lista].splice(+alvo.getAttribute('data-indice'), 1);
      }
      desaprovarAPartirDe(estado.atual);
      salvar();
      renderEtapa();
    } else if (acao === 'fechar') fechar();
    else if (acao === 'exemplo') carregarExemplo();
    else if (acao === 'limpar') limpar();
    else if (acao === 'imprimir') imprimir();
    else if (acao === 'exportar') exportar();
    else if (acao === 'executar' && etapa.acoes && etapa.acoes[alvo.getAttribute('data-nome')]) {
      etapa.acoes[alvo.getAttribute('data-nome')](estado.dados, ctx());
      desaprovarAPartirDe(estado.atual);
      salvar();
      renderEtapa();
    }
  }

  function irPara(i) {
    if (i < 0 || i >= estado.fluxo.etapas.length || i > primeiraPendente()) return;
    estado.atual = i;
    salvar();
    renderEtapa();
    var t = document.getElementById('pw-titulo-etapa');
    if (t) t.focus();
  }

  function aprovar() {
    var etapa = estado.fluxo.etapas[estado.atual];
    if (el.aprovar.checked && !validarEtapa(etapa).erros.length) {
      estado.aprovadas[etapa.id] = new Date().toISOString();
    } else {
      desaprovarAPartirDe(estado.atual);
    }
    salvar();
    renderStepper();
    atualizarDinamico();
  }

  function avancar() {
    var etapa = estado.fluxo.etapas[estado.atual];
    if (validarEtapa(etapa).erros.length || !estado.aprovadas[etapa.id]) return;
    if (etapa.revisao) {
      estado.concluida = new Date().toISOString();
      salvar();
      renderEtapa();
      return;
    }
    irPara(estado.atual + 1);
  }

  /* ---------- Ações gerais ---------- */

  function carregarExemplo() {
    if (!estado.fluxo.exemplo) return;
    if (Object.keys(estado.dados).length && !confirm('Substituir os dados atuais pelo processo de exemplo?')) return;
    estado.dados = JSON.parse(JSON.stringify(estado.fluxo.exemplo));
    estado.aprovadas = {};
    estado.concluida = false;
    estado.atual = 0;
    salvar();
    renderEtapa();
  }

  function limpar() {
    if (!confirm('Apagar todos os dados desta análise? Esta ação não pode ser desfeita.')) return;
    estado.dados = {};
    estado.aprovadas = {};
    estado.concluida = false;
    estado.atual = 0;
    salvar();
    renderEtapa();
  }

  function exportar() {
    var conteudo = JSON.stringify({
      fluxo: estado.fluxo.id, versao: estado.fluxo.versao, geradoEm: new Date().toISOString(),
      concluida: estado.concluida || false, aprovacoes: estado.aprovadas, dados: estado.dados
    }, null, 2);
    var blob = new Blob([conteudo], { type: 'application/json' });
    var a = document.createElement('a');
    var numero = (estado.dados.numero || 'analise').replace(/[^\w.-]/g, '_');
    a.href = URL.createObjectURL(blob);
    a.download = 'analise-' + numero + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function imprimir() {
    document.body.classList.add('pw-imprimindo');
    el.corpo.querySelectorAll('details').forEach(function (d) { d.open = true; });
    window.print();
    setTimeout(function () { document.body.classList.remove('pw-imprimindo'); }, 500);
  }

  /* ---------- Montagem do modal ---------- */

  function montar() {
    if (el.overlay) return;
    var wrap = document.createElement('div');
    wrap.className = 'pw-overlay';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="pw-modal" role="dialog" aria-modal="true" aria-labelledby="pw-titulo">' +
      '  <header class="pw-topo">' +
      '    <div><span class="pw-eyebrow" id="pw-subtitulo"></span><h2 id="pw-titulo"></h2></div>' +
      '    <div class="pw-topo-acoes">' +
      '      <button type="button" class="pw-btn pw-btn-sec pw-btn-peq" data-acao="exemplo">Carregar exemplo</button>' +
      '      <button type="button" class="pw-btn pw-btn-sec pw-btn-peq" data-acao="limpar">Limpar</button>' +
      '      <button type="button" class="pw-fechar" data-acao="fechar" aria-label="Fechar">&times;</button>' +
      '    </div>' +
      '  </header>' +
      '  <div class="pw-trilha"><div class="pw-progresso"></div></div>' +
      '  <nav class="pw-stepper-wrap" aria-label="Etapas da análise"><ol class="pw-stepper"></ol></nav>' +
      '  <div class="pw-corpo"></div>' +
      '  <footer class="pw-rodape">' +
      '    <button type="button" class="pw-btn pw-btn-sec" id="pw-voltar">Voltar</button>' +
      '    <div class="pw-aprovacao"><label class="pw-check"><input type="checkbox" id="pw-aprovar"><span id="pw-aprovar-texto"></span></label><span class="pw-status" id="pw-status"></span></div>' +
      '    <button type="button" class="pw-btn pw-btn-pri" id="pw-avancar">Avançar</button>' +
      '  </footer>' +
      '</div>';
    document.body.appendChild(wrap);

    el = {
      overlay: wrap,
      modal: wrap.querySelector('.pw-modal'),
      titulo: wrap.querySelector('#pw-titulo'),
      subtitulo: wrap.querySelector('#pw-subtitulo'),
      stepper: wrap.querySelector('.pw-stepper'),
      progresso: wrap.querySelector('.pw-progresso'),
      corpo: wrap.querySelector('.pw-corpo'),
      voltar: wrap.querySelector('#pw-voltar'),
      avancar: wrap.querySelector('#pw-avancar'),
      aprovar: wrap.querySelector('#pw-aprovar'),
      aprovarTexto: wrap.querySelector('#pw-aprovar-texto'),
      status: wrap.querySelector('#pw-status')
    };

    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) fechar(); else aoClicar(ev); });
    el.corpo.addEventListener('input', aoAlterar);
    el.corpo.addEventListener('change', aoAlterar);
    el.corpo.addEventListener('focusout', aoSairCampo);
    el.aprovar.addEventListener('change', aprovar);
    el.voltar.addEventListener('click', function () { irPara(estado.atual - 1); });
    el.avancar.addEventListener('click', avancar);
    document.addEventListener('keydown', function (ev) {
      if (!wrap.hidden && ev.key === 'Escape') fechar();
    });
  }

  function abrir(idFluxo) {
    var fluxo = (global.FluxosPrecatorio || {})[idFluxo];
    if (!fluxo) throw new Error('Fluxo de análise não encontrado: ' + idFluxo);
    montar();
    var salvo = carregar(fluxo);
    estado = {
      fluxo: fluxo,
      dados: salvo ? salvo.dados : {},
      aprovadas: salvo ? salvo.aprovadas || {} : {},
      atual: salvo ? Math.min(salvo.atual || 0, fluxo.etapas.length - 1) : 0,
      concluida: salvo ? salvo.concluida || false : false
    };
    el.titulo.textContent = fluxo.titulo;
    el.subtitulo.textContent = fluxo.subtitulo || '';
    ultimoFoco = document.activeElement;
    el.overlay.hidden = false;
    document.body.classList.add('pw-aberto');
    renderEtapa();
    var t = document.getElementById('pw-titulo-etapa');
    if (t) t.focus();
  }

  function fechar() {
    if (!el.overlay) return;
    el.overlay.hidden = true;
    document.body.classList.remove('pw-aberto');
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
  }

  global.WizardPrecatorio = {
    abrir: abrir,
    fechar: fechar,
    // Usado pela etapa de revisão para montar o resumo de todas as etapas.
    resumo: function () {
      return estado.fluxo.etapas.filter(function (e) { return !e.revisao; }).map(function (e) {
        return { etapa: e, validacao: validarEtapa(e), aprovada: estado.aprovadas[e.id] || null, campos: e.campos.filter(visivel) };
      });
    },
    estado: function () { return estado; },
    esc: esc
  };
})(window);
