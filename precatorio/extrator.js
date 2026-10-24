/*
 * Leitura e análise automática dos autos (PDF exportado do PJe/TJMT).
 *
 * - O PDF é lido no próprio navegador com pdf.js; o arquivo nunca é enviado a um servidor.
 * - A análise localiza no texto as informações exigidas pelo Manual RPV e devolve:
 *     dados       → valores para os campos do wizard (mesmos ids de fluxo-rpv.js)
 *     evidencias  → de onde cada valor saiu (ID do documento, página e trecho)
 *     pareceres   → observações da análise, agrupadas por etapa
 * - PDFs digitalizados (sem camada de texto) não são lidos: o usuário é avisado.
 */
(function (global) {
  'use strict';

  var R = global.RegrasPrecatorio;
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  /* ---------- Leitura do PDF ---------- */

  function carregarPdfJs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS;
      s.onload = function () {
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(global.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('Não foi possível carregar o leitor de PDF. Verifique a conexão com a internet.')); };
      document.head.appendChild(s);
    });
  }

  // Mantém o mesmo comprimento do texto original: permite buscar sem acento e recortar o valor com acento.
  function semAcento(s) {
    return s.replace(/[À-ÿ]/g, function (c) { return c.normalize('NFD').charAt(0); });
  }

  // O pdf.js devolve o texto na ordem de desenho; formulários (ex.: espelho do precatório) ficam embaralhados.
  // Reconstrói as linhas pela posição: de cima para baixo e, em cada linha, da esquerda para a direita.
  function montarLinhas(itens) {
    var pedacos = itens.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
      return { x: it.transform[4], y: it.transform[5], fim: it.transform[4] + (it.width || 0), str: it.str };
    }).sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var linhas = [];
    pedacos.forEach(function (p) {
      var linha = linhas[linhas.length - 1];
      if (linha && Math.abs(linha.y - p.y) < 3) linha.itens.push(p);
      else linhas.push({ y: p.y, itens: [p] });
    });
    return linhas.map(function (l) {
      l.itens.sort(function (a, b) { return a.x - b.x; });
      var s = '';
      l.itens.forEach(function (p, i) {
        if (i > 0) s += p.x - l.itens[i - 1].fim > 1 ? '  ' : '';
        s += p.str;
      });
      return s;
    }).join('\n');
  }

  async function lerPdf(buffer, progresso) {
    var lib = await carregarPdfJs();
    var doc = await lib.getDocument({ data: buffer }).promise;
    var paginas = [];
    for (var i = 1; i <= doc.numPages; i++) {
      var page = await doc.getPage(i);
      var conteudo = await page.getTextContent();
      // Duas leituras da mesma página: a ordem do PDF (boa para tabelas como a capa do PJe)
      // e a reconstrução por posição (boa para formulários). A busca considera as duas.
      var fluxo = conteudo.items.map(function (it) { return it.str + (it.hasEOL ? '\n' : ' '); }).join('');
      var texto = (fluxo + '\n\n' + montarLinhas(conteudo.items)).normalize('NFC').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n');
      // Rodapé do PJe ("Num. 252355218 - Pág. 1"); ignora citações a outros documentos ("Pág.1/5").
      var rodapes = texto.match(/Num\.\s*\d{6,}\s*-\s*P[áa]g\.\s*\d+(?!\s*\/)/g) || [];
      var num = rodapes.length ? rodapes[rodapes.length - 1].match(/(\d{6,})\s*-\s*P[áa]g\.\s*(\d+)/) : null;
      paginas.push({ numero: i, texto: texto, busca: semAcento(texto), docId: num ? num[1] : null, docPag: num ? +num[2] : null });
      if (progresso) progresso(i / doc.numPages, 'Lendo página ' + i + ' de ' + doc.numPages);
    }
    return { paginas: paginas, totalPaginas: doc.numPages };
  }

  /* ---------- Busca com evidência ---------- */

  function fonte(p) {
    return (p.docId ? 'ID ' + p.docId + ', pág. ' + p.docPag + ' — ' : '') + 'p. ' + p.numero + ' do PDF';
  }

  function trecho(p, inicio, fim) {
    var a = Math.max(0, inicio - 70);
    var b = Math.min(p.texto.length, fim + 70);
    return (a > 0 ? '…' : '') + p.texto.slice(a, b).replace(/\s+/g, ' ').trim() + (b < p.texto.length ? '…' : '');
  }

  function achado(p, m, grupo) {
    var g = grupo === undefined ? 1 : grupo;
    var idx = m.indices && m.indices[g] ? m.indices[g] : [m.index, m.index + m[0].length];
    return { valor: p.texto.slice(idx[0], idx[1]).trim(), pagina: p, inicio: m.index, fim: m.index + m[0].length };
  }

  function todos(paginas, padrao, grupo) {
    var r = [];
    paginas.forEach(function (p) {
      var re = new RegExp(padrao.source, padrao.flags.replace('g', '') + 'gd');
      var m;
      while ((m = re.exec(p.busca))) {
        r.push(achado(p, m, grupo));
        if (m[0].length === 0) re.lastIndex++;
      }
    });
    return r;
  }

  function primeiro(paginas, padrao, grupo) {
    return todos(paginas, padrao, grupo)[0] || null;
  }

  function ultimo(paginas, padrao, grupo) {
    var t = todos(paginas, padrao, grupo);
    return t[t.length - 1] || null;
  }

  function existe(paginas, padrao) {
    return !!primeiro(paginas, padrao, 0);
  }

  function isoDeBr(br) {
    var m = String(br || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }

  function moedaBr(n) {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function nomeProprio(s) {
    var minusculas = ['de', 'da', 'do', 'das', 'dos', 'e'];
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').map(function (w, i) {
      return i > 0 && minusculas.indexOf(w) !== -1 ? w : w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  /* ---------- Análise ---------- */

  function analisar(leitura, arquivo) {
    var pg = leitura.paginas;
    var dados = {};
    var evid = {};
    var pareceres = {};
    var achados = [];

    function definir(campo, valor, a) {
      if (valor === undefined || valor === null || valor === '') return;
      dados[campo] = valor;
      if (a) evid[campo] = { valor: valor, fonte: fonte(a.pagina), trecho: trecho(a.pagina, a.inicio, a.fim) };
    }
    function parecer(etapa, tipo, msg) {
      (pareceres[etapa] = pareceres[etapa] || []).push({ tipo: tipo, msg: msg });
    }

    var caracteres = pg.reduce(function (s, p) { return s + p.texto.trim().length; }, 0);
    var digitalizado = caracteres / Math.max(1, pg.length) < 80;

    /* Índice de documentos do PJe (primeira(s) página(s)) */
    var documentos = [];
    todos(pg.slice(0, 6), /^(\d{9})\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(.+)$/m, 0).forEach(function (a) {
      var m = a.valor.match(/^(\d{9})\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(.+)$/);
      if (m && !documentos.some(function (d) { return d.id === m[1]; })) documentos.push({ id: m[1], data: m[2], descricao: m[3].trim() });
    });

    /* --- Processo --- */
    var a = primeiro(pg, /Numero:\s*(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/) || primeiro(pg, /(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/);
    if (a) definir('numero', a.valor, a);

    var classe = primeiro(pg, /Classe:\s*([^\n]+)/);
    var assunto = primeiro(pg, /Assuntos?:\s*([^\n]+)/);
    var valorCausa = primeiro(pg, /Valor da causa:\s*R\$\s*([\d.,]+)/);
    a = primeiro(pg, /Orgao julgador:\s*([^\n]+)/);
    if (a) definir('juizoOrigem', nomeProprio(a.valor), a);

    a = primeiro(pg, /Data Ajuizamento[\s\S]{0,160}?(\d{2}\/\d{2}\/\d{4})/) || primeiro(pg, /(?:Ultima )?distribuicao\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (a) definir('dataAjuizamento', isoDeBr(a.valor), a);

    if (classe && /cumprimento/i.test(classe.valor) || existe(pg, /cumprimento de sentenca/i)) definir('descricaoAcao', 'cumprimento', primeiro(pg, /(cumprimento de sentenca)/i));
    else if (existe(pg, /execucao contra a fazenda/i)) definir('descricaoAcao', 'execucao', primeiro(pg, /(execucao contra a fazenda)/i));

    /* Partes da capa do PJe: "NOME (REQUERENTE)" */
    var polos = { ativo: [], passivo: [], advogado: [] };
    var reParte = /([A-Z][A-Z .'-]{3,}?)\s*\((REQUERENTE|EXEQUENTE|AUTORA?|IMPETRANTE|RECLAMANTE|REQUERIDO|EXECUTADO|REU|IMPETRADO|RECLAMADO|ADVOGADO\(A\)|ADVOGADA?|PROCURADOR)\)/;
    todos(pg.slice(0, 3), reParte, 0).forEach(function (x) {
      var m = semAcento(x.valor).match(new RegExp(reParte.source));
      var nome = x.valor.slice(0, m[1].length).replace(/^\s*(Partes|Advogados)\s+/i, '').trim();
      var papel = m[2];
      var grupo = /ADVOGAD|PROCURADOR/.test(papel) ? 'advogado' : /REQUERIDO|EXECUTADO|REU|IMPETRADO|RECLAMADO/.test(papel) ? 'passivo' : 'ativo';
      if (polos[grupo].indexOf(nome) === -1) polos[grupo].push(nome);
    });

    /* Ente devedor */
    var passivo = polos.passivo.join(' | ');
    var alvoEnte = passivo || (primeiro(pg, /Polo Passivo:\s*([^\n(]+)/) || {}).valor || '';
    var enteBusca = semAcento(alvoEnte).toUpperCase();
    var aEnte = primeiro(pg, /(ESTADO DE MATO GROSSO|MUNICIPIO DE [A-Z ]+|INSTITUTO NACIONAL DO SEGURO SOCIAL|INSS)\s*\((?:REQUERIDO|EXECUTADO|REU)\)/);
    if (/ESTADO DE MATO GROSSO/.test(enteBusca)) definir('enteDevedor', 'estado_mt', aEnte);
    else if (/MUNICIPIO DE/.test(enteBusca)) { definir('enteDevedor', 'municipio', aEnte); definir('enteNome', nomeProprio(alvoEnte), aEnte); }
    else if (/INSS|INSTITUTO NACIONAL DO SEGURO/.test(enteBusca)) definir('enteDevedor', 'inss', aEnte);
    else if (alvoEnte) { definir('enteDevedor', 'outro', aEnte); definir('enteNome', nomeProprio(alvoEnte), aEnte); }

    /* Natureza */
    a = primeiro(pg, /Natureza do Processo[\s\S]{0,200}?(Alimentar|Comum)/i);
    if (a) definir('natureza', a.valor.toLowerCase(), a);
    else if ((a = primeiro(pg, /(abono de permanencia|vencimentos|proventos|aposentadoria|pensao|diferenca salarial|salario|beneficio previdenciario)/i))) definir('natureza', 'alimentar', a);

    /* Trânsito em julgado — todas as menções, para detectar divergência */
    var transitos = todos(pg, /transit(?:ou|ado) em julgado em\s*(\d{2}\/\d{2}\/\d{4})/i);
    var datasTransito = [];
    transitos.forEach(function (t) { if (datasTransito.indexOf(t.valor) === -1) datasTransito.push(t.valor); });
    var aTransito = ultimo(pg, /transitou em julgado em\s*(\d{2}\/\d{2}\/\d{4})/i) || transitos[transitos.length - 1];
    if (aTransito) definir('dataTransito', isoDeBr(aTransito.valor), aTransito);

    /* Ofício requisitório */
    a = primeiro(pg, /Oficio Requisitorio\s*n[º°o.]*\s*:?\s*(\d+[\/\d.-]*)/i);
    if (a) {
      definir('possuiOficio', 'S', a);
      definir('numeroOficio', a.valor, a);
      var rec = primeiro(pg, /(?:recebimento|recebido)[^.\n]{0,80}?oficio[^.\n]{0,60}?(\d{2}\/\d{2}\/\d{4})/i);
      if (rec) definir('dataRecebimentoOficio', isoDeBr(rec.valor), rec);
    } else {
      definir('possuiOficio', 'N');
    }

    /* --- Credor, representante e advogados --- */
    var aRep = primeiro(pg, /representad[oa] por (?:sua |seu )?(?:esposa|esposo|mae|pai|filh[oa]|curador[a]?|genitor[a]?)?\s*([A-Z][A-Z ]{5,}?)(?=,|\s+brasileir|\s+\(|\.|\s+por intermedio)/);
    var representante = aRep ? aRep.valor.trim() : '';
    var curatela = primeiro(pg, /(Interdicao|Curatela)/i);
    var ativos = polos.ativo.filter(function (n) { return !representante || semAcento(representante).indexOf(semAcento(n).split(' ')[0]) !== 0; });
    var credor = ativos[0] || polos.ativo[0] || '';
    if (!credor) {
      var poloAtivo = primeiro(pg, /Polo Ativo:\s*([^\n]+)/);
      if (poloAtivo) credor = poloAtivo.valor.replace(/\(.*$/, '').trim();
    }
    if (credor) {
      definir('nome', credor, primeiro(pg.slice(0, 3), new RegExp('(' + semAcento(credor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')')));
      if (representante) definir('representante', nomeProprio(representante) + (curatela ? ' (curatela — certidão de interdição nos autos)' : ''), aRep);

      // CPF/CNPJ logo após o nome do credor
      var nomeBusca = semAcento(credor).split(' ').slice(0, 3).join('\\s+');
      var aDoc = primeiro(pg, new RegExp(nomeBusca + '[\\s\\S]{0,260}?(\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}|\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-\\d{2})', 'i'));
      if (aDoc && (R.validarCpf(aDoc.valor) || R.validarCnpj(aDoc.valor))) {
        definir('documento', aDoc.valor, aDoc);
        definir('tipoPessoa', aDoc.valor.length > 14 ? 'J' : 'F', aDoc);
        var aNasc = primeiro(pg, new RegExp(aDoc.valor.replace(/[.\/-]/g, '\\$&') + '\\s+(\\d{2}\\/\\d{2}\\/\\d{4})'));
        if (aNasc) definir('nascimento', isoDeBr(aNasc.valor), aNasc);
      }
    }
    if (!dados.nascimento) {
      a = primeiro(pg, /Data de Nascimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (a) definir('nascimento', isoDeBr(a.valor), a);
    }
    definir('falecido', existe(pg, /(espolio|credor falecido|habilitacao de herdeiros|certidao de obito)/i) ? 'S' : 'N');
    definir('cessao', existe(pg, /cessao de credito/i) ? 'S' : 'N');

    var servidor = primeiro(pg, /(abono de permanencia|servidor(?:a)? publico|aposentad[oa] do Estado|ficha financeira|SEAP)/i);
    definir('servidorPublico', servidor ? 'S' : 'N', servidor);

    // Doença grave / isenção de IR
    var aLaudo = primeiro(pg, /(Isencao de Imposto de Renda|Laudo Medico Pericial|molestia grave|art\. 6º,? inciso XIV)/i);
    var aIsencao = primeiro(pg, /(Isencao de Imposto de Renda|Lei n?º? ?7\.713)/i);
    definir('doencaGrave', aLaudo ? 'S' : 'N', aLaudo);
    definir('deficiencia', 'N');

    // Advogados
    var advogados = polos.advogado.map(function (nome) {
      var base = semAcento(nome).split(' ').slice(0, 2).join('\\s+');
      var oab = primeiro(pg, new RegExp(base + '[\\s\\S]{0,400}?OAB\\s*\\/?\\s*(?:[A-Z]{2})?\\s*(?:n\\.?\\s*[º°o]?\\s*)?(\\d{3,6}(?:\\/[A-Z])?)', 'i'));
      var cpf = primeiro(pg, new RegExp(base + '[\\s\\S]{0,400}?CPF[^\\d]{0,15}(\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2})', 'i'));
      return { nome: nomeProprio(nome), oab: oab ? oab.valor : '', cpf: cpf && R.validarCpf(cpf.valor) ? cpf.valor : '' };
    });
    if (advogados.length) {
      dados.advogados = advogados;
      evid.advogados = { valor: advogados.length, fonte: fonte(pg[0]), trecho: 'Capa do processo: ' + polos.advogado.join(', ') + ' (ADVOGADO(A))' };
    }

    // Honorários
    a = primeiro(pg, /Percentual de Honorarios[\s\S]{0,140}?([\d]+,\d{2})\s*%/i);
    var contrato = primeiro(pg.slice(0, 4), /^\d{9}\s.*(contrato)/im);
    if (a && R.numero(a.valor) > 0) {
      definir('honorariosContratuais', 'S', a);
      definir('percContratual', a.valor, a);
      definir('contratoJuntado', contrato ? 'S' : 'N', contrato);
    } else {
      definir('honorariosContratuais', 'N', a);
    }
    var sucumb = primeiro(pg, /honorarios (?:advocaticios )?sucumbenciais[^.]{0,120}?R\$\s*([\d.]+,\d{2})/i);
    if (sucumb) { definir('honorariosSucumbenciais', 'S', sucumb); definir('valorSucumbencia', sucumb.valor, sucumb); }
    else definir('honorariosSucumbenciais', 'N');

    /* --- Cálculo homologado --- */
    // Prioriza o dispositivo da decisão ("HOMOLOGO") às menções feitas pelas partes ("homologou").
    var aHomolog = ultimo(pg, /(HOMOLOGO os calculos|HOMOLOGO o calculo|HOMOLOGA-SE)/) || ultimo(pg, /(homologou os calculos|Homologado o Acordo)/i);

    // Valor homologado: valor mais citado perto de palavras-chave do cálculo
    var candidatos = {};
    todos(pg, /R?\$?\s?(\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3},\d{2})/).forEach(function (x) {
      var n = R.numero(x.valor);
      if (n < 100) return;
      var ctx = x.pagina.busca.slice(Math.max(0, x.inicio - 160), x.inicio).toLowerCase();
      var peso = 1 + (/homolog|perfaz|apurad|requisitad|liquidac|concord|valor total|valor principal|montante/.test(ctx) ? 4 : 0);
      var c = candidatos[moedaBr(n)] = candidatos[moedaBr(n)] || { a: x, melhorPeso: 0, total: 0 };
      c.total += peso;
      if (peso > c.melhorPeso) { c.melhorPeso = peso; c.a = x; }
    });
    var melhor = Object.keys(candidatos).sort(function (x, y) { return candidatos[y].total - candidatos[x].total; })[0];
    if (melhor) {
      definir('valorLiquidacao', melhor, candidatos[melhor].a);
      var aCalc = primeiro(pg, new RegExp('(?:calculo|demonstrativo)[\\s\\S]{0,600}?' + melhor.replace(/\./g, '\\.'), 'i'));
      if (aCalc && aCalc.pagina.docId) definir('calculoFls', 'ID ' + aCalc.pagina.docId, aCalc);
    }

    a = primeiro(pg, /Valor Requisitado\s+Data Atualizacao[\s\S]{0,300}?[\d.]+,\d{2}\s+(\d{2}\/\d{2}\/\d{4})/i) ||
        primeiro(pg, /Data da Liquidacao:?\s*(\d{2}\/\d{2}\/\d{4})/i) ||
        primeiro(pg, /(?:valores?|calculo)s? atualizad[oa]s? (?:ate|para|em)\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (a) definir('dataLiquidacao', isoDeBr(a.valor), a);

    var temIpcaE = primeiro(pg, /(IPCA-E)/);
    var temSelic = primeiro(pg, /(SELIC)/);
    if (temIpcaE && temSelic) definir('indiceHomologado', 'IPCA-E+SELIC', primeiro(pg, /(IPCA-E[^.\n]{0,80}SELIC)/) || temSelic);
    else if (temSelic) definir('indiceHomologado', 'SELIC', temSelic);
    else if (temIpcaE) definir('indiceHomologado', 'IPCA-E', temIpcaE);
    else if ((a = primeiro(pg, /\b(INPC|IGP-M|IGP-DI|INCC|IPCA)\b/))) definir('indiceHomologado', a.valor, a);
    else if ((a = primeiro(pg, /(poupanca)/i))) definir('indiceHomologado', 'POUPANCA', a);

    definir('taxaJuros', dados.servidorPublico === 'S' ? 'servidor' : 'legais');

    // Verba principal
    // Espelho: "Possui IR  Valor IR  Possui Previdência ... / Sim  2.421,71  Não  0,00" — a 2ª coluna Sim/Não é a previdência.
    var aPrev = primeiro(pg, /Possui IR\s+Valor IR\s+Possui Previdencia[\s\S]{0,80}?\b(?:Sim|Nao)\b\s+[\d.]+,\d{2}\s+\b(Sim|Nao)\b/i, 1);
    var abono = assunto && /abono de permanencia/i.test(semAcento(assunto.valor));
    var temPrev = aPrev ? /sim/i.test(aPrev.valor) : (dados.servidorPublico === 'S' && !abono);
    if (dados.valorLiquidacao) {
      dados.verbas = [{
        descricao: assunto ? nomeProprio(assunto.valor) : 'Principal',
        valor: dados.valorLiquidacao,
        juros: '0,00',
        ir: 'S',
        previdencia: temPrev ? 'S' : 'N'
      }];
      evid.verbas = { valor: 1, fonte: assunto ? fonte(assunto.pagina) : '', trecho: 'Verba pelo assunto do processo' + (assunto ? ': ' + assunto.valor : '') + '; valor homologado ' + dados.valorLiquidacao };
    }
    definir('taxaJurosPre', ['SELIC', 'IPCA-E+SELIC', 'POUPANCA'].indexOf(dados.indiceHomologado) !== -1 ? '0,00' : '');

    /* --- Enquadramento --- */
    a = primeiro(pg, /teto[^.\n]{0,60}RPV[^.]{0,80}?R\$\s*([\d.]+,\d{2})/i);
    if (a) definir('tetoRpv', a.valor, a);
    definir('renunciaExcedente', 'N');

    /* --- Tributação --- */
    definir('tipoPessoaTributo', dados.tipoPessoa || 'F');
    a = primeiro(pg, /RRA\?[\s\S]{0,120}?\b(Sim|Nao)\b\s+(\d{1,3})/i);
    var aRra = a;
    if (a && /sim/i.test(a.valor)) {
      definir('rra', 'S', a);
      var parc = a.pagina.busca.slice(a.inicio, a.fim).match(/(\d{1,3})\s*$/);
      if (parc) definir('parcelasRra', parc[1], a);
    } else if ((aRra = primeiro(pg, /(Rendimentos Recebidos Acumuladamente)/i))) {
      definir('rra', 'S', aRra);
    } else {
      definir('rra', 'N');
    }
    definir('possuiDependentes', 'N');
    definir('isencaoMolestia', aIsencao ? 'S' : 'N', aIsencao);
    if (aIsencao) definir('laudoJuntado', aLaudo ? 'S' : 'N', aLaudo);
    definir('rpps', temPrev ? 'S' : 'N', aPrev);

    /* --- Guias --- */
    if (dados.juizoOrigem) {
      var comarca = dados.juizoOrigem.match(/(?:de|da|do)\s+([A-ZÀ-Ú][\wÀ-ú ]+)$/);
      if (comarca) {
        dados.guiaMunicipio = comarca[1];
        if (evid.juizoOrigem) evid.guiaMunicipio = { valor: comarca[1], fonte: evid.juizoOrigem.fonte, trecho: 'Comarca do juízo de origem: ' + dados.juizoOrigem };
      }
    }

    /* --- Checagem de documentos (etapa Orientações) --- */
    // Prefere a ocorrência dentro de um documento juntado (com ID) à menção no índice do PJe.
    function doc(campo, padrao) {
      var lista = todos(pg, padrao);
      var x = lista.filter(function (o) { return o.pagina.docId; })[0] || lista[0];
      dados[campo] = !!x;
      if (x) evid[campo] = { valor: true, fonte: fonte(x.pagina), trecho: trecho(x.pagina, x.inicio, x.fim) };
    }
    doc('doc_sentenca', /(SENTENCA)\s*\n/);
    doc('doc_transito', /(Certidao (?:do |de )?Transito em Julgado)/i);
    doc('doc_calculo', /(demonstrativo|memoria de calculo|calculos? de liquidacao|planilha de calculo|CALCULO ATUALIZADO)/i);
    dados.doc_homologacao = !!aHomolog;
    if (aHomolog) evid.doc_homologacao = { valor: true, fonte: fonte(aHomolog.pagina), trecho: trecho(aHomolog.pagina, aHomolog.inicio, aHomolog.fim) };
    doc('doc_procuracao', /(PROCURACAO)/i);
    // Contrato: só conta se houver documento juntado com esse título no índice (a simples menção no texto não basta).
    var docContrato = documentos.filter(function (d) { return /contrato/i.test(semAcento(d.descricao)); })[0];
    dados.doc_contrato = !!docContrato;
    if (docContrato) evid.doc_contrato = { valor: true, fonte: 'ID ' + docContrato.id, trecho: docContrato.descricao };
    dados.doc_credor = !!dados.documento;
    if (evid.documento) evid.doc_credor = evid.documento;
    doc('doc_oficio', /(Oficio Requisitorio\s*n)/i);
    doc('doc_fichas', /(FICHA FINANCEIRA)/i);
    doc('doc_laudo', /(Laudo Medico Pericial|laudo pericial)/i);

    /* ---------- Pareceres por etapa ---------- */

    if (digitalizado) parecer('anexo', 'erro', 'O PDF parece ser digitalizado (pouco texto por página). A leitura automática depende de PDF com texto; preencha os campos manualmente.');

    // Orientações
    [['doc_transito', 'Certidão de trânsito em julgado'], ['doc_calculo', 'Cálculo de liquidação'], ['doc_homologacao', 'Decisão homologatória'], ['doc_sentenca', 'Sentença'], ['doc_procuracao', 'Procuração']].forEach(function (d) {
      parecer('orientacoes', dados[d[0]] ? 'ok' : 'alerta', (dados[d[0]] ? 'Localizado: ' : 'Não localizado no PDF: ') + d[1] + (evid[d[0]] ? ' (' + evid[d[0]].fonte + ')' : '') + '.');
    });

    // Processo
    if (classe) parecer('processo', 'info', 'Classe: ' + classe.valor + '.');
    if (assunto) parecer('processo', 'info', 'Assunto: ' + assunto.valor + (valorCausa ? ' — valor da causa R$ ' + valorCausa.valor : '') + '.');
    if (datasTransito.length > 1) {
      parecer('processo', 'alerta', 'Os autos citam datas de trânsito em julgado diferentes: ' + datasTransito.join(', ') + '. Foi usada ' + aTransito.valor + ' (certidão mais recente com data expressa, ' + fonte(aTransito.pagina) + ').');
      achados.push('Datas de trânsito em julgado divergentes: ' + datasTransito.join(', ') + '.');
    } else if (aTransito) parecer('processo', 'ok', 'Trânsito em julgado em ' + aTransito.valor + ' (' + fonte(aTransito.pagina) + ').');
    var espelhoRec = primeiro(pg, /Dt\. Receb\. Ente Devedor[\s\S]{0,120}?(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i, 2);
    if (espelhoRec && aTransito && espelhoRec.valor === aTransito.valor) {
      parecer('processo', 'alerta', 'No espelho do precatório, o campo "Dt. Receb. Ente Devedor" traz ' + espelhoRec.valor + ', que é a data do trânsito, e "Dt. Trânsito" está vazio. Os campos parecem trocados (' + fonte(espelhoRec.pagina) + ').');
      achados.push('Espelho do precatório com data de recebimento igual à do trânsito (campos possivelmente trocados).');
    }
    if (dados.possuiOficio === 'N') parecer('processo', 'info', 'Não há ofício requisitório expedido nos autos: os juros pós-inclusão não se aplicam.');
    if (existe(pg, /Central de Processamento (?:Eletronico|de Expedicoes)|CPE/)) parecer('processo', 'info', 'Os autos foram remetidos à CPE para cadastro no SRP e expedição da requisição.');

    // Partes
    if (credor) parecer('partes', dados.documento ? 'ok' : 'alerta', 'Credor: ' + nomeProprio(credor) + (dados.documento ? ' — documento ' + dados.documento + ' (dígito verificador conferido)' : ' — CPF/CNPJ não localizado') + '.');
    if (representante) parecer('partes', 'info', 'Credor representado por ' + nomeProprio(representante) + (curatela ? ', com certidão de interdição/curatela nos autos' : '') + '.');
    if (aLaudo) parecer('partes', 'ok', 'Laudo de moléstia grave nos autos: credor com preferência por doença grave (' + fonte(aLaudo.pagina) + ').');
    advogados.forEach(function (ad) { parecer('partes', ad.oab ? 'ok' : 'alerta', 'Advogado: ' + ad.nome + (ad.oab ? ' — OAB ' + ad.oab : ' — OAB não localizada') + '.'); });
    if (existe(pg, /conta corrente do patrono|procuracao especial para recebimento|poderes especiais para (?:receber|levantar)/i)) {
      parecer('partes', 'alerta', 'O pagamento foi requerido na conta do advogado. Confirme a procuração com poderes especiais para receber e dar quitação.');
      achados.push('Pagamento requerido na conta do advogado (procuração especial).');
    }

    // Cálculo
    if (melhor) parecer('calculo', 'ok', 'Valor homologado identificado: R$ ' + melhor + (dados.calculoFls ? ' (cálculo no ' + dados.calculoFls + ')' : '') + '.');
    if (aHomolog) parecer('calculo', 'ok', 'Decisão homologatória: "' + aHomolog.valor + '" (' + fonte(aHomolog.pagina) + ').');
    if (dados.indiceHomologado === 'IPCA-E+SELIC' || dados.indiceHomologado === 'SELIC') parecer('calculo', 'alerta', 'O cálculo usou SELIC, que já compreende correção e juros. O valor foi lançado integralmente como principal; separe os juros se o cálculo trouxer essa discriminação (manual 3.1.8).');
    if (existe(pg, /desagio/i)) {
      parecer('calculo', 'info', 'Houve proposta de acordo com deságio. Confira se o valor homologado é o integral ou o acordado.');
      achados.push('Proposta de acordo com deságio nos autos.');
    }

    // Atualização
    parecer('atualizacao', 'info', 'Os autos não trazem o fator do índice da Resolução 303/2019 para a data do cálculo. Ele é obtido no SRP; sem ele, a estimativa usa o valor homologado sem correção.');

    // Enquadramento
    if (dados.tetoRpv) parecer('enquadramento', 'ok', 'Teto de RPV citado nos autos: R$ ' + dados.tetoRpv + ' (' + evid.tetoRpv.fonte + ').');

    // Tributação
    if (aIsencao) parecer('tributacao', aLaudo ? 'ok' : 'alerta', 'Pedido de isenção de IR por moléstia grave' + (aLaudo ? ', com laudo pericial oficial (' + fonte(aLaudo.pagina) + ')' : ', sem laudo localizado') + '.');
    var irEspelho = primeiro(pg, /Possui IR\s+Valor IR[\s\S]{0,80}?\b(Sim|Nao)\b\s+([\d.]+,\d{2})/i, 2);
    if (irEspelho && aIsencao && R.numero(irEspelho.valor) > 0) {
      parecer('tributacao', 'alerta', 'O espelho do precatório registra IR de R$ ' + irEspelho.valor + ', apesar do pedido de isenção com laudo. Solicite a correção antes da expedição (' + fonte(irEspelho.pagina) + ').');
      achados.push('IR de R$ ' + irEspelho.valor + ' no espelho, apesar do laudo de isenção.');
    }
    if (dados.rra === 'S') parecer('tributacao', dados.parcelasRra ? 'ok' : 'alerta', 'RRA aplicável' + (dados.parcelasRra ? ' em ' + dados.parcelasRra + ' parcelas (' + evid.parcelasRra.fonte + ')' : '; quantidade de parcelas não localizada, informe o número de meses') + '.');
    if (aPrev) parecer('tributacao', 'ok', 'Incidência de previdência no espelho: ' + aPrev.valor + '.');

    // Guias
    if (dados.enteDevedor === 'estado_mt') parecer('guias', 'info', 'Ente devedor: Estado de Mato Grosso. As guias são emitidas na SEFAZ-MT quando houver retenção.');

    /* Campos não localizados (para o parecer da etapa de anexo) */
    var essenciais = { numero: 'Número do processo', juizoOrigem: 'Juízo de origem', enteDevedor: 'Ente devedor', dataTransito: 'Data do trânsito em julgado',
      nome: 'Credor', documento: 'CPF/CNPJ do credor', valorLiquidacao: 'Valor homologado', dataLiquidacao: 'Data da liquidação', indiceHomologado: 'Índice do cálculo' };
    var faltando = Object.keys(essenciais).filter(function (k) { return !dados[k]; }).map(function (k) { return essenciais[k]; });

    dados.obsProcesso = achados.length ? 'Pontos encontrados na análise automática:\n- ' + achados.join('\n- ') : '';

    dados._analise = {
      arquivo: { nome: arquivo && arquivo.name, tamanho: arquivo && arquivo.size, paginas: leitura.totalPaginas, caracteres: caracteres, digitalizado: digitalizado, analisadoEm: new Date().toISOString() },
      documentos: documentos.slice(0, 80),
      pareceres: pareceres,
      achados: achados,
      faltando: faltando,
      camposPreenchidos: Object.keys(evid).length
    };
    dados._evidencias = evid;
    return dados;
  }

  async function processar(arquivoOuBuffer, progresso) {
    var buffer = arquivoOuBuffer instanceof ArrayBuffer ? arquivoOuBuffer : await arquivoOuBuffer.arrayBuffer();
    if (progresso) progresso(0, 'Carregando o leitor de PDF…');
    var leitura = await lerPdf(buffer, progresso);
    if (progresso) progresso(1, 'Analisando o conteúdo…');
    return analisar(leitura, arquivoOuBuffer instanceof ArrayBuffer ? null : arquivoOuBuffer);
  }

  global.ExtratorProcesso = { processar: processar, lerPdf: lerPdf, analisar: analisar };
})(window);
