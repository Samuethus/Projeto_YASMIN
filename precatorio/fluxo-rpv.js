/*
 * Fluxo "Análise de RPV / Precatório — SRP 2.0 (TJMT)".
 * Cada etapa segue uma seção do "Manual Cadastro e Cálculo de RPV 1º Grau" (pasta manual/).
 * A ordem das etapas reproduz a sequência do manual: cadastro → cálculo → enquadramento →
 * tributação → guias → revisão.
 */
(function (global) {
  'use strict';

  var R = global.RegrasPrecatorio;
  var P = R.PARAMETROS;
  var esc = function (v) { return global.WizardPrecatorio.esc(v); };

  var SIM = 'S';
  var NAO = 'N';

  /* ---------- Valores derivados (compartilhados entre etapas) ---------- */

  function totaisVerbas(d) {
    var t = { principal: 0, juros: 0, total: 0, tributavelIr: 0, tributavelPrev: 0 };
    (d.verbas || []).forEach(function (v) {
      var principal = R.numero(v.valor);
      var juros = R.numero(v.juros);
      t.principal += principal;
      t.juros += juros;
      if (v.ir !== NAO) t.tributavelIr += principal + juros;
      if (v.previdencia === SIM) t.tributavelPrev += principal + juros;
    });
    t.total = R.arred(t.principal + t.juros);
    return t;
  }

  function atualizacao(d) {
    var t = totaisVerbas(d);
    return R.estimarAtualizacao({
      principal: t.principal, juros: t.juros,
      fatorCorrecao: d.fatorCorrecao, taxaJurosPre: d.taxaJurosPre, taxaJurosPos: d.taxaJurosPos
    });
  }

  function valorAtualizado(d) {
    return R.numero(d.valorAtualizadoInformado) || atualizacao(d).total;
  }

  function preferencial(d) {
    var idade = R.idade(d.nascimento);
    return (idade !== null && idade >= 60) || d.doencaGrave === SIM || d.deficiencia === SIM;
  }

  function enquadramento(d) {
    var e = R.enquadrar({
      valorAtualizado: valorAtualizado(d),
      tetoRpv: d.tetoRpv,
      alimentar: d.natureza === 'alimentar',
      preferencial: preferencial(d)
    });
    if (!e) return null;
    e.renuncia = e.tipo === 'PRECATORIO' && d.renunciaExcedente === SIM;
    e.final = e.renuncia ? 'RPV' : e.tipo;
    e.requisitado = e.renuncia ? e.teto : e.valor;
    return e;
  }

  function tributos(d) {
    var e = enquadramento(d);
    var bruto = e ? e.requisitado : valorAtualizado(d);
    var t = totaisVerbas(d);
    var propIr = t.total ? t.tributavelIr / t.total : 1;
    var propPrev = t.total ? t.tributavelPrev / t.total : 0;
    return R.calcularTributos({
      valorBruto: bruto,
      baseTributavel: R.arred(bruto * propIr),
      basePrevidencia: R.arred(bruto * propPrev),
      tipoPessoa: d.tipoPessoaTributo || d.tipoPessoa,
      simples: d.simples === SIM,
      rpps: d.rpps === SIM,
      aliquotaPrevidencia: d.aliquotaPrevidencia,
      tetoConstitucional: d.tetoConstitucional,
      tetoRgps: d.tetoRgps,
      rra: d.rra === SIM,
      parcelasRra: d.parcelasRra,
      dependentes: d.possuiDependentes === SIM ? d.qtdDependentes : 0,
      isencaoMolestia: d.isencaoMolestia === SIM,
      defensoria: false,
      honorarios: false
    });
  }

  function ente(d) {
    return P.entesDevedores[d.enteDevedor] || null;
  }

  /* ---------- Pequenos componentes de HTML ---------- */

  function tabela(titulo, linhas) {
    return '<div class="pw-cartao"><h4>' + titulo + '</h4><table class="pw-tabela">' + linhas.map(function (l) {
      return '<tr' + (l[2] ? ' class="destaque"' : '') + '><th>' + l[0] + '</th><td>' + l[1] + '</td></tr>';
    }).join('') + '</table></div>';
  }

  function nota(texto, tipo) {
    return '<div class="pw-nota ' + (tipo || '') + '">' + texto + '</div>';
  }

  function simNao(campo) {
    return { id: campo.id, tipo: 'simnao', rotulo: campo.rotulo, ajuda: campo.ajuda, obrigatorio: campo.obrigatorio !== false, se: campo.se, largura: campo.largura || 'meia', padrao: campo.padrao };
  }

  /* ---------- Parecer da análise automática (topo da lateral de cada etapa) ---------- */

  function parecerPadrao(d, ctx, v, etapa) {
    var an = d._analise;
    if (!an) return '';
    var itens = an.pareceres[etapa.id] || [];
    var campos = etapa.campos.filter(function (c) { return c.tipo !== 'aviso' && c.tipo !== 'arquivo'; });
    var extraidos = campos.filter(function (c) { return d._evidencias && d._evidencias[c.id]; }).length;
    var conclusao = v.erros.length
      ? { classe: 'erro', texto: 'Requer complemento: ' + v.erros.length + ' pendência(s) antes da aprovação.' }
      : v.alertas.length
        ? { classe: 'alerta', texto: 'Apto para aprovação, com ' + v.alertas.length + ' ponto(s) de atenção.' }
        : { classe: 'ok', texto: 'Apto para aprovação.' };
    return '<div class="pw-parecer-card"><div class="pw-parecer-topo"><span class="pw-selo">Parecer</span><span>' +
      (campos.length ? extraidos + ' de ' + campos.length + ' campos extraídos do PDF' : 'Análise automática') + '</span></div>' +
      (itens.length ? '<ul>' + itens.map(function (i) { return '<li class="' + i.tipo + '">' + esc(i.msg) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="pw-conclusao ' + conclusao.classe + '">' + conclusao.texto + '</p></div>';
  }

  /* ---------- Etapas ---------- */

  var etapas = [];

  // 0. Anexo do processo e análise automática
  etapas.push({
    id: 'anexo',
    titulo: 'Anexar o processo',
    curto: 'Anexo',
    descricao: 'Anexe os autos completos em PDF, exportados do PJe. O sistema lê todo o arquivo, preenche as informações exigidas pelo Manual RPV e emite um parecer em cada etapa. Sua tarefa é conferir e aprovar.',
    manual: {
      ref: 'Como funciona a análise automática',
      itens: [
        'O PDF é lido <strong>neste navegador</strong>; o arquivo não é enviado a nenhum servidor.',
        'Cada campo preenchido mostra o <strong>documento (ID do PJe) e a página</strong> de onde o valor foi extraído.',
        'Divergências encontradas nos autos aparecem no parecer da etapa correspondente.',
        'Funciona com PDF com texto, como o exportado pelo PJe. Documentos digitalizados (imagem) precisam de preenchimento manual.',
        'Você pode corrigir qualquer campo antes de aprovar; a correção fica sinalizada.'
      ]
    },
    campos: [
      { id: 'arquivoProcesso', tipo: 'arquivo', rotulo: 'Arraste o PDF do processo aqui ou clique para selecionar',
        ajuda: 'Autos completos exportados do PJe (PDF com texto).', aceitar: '.pdf,application/pdf',
        resumo: function (d) { return d._analise ? (d._analise.arquivo.nome || 'PDF') + ' — ' + d._analise.arquivo.paginas + ' páginas analisadas' : ''; },
        processar: function (arquivo, progresso) { return global.ExtratorProcesso.processar(arquivo, progresso); } },
      { id: 'semAnexo', tipo: 'checkbox', rotulo: 'Prosseguir sem anexar (preenchimento manual)', se: function (d) { return !d._analise; } }
    ],
    painel: function (d) {
      var an = d._analise;
      if (!an) return '';
      var a = an.arquivo;
      var html = tabela('Arquivo analisado', [
        ['Arquivo', esc(a.nome || '—')],
        ['Páginas', String(a.paginas)],
        ['Documentos do PJe identificados', String(an.documentos.length)],
        ['Campos preenchidos', String(an.camposPreenchidos), true],
        ['Analisado em', new Date(a.analisadoEm).toLocaleString('pt-BR')]
      ]);
      if (an.documentos.length) {
        html += '<details class="pw-cartao pw-docs"><summary>Documentos dos autos (' + an.documentos.length + ')</summary><table class="pw-tabela">' +
          an.documentos.map(function (doc) { return '<tr><th>ID ' + esc(doc.id) + '<br><small>' + esc(doc.data) + '</small></th><td>' + esc(doc.descricao) + '</td></tr>'; }).join('') + '</table></details>';
      }
      return html;
    },
    parecer: function (d, ctx, v) {
      var an = d._analise;
      if (!an) return '';
      var itens = (an.pareceres.anexo || []).slice();
      if (!an.faltando.length) itens.push({ tipo: 'ok', msg: 'Todas as informações essenciais do manual foram localizadas no PDF.' });
      an.achados.forEach(function (x) { itens.push({ tipo: 'alerta', msg: x }); });
      return '<div class="pw-parecer-card"><div class="pw-parecer-topo"><span class="pw-selo">Parecer geral</span><span>' + an.achados.length + ' ponto(s) encontrados nos autos</span></div>' +
        '<ul>' + itens.map(function (i) { return '<li class="' + i.tipo + '">' + esc(i.msg) + '</li>'; }).join('') + '</ul>' +
        '<p class="pw-conclusao ' + (v.erros.length ? 'erro' : 'ok') + '">' + (v.erros.length ? 'Leitura incompleta: complete os dados nas etapas seguintes.' : 'Leitura concluída. Siga etapa por etapa conferindo os pareceres e aprovando.') + '</p></div>';
    },
    validar: function (d) {
      var erros = [];
      var alertas = [];
      var an = d._analise;
      if (!an && !d.semAnexo) erros.push('Anexe o PDF do processo ou marque "Prosseguir sem anexar".');
      if (an) {
        if (an.arquivo.digitalizado) erros.push('O PDF não tem camada de texto suficiente para a leitura automática. Use o PDF exportado do PJe ou prossiga sem anexar.');
        an.faltando.forEach(function (f) { alertas.push('Não localizado no PDF: ' + f + '. Preencha na etapa correspondente.'); });
      }
      return { erros: erros, alertas: alertas };
    }
  });

  // 1. Orientações e checagem de documentos
  etapas.push({
    id: 'orientacoes',
    titulo: 'Orientações iniciais e documentos',
    curto: 'Orientações',
    descricao: 'Antes de cadastrar, confirme que o processo reúne os documentos que o manual exige. Precatórios e RPVs são ordens de pagamento de uma condenação <strong>transitada em julgado</strong> contra um ente público.',
    manual: {
      ref: 'Anexo — Definições e orientações',
      itens: [
        'O que define se o débito é <strong>RPV</strong> ou <strong>Precatório</strong> é o valor da obrigação, comparado ao teto do ente devedor.',
        '<strong>Precatórios</strong> são encaminhados ao Departamento Auxiliar da Presidência pelo SRP. <strong>RPVs</strong> tramitam no juízo da execução, inclusive para pagamento.',
        'Legislação: art. 100 da CF, Resolução 303/2019-CNJ, Lei 9.494/1997, Lei 11.960/2009 e Provimento 20/2020-CM (TJMT).',
        'Acesso ao sistema: <a href="' + P.linkSrp + '" target="_blank" rel="noopener">srp.tjmt.jus.br</a>.'
      ]
    },
    campos: [
      { id: 'doc_sentenca', tipo: 'checkbox', rotulo: 'Sentença ou acórdão condenatório' },
      { id: 'doc_transito', tipo: 'checkbox', rotulo: 'Certidão de trânsito em julgado', obrigatorio: true },
      { id: 'doc_calculo', tipo: 'checkbox', rotulo: 'Cálculo de liquidação (memória de cálculo)', obrigatorio: true },
      { id: 'doc_homologacao', tipo: 'checkbox', rotulo: 'Decisão que homologou o cálculo', obrigatorio: true },
      { id: 'doc_procuracao', tipo: 'checkbox', rotulo: 'Procuração do advogado' },
      { id: 'doc_contrato', tipo: 'checkbox', rotulo: 'Contrato de honorários assinado (só se houver pedido de destaque)' },
      { id: 'doc_credor', tipo: 'checkbox', rotulo: 'Documento do credor (CPF/CNPJ) e dados bancários' },
      { id: 'doc_oficio', tipo: 'checkbox', rotulo: 'Ofício requisitório e comprovante de recebimento pelo ente (se já expedido)' },
      { id: 'doc_fichas', tipo: 'checkbox', rotulo: 'Fichas financeiras ou comprovação dos meses da verba (para RRA)' },
      { id: 'doc_laudo', tipo: 'checkbox', rotulo: 'Laudo oficial de moléstia grave (se houver pedido de isenção de IR)' }
    ],
    painel: function () {
      return tabela('Como a análise está organizada', [
        ['1', 'Anexo do processo e leitura automática'],
        ['2', 'Orientações e documentos'],
        ['3', 'Dados do processo (manual 1.1)'],
        ['4', 'Credor e advogados (manual 1.1)'],
        ['5', 'Cálculo homologado (manual 1.2.1)'],
        ['6', 'Atualização e juros (manual 1.2.2)'],
        ['7', 'Enquadramento RPV × Precatório (Anexo)'],
        ['8', 'Tributação (manual 3.2)'],
        ['9', 'Guias e repasses (manual 2)'],
        ['10', 'Revisão e aprovação final']
      ]) + nota('Cada etapa só é liberada depois que a anterior estiver <strong>validada</strong> e <strong>aprovada</strong> por você. Os dados ficam salvos neste navegador até você limpar a análise.');
    },
    validar: function (d) {
      var alertas = [];
      if (!d.doc_sentenca) alertas.push('Sem a sentença/acórdão não é possível conferir o objeto da condenação.');
      if (!d.doc_procuracao) alertas.push('Sem procuração, não cadastre advogados nem dados bancários do patrono.');
      if (!d.doc_credor) alertas.push('O CPF/CNPJ do credor é necessário para a consulta à Receita Federal no SRP (manual 1.1).');
      return { alertas: alertas };
    }
  });

  // 2. Dados do processo
  etapas.push({
    id: 'processo',
    titulo: 'Dados do processo',
    curto: 'Processo',
    descricao: 'Informações gerais do cadastro da RPV/Precatório no SRP ("Cadastro" → "Lista de RPV" → "Novo RPV").',
    manual: {
      ref: 'Seções 1.1 e 1.2.2.1',
      itens: [
        '<strong>Número do processo:</strong> numeração única do processo.',
        '<strong>Juízo de origem:</strong> vara ou juizado no qual o processo tramita.',
        '<strong>Ente devedor:</strong> ente responsável pelo pagamento.',
        '<strong>Data de recebimento pelo ente devedor:</strong> encontrada em carimbos, AR ou certidão de entrega do ofício. Preencher <u>somente</u> quando o processo já possui ofício expedido.',
        '<strong>Data final do prazo constitucional:</strong> 2 meses (60 dias) após a data de recebimento do ofício requisitório (preenchida automaticamente).'
      ]
    },
    campos: [
      { id: 'numero', tipo: 'texto', rotulo: 'Número do processo (numeração única)', obrigatorio: true, placeholder: '0000000-00.0000.8.11.0000', largura: 'meia' },
      { id: 'descricaoAcao', tipo: 'selecao', rotulo: 'Descrição da ação', obrigatorio: true, largura: 'meia', padrao: 'cumprimento',
        opcoes: [{ valor: 'cumprimento', rotulo: 'Cumprimento de sentença' }, { valor: 'execucao', rotulo: 'Execução contra a Fazenda Pública' }, { valor: 'outra', rotulo: 'Outra' }] },
      { id: 'juizoOrigem', tipo: 'texto', rotulo: 'Juízo de origem', obrigatorio: true, placeholder: 'Ex.: Juizados Especiais de Cáceres', largura: 'meia' },
      { id: 'enteDevedor', tipo: 'selecao', rotulo: 'Ente devedor', obrigatorio: true, largura: 'meia',
        opcoes: Object.keys(P.entesDevedores).map(function (k) { return { valor: k, rotulo: P.entesDevedores[k].nome }; }) },
      { id: 'enteNome', tipo: 'texto', rotulo: 'Nome do ente devedor', obrigatorio: true, largura: 'meia', placeholder: 'Ex.: Município de Cáceres',
        se: function (d) { return d.enteDevedor === 'municipio' || d.enteDevedor === 'outro'; } },
      { id: 'natureza', tipo: 'selecao', rotulo: 'Natureza do crédito', obrigatorio: true, largura: 'meia',
        ajuda: 'Alimentar: salários, vencimentos, proventos, pensões, benefícios previdenciários, indenizações por morte ou invalidez e honorários (art. 100, § 1º, CF; SV 47).',
        opcoes: [{ valor: 'alimentar', rotulo: 'Alimentar' }, { valor: 'comum', rotulo: 'Comum' }] },
      { id: 'dataAjuizamento', tipo: 'data', rotulo: 'Data do ajuizamento', largura: 'terco' },
      { id: 'dataTransito', tipo: 'data', rotulo: 'Data do trânsito em julgado', obrigatorio: true, largura: 'terco' },
      { id: 'calculoFls', tipo: 'texto', rotulo: 'Cálculo de liquidação às fls. / ID', largura: 'terco', placeholder: 'Ex.: ID 240369846' },
      simNao({ id: 'possuiOficio', rotulo: 'O processo já possui ofício requisitório expedido?', largura: 'inteira' }),
      { id: 'numeroOficio', tipo: 'texto', rotulo: 'Nº do ofício requisitório', largura: 'terco', se: function (d) { return d.possuiOficio === SIM; } },
      { id: 'oficioFls', tipo: 'texto', rotulo: 'Ofício acostado às fls. / ID', largura: 'terco', se: function (d) { return d.possuiOficio === SIM; } },
      { id: 'dataRecebimentoOficio', tipo: 'data', rotulo: 'Data de recebimento pelo ente devedor', obrigatorio: true, largura: 'terco', se: function (d) { return d.possuiOficio === SIM; } },
      { id: 'obsProcesso', tipo: 'area', rotulo: 'Observações', placeholder: 'Divergências encontradas nos autos, decisões relevantes etc.' }
    ],
    painel: function (d) {
      var linhas = [];
      var cnj = R.validarNumeroCnj(d.numero);
      if (cnj.ok) linhas.push(['Número', cnj.formatado], ['Tribunal', cnj.tjmt ? 'TJMT (8.11)' : 'Outro tribunal']);
      if (d.dataTransito) linhas.push(['Trânsito em julgado', R.dataBr(d.dataTransito)]);
      if (d.possuiOficio === SIM && d.dataRecebimentoOficio) {
        linhas.push(['Recebimento do ofício', R.dataBr(d.dataRecebimentoOficio)]);
        linhas.push(['Fim do prazo constitucional (RPV)', R.dataBr(R.prazoFinalRpv(d.dataRecebimentoOficio)), true]);
        linhas.push(['Exercício de pagamento (se precatório)', String(R.exercicioPagamentoPrecatorio(d.dataRecebimentoOficio))]);
      }
      return linhas.length ? tabela('Resumo do processo', linhas) : '';
    },
    validar: function (d) {
      var erros = [];
      var alertas = [];
      var hoje = R.hoje();
      if (d.numero) {
        var cnj = R.validarNumeroCnj(d.numero);
        if (!cnj.ok) erros.push('Número do processo: ' + cnj.motivo + '.');
        else if (!cnj.tjmt) alertas.push('O número não pertence ao TJMT (segmento 8.11). Confirme se o SRP do TJMT é o sistema correto.');
      }
      var transito = R.data(d.dataTransito);
      var ajuiz = R.data(d.dataAjuizamento);
      if (transito && transito > hoje) erros.push('A data do trânsito em julgado não pode ser futura.');
      if (transito && ajuiz && ajuiz > transito) erros.push('A data do ajuizamento é posterior ao trânsito em julgado.');
      if (d.possuiOficio === SIM) {
        var rec = R.data(d.dataRecebimentoOficio);
        if (rec && rec > hoje) erros.push('A data de recebimento do ofício não pode ser futura.');
        if (rec && transito && rec < transito) alertas.push('O ofício foi recebido antes do trânsito em julgado. Verifique as datas (no exemplo, o espelho trouxe a data do trânsito no campo de recebimento).');
        if (!d.numeroOficio) alertas.push('Informe o número do ofício requisitório (manual 1.2.2.1, item 5).');
      }
      if (!d.calculoFls) alertas.push('Informe a folha/ID do cálculo de liquidação (manual 1.2.2.1, item 7).');
      return { erros: erros, alertas: alertas };
    }
  });

  // 3. Credor e advogados
  etapas.push({
    id: 'partes',
    titulo: 'Credor e advogados',
    curto: 'Partes',
    descricao: 'Cadastro da parte interessada (credor) e dos advogados. No SRP, nome, data de nascimento e óbito são buscados na Receita Federal a partir do CPF/CNPJ.',
    manual: {
      ref: 'Seções 1.1, 3.1.5 e 3.2',
      itens: [
        '<strong>Tipo de pessoa:</strong> informar se o credor é pessoa física ou jurídica.',
        '<strong>Possui cessão:</strong> informar se o credor cedeu seu crédito.',
        'Os advogados são cadastrados pelo CPF do patrono; o sistema consulta a inscrição na OAB.',
        '<strong>Honorários contratuais</strong> são destacados do valor do credor, e só quando o contrato assinado está juntado aos autos.',
        '<strong>Honorários sucumbenciais</strong> são acrescidos à condenação e podem ser requisitados separadamente (o advogado pode receber por RPV enquanto o cliente recebe por precatório).'
      ]
    },
    campos: [
      { id: 'tipoPessoa', tipo: 'selecao', rotulo: 'Tipo de pessoa', obrigatorio: true, largura: 'terco', padrao: 'F',
        opcoes: [{ valor: 'F', rotulo: 'Física' }, { valor: 'J', rotulo: 'Jurídica' }] },
      { id: 'documento', tipo: 'texto', rotulo: 'CPF / CNPJ', obrigatorio: true, largura: 'terco', placeholder: 'Somente números' },
      { id: 'nascimento', tipo: 'data', rotulo: 'Data de nascimento', largura: 'terco', se: function (d) { return d.tipoPessoa !== 'J'; } },
      { id: 'nome', tipo: 'texto', rotulo: 'Nome / razão social', obrigatorio: true },
      { id: 'representante', tipo: 'texto', rotulo: 'Representante legal (se houver)', placeholder: 'Ex.: curador(a), inventariante', se: function (d) { return d.tipoPessoa !== 'J'; } },
      simNao({ id: 'falecido', rotulo: 'Credor falecido?', padrao: NAO, largura: 'terco' }),
      simNao({ id: 'cessao', rotulo: 'Possui cessão de crédito?', padrao: NAO, largura: 'terco' }),
      simNao({ id: 'servidorPublico', rotulo: 'Verba remuneratória de servidor público?', largura: 'terco',
        ajuda: 'Define a taxa de juros ("Juros Servidor") e a possível incidência de previdência (RPPS).' }),
      { id: 'cessionario', tipo: 'texto', rotulo: 'Cessionário', obrigatorio: true, se: function (d) { return d.cessao === SIM; } },
      { id: 'aviso-pref', tipo: 'aviso', html: '<h4 class="pw-subtitulo">Preferências (art. 100, § 2º, CF)</h4>', se: function (d) { return d.tipoPessoa !== 'J'; } },
      simNao({ id: 'doencaGrave', rotulo: 'Portador de doença grave?', padrao: NAO, se: function (d) { return d.tipoPessoa !== 'J'; } }),
      simNao({ id: 'deficiencia', rotulo: 'Pessoa com deficiência?', padrao: NAO, se: function (d) { return d.tipoPessoa !== 'J'; } }),
      { id: 'aviso-adv', tipo: 'aviso', html: '<h4 class="pw-subtitulo">Advogados e honorários</h4>' },
      { id: 'advogados', tipo: 'lista', rotulo: 'Advogados do processo', rotuloItem: 'Advogado',
        colunas: [
          { id: 'nome', tipo: 'texto', rotulo: 'Nome', obrigatorio: true, largura: 'inteira' },
          { id: 'oab', tipo: 'texto', rotulo: 'OAB', obrigatorio: true, largura: 'meia', placeholder: '00000/O' },
          { id: 'cpf', tipo: 'texto', rotulo: 'CPF', largura: 'meia' }
        ] },
      simNao({ id: 'honorariosContratuais', rotulo: 'Há pedido de destaque de honorários contratuais?', padrao: NAO }),
      simNao({ id: 'honorariosSucumbenciais', rotulo: 'Há honorários sucumbenciais?', padrao: NAO }),
      { id: 'percContratual', tipo: 'numero', rotulo: 'Percentual contratual', sufixo: '%', obrigatorio: true, largura: 'meia', se: function (d) { return d.honorariosContratuais === SIM; } },
      simNao({ id: 'contratoJuntado', rotulo: 'O contrato assinado está juntado aos autos?', se: function (d) { return d.honorariosContratuais === SIM; } }),
      { id: 'valorSucumbencia', tipo: 'moeda', rotulo: 'Valor dos honorários sucumbenciais', obrigatorio: true, largura: 'meia', se: function (d) { return d.honorariosSucumbenciais === SIM; } }
    ],
    painel: function (d) {
      var linhas = [];
      var idade = R.idade(d.nascimento);
      if (idade !== null) linhas.push(['Idade do credor', idade + ' anos']);
      linhas.push(['Credor preferencial', preferencial(d) ? 'Sim' : 'Não', preferencial(d)]);
      linhas.push(['Taxa de juros indicada', d.servidorPublico === SIM ? 'Juros Servidor' : 'Juros Legais']);
      if (d.honorariosContratuais === SIM) linhas.push(['Destaque contratual', R.percentual(d.percContratual)]);
      return tabela('Leitura dos dados', linhas);
    },
    validar: function (d) {
      var erros = [];
      var alertas = [];
      var doc = String(d.documento || '').replace(/\D/g, '');
      if (doc) {
        if (d.tipoPessoa === 'J' ? !R.validarCnpj(doc) : !R.validarCpf(doc)) erros.push((d.tipoPessoa === 'J' ? 'CNPJ' : 'CPF') + ' inválido (dígito verificador não confere).');
      }
      if (d.tipoPessoa !== 'J' && !d.nascimento) alertas.push('Sem a data de nascimento não é possível verificar a preferência por idade (60 anos ou mais).');
      if (d.falecido === SIM) alertas.push('Credor falecido: o crédito depende de habilitação dos sucessores antes da requisição.');
      if (d.cessao === SIM) alertas.push('Cessão de crédito: cadastre o cessionário no bloco "Cessões de Crédito" do módulo de cálculo.');
      if (d.honorariosContratuais === SIM) {
        if (d.contratoJuntado === NAO) erros.push('O destaque dos honorários contratuais só é feito com o contrato assinado juntado aos autos (manual 3.1.5).');
        if (R.numero(d.percContratual) >= 50) alertas.push('Percentual contratual igual ou superior a 50%: confira se a decisão do processo autoriza o destaque nesse patamar.');
      }
      (d.advogados || []).forEach(function (a, i) {
        if (a.cpf && !R.validarCpf(a.cpf)) erros.push('CPF do advogado ' + (i + 1) + ' inválido.');
      });
      if ((d.honorariosContratuais === SIM || d.honorariosSucumbenciais === SIM) && !(d.advogados || []).length) erros.push('Cadastre o advogado beneficiário dos honorários.');
      return { erros: erros, alertas: alertas };
    }
  });

  // 4. Cálculo homologado
  etapas.push({
    id: 'calculo',
    titulo: 'Cálculo homologado',
    curto: 'Cálculo',
    descricao: 'Transcreva o cálculo de liquidação homologado pelo magistrado, separando <strong>principal corrigido</strong> e <strong>juros moratórios</strong> de cada verba.',
    manual: {
      ref: 'Seções 1.2.1, 1.2.2.2, 3.1.4, 3.1.6 e 3.1.8',
      itens: [
        '<strong>Valor da liquidação:</strong> valor do cálculo homologado pelo magistrado. <strong>Data da liquidação:</strong> data para a qual esse cálculo foi atualizado.',
        'Informe a verba pleiteada, o principal corrigido (sem juros) e os juros moratórios apurados. <strong>A soma dos dois deve ser igual ao valor da liquidação.</strong>',
        'Imposto de renda e previdência vêm preenchidos para verbas pré-cadastradas; para a verba "Principal" ou descrição manual, informe a incidência.',
        'Se o cálculo homologado usou índice que já compreende juros (<strong>SELIC</strong> ou <strong>poupança</strong>), é preciso separar a correção apurada antes de atualizar.',
        'Para cadastrar um novo tipo de verba no SRP, envie e-mail para <a href="mailto:' + P.emailVerbasSrp + '">' + P.emailVerbasSrp + '</a>.'
      ]
    },
    campos: [
      { id: 'valorLiquidacao', tipo: 'moeda', rotulo: 'Valor da liquidação (homologado)', obrigatorio: true, largura: 'meia' },
      { id: 'dataLiquidacao', tipo: 'data', rotulo: 'Data da liquidação', obrigatorio: true, largura: 'meia' },
      { id: 'indiceHomologado', tipo: 'selecao', rotulo: 'Índice usado no cálculo homologado', obrigatorio: true, largura: 'meia',
        opcoes: [
          { valor: 'IPCA-E', rotulo: 'IPCA-E' }, { valor: 'IPCA', rotulo: 'IPCA' }, { valor: 'INPC', rotulo: 'INPC' },
          { valor: 'INCC', rotulo: 'INCC' }, { valor: 'IGP-M', rotulo: 'IGP-M' }, { valor: 'IGP-DI', rotulo: 'IGP-DI' },
          { valor: 'TR', rotulo: 'TR' }, { valor: 'SELIC', rotulo: 'SELIC' }, { valor: 'POUPANCA', rotulo: 'Poupança' },
          { valor: 'IPCA-E+SELIC', rotulo: 'IPCA-E até a citação + SELIC depois' }, { valor: 'OUTRO', rotulo: 'Outro' }
        ] },
      { id: 'taxaJuros', tipo: 'selecao', rotulo: 'Taxa de juros no SRP', obrigatorio: true, largura: 'meia',
        padrao: function (d) { return d.servidorPublico === SIM ? 'servidor' : 'legais'; },
        ajuda: '"Juros Servidor" para verbas remuneratórias de servidor público; "Juros Legais" nos demais casos.',
        opcoes: [{ valor: 'legais', rotulo: 'Juros Legais' }, { valor: 'servidor', rotulo: 'Juros Servidor' }] },
      { id: 'verbas', tipo: 'lista', rotulo: 'Verbas do cálculo (bloco Correção Monetária)', rotuloItem: 'Verba', obrigatorio: true,
        ajuda: 'Uma linha por verba. "Valor" é o principal corrigido, sem juros.',
        colunas: [
          { id: 'descricao', tipo: 'texto', rotulo: 'Descrição da verba', obrigatorio: true, largura: 'inteira', placeholder: 'Ex.: Diferença salarial' },
          { id: 'valor', tipo: 'moeda', rotulo: 'Valor (principal corrigido)', obrigatorio: true, largura: 'meia' },
          { id: 'juros', tipo: 'moeda', rotulo: 'Valor dos juros moratórios', largura: 'meia', padrao: '0,00' },
          { id: 'ir', tipo: 'simnao', rotulo: 'Incide imposto de renda?', largura: 'meia', padrao: SIM },
          { id: 'previdencia', tipo: 'simnao', rotulo: 'Incide previdência?', largura: 'meia', padrao: NAO }
        ] }
    ],
    painel: function (d) {
      var t = totaisVerbas(d);
      var liq = R.numero(d.valorLiquidacao);
      var dif = R.arred(t.total - liq);
      return tabela('Conferência do cálculo', [
        ['Principal corrigido', R.moeda(t.principal)],
        ['Juros moratórios', R.moeda(t.juros)],
        ['Soma das verbas', R.moeda(t.total), true],
        ['Valor da liquidação', R.moeda(liq)],
        ['Diferença', dif === 0 ? 'Confere ✓' : R.moeda(dif)]
      ]) + tabela('Parâmetros para o SRP', [
        ['Índice de correção', P.indiceCorrecaoSrp],
        ['Taxa de juros', d.taxaJuros === 'servidor' ? 'Juros Servidor' : 'Juros Legais']
      ]);
    },
    validar: function (d) {
      var erros = [];
      var alertas = [];
      var t = totaisVerbas(d);
      var liq = R.numero(d.valorLiquidacao);
      if ((d.verbas || []).length && liq && Math.abs(t.total - liq) > 0.01) {
        erros.push('A soma de principal + juros das verbas (' + R.moeda(t.total) + ') deve ser igual ao valor da liquidação (' + R.moeda(liq) + ') — manual 1.2.2.2, item 8.');
      }
      var dl = R.data(d.dataLiquidacao);
      if (dl && dl > R.hoje()) erros.push('A data da liquidação não pode ser futura.');
      var transito = R.data(d.dataTransito);
      if (dl && transito && dl > transito) alertas.push('Data da liquidação posterior ao trânsito: comum no cumprimento de sentença, apenas confirme a data-base do cálculo.');
      if (['SELIC', 'POUPANCA', 'IPCA-E+SELIC'].indexOf(d.indiceHomologado) !== -1) {
        alertas.push('O índice homologado (' + d.indiceHomologado + ') já compreende juros. Separe a correção apurada entre principal e juros antes de lançar no SRP (manual 3.1.8).');
      }
      if (d.servidorPublico === SIM && d.taxaJuros === 'legais') alertas.push('Credor marcado como servidor público, mas a taxa escolhida é "Juros Legais".');
      if (d.servidorPublico === NAO && d.taxaJuros === 'servidor') alertas.push('"Juros Servidor" só se aplica a verbas remuneratórias de servidor público.');
      (d.verbas || []).forEach(function (v, i) {
        if (R.numero(v.juros) > R.numero(v.valor)) alertas.push('Verba ' + (i + 1) + ': juros maiores que o principal. Confira a separação.');
      });
      return { erros: erros, alertas: alertas };
    }
  });

  // 5. Atualização e juros
  etapas.push({
    id: 'atualizacao',
    titulo: 'Atualização e juros',
    curto: 'Atualização',
    descricao: 'Períodos de correção monetária e de juros que o módulo de cálculo do SRP vai aplicar. Informe o fator do índice e as taxas do período para obter uma estimativa do valor atualizado.',
    manual: {
      ref: 'Seções 1.2.2.1, 1.2.2.2, 3.1.6 e 3.1.7',
      itens: [
        '<strong>Correção monetária:</strong> da data da liquidação até a data do cálculo, durante todo o período.',
        '<strong>Juros pré-inclusão:</strong> da data da liquidação até o recebimento do ofício (ou até a data do cálculo, se não houver ofício).',
        '<strong>Período de graça:</strong> entre o recebimento do ofício e o fim do prazo constitucional (2 meses) não fluem juros (Súmula Vinculante 17).',
        '<strong>Juros pós-inclusão:</strong> a partir do dia seguinte ao fim do prazo, quando o ente não pagou. Sem ofício, não são calculados.',
        'Os débitos da Fazenda Pública são remunerados com <strong>juros simples</strong>.'
      ]
    },
    campos: [
      { id: 'dataCalculo', tipo: 'data', rotulo: 'Data do cálculo', obrigatorio: true, largura: 'meia', padrao: function () { return R.iso(R.hoje()); },
        ajuda: 'Geralmente a data de hoje; o SRP aceita datas retroativas.' },
      { id: 'fatorCorrecao', tipo: 'numero', rotulo: 'Fator acumulado do índice no período', largura: 'meia', placeholder: 'Ex.: 1,0931147',
        ajuda: 'Índice "' + P.indiceCorrecaoSrp + '" acumulado entre a liquidação e o cálculo. Deixe vazio para não corrigir (fator 1).' },
      { id: 'taxaJurosPre', tipo: 'numero', rotulo: 'Taxa de juros pré-inclusão no período', sufixo: '%', largura: 'meia', placeholder: 'Ex.: 9,42' },
      { id: 'taxaJurosPos', tipo: 'numero', rotulo: 'Taxa de juros pós-inclusão no período', sufixo: '%', largura: 'meia', placeholder: 'Ex.: 4,84',
        se: function (d) { return d.possuiOficio === SIM; } },
      { id: 'aviso-estimar', tipo: 'aviso', html: '<button type="button" class="pw-btn pw-btn-sec pw-btn-peq" data-acao="executar" data-nome="estimarJuros">Preencher juros com o teto legal (0,5% a.m.)</button>' }
    ],
    acoes: {
      estimarJuros: function (d) {
        var per = R.periodos({ dataLiquidacao: d.dataLiquidacao, dataCalculo: d.dataCalculo, possuiOficio: d.possuiOficio === SIM, dataRecebimentoOficio: d.dataRecebimentoOficio });
        var fmt = function (n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
        d.taxaJurosPre = fmt(R.taxaJurosMaxima(per.jurosPre.dias));
        d.taxaJurosPos = per.jurosPos ? fmt(R.taxaJurosMaxima(per.jurosPos.dias)) : '0,00';
      }
    },
    painel: function (d) {
      if (!d.dataLiquidacao) return nota('Informe a data da liquidação na etapa anterior.', 'alerta');
      var per = R.periodos({ dataLiquidacao: d.dataLiquidacao, dataCalculo: d.dataCalculo, possuiOficio: d.possuiOficio === SIM, dataRecebimentoOficio: d.dataRecebimentoOficio });
      var faixa = function (p) { return p ? R.dataBr(p.inicio) + ' a ' + R.dataBr(p.fim) + ' (' + p.dias + ' dias)' : '—'; };
      var a = atualizacao(d);
      return tabela('Períodos (manual 1.2.2.2)', [
        ['Correção monetária', faixa(per.correcao)],
        ['Juros pré-inclusão', faixa(per.jurosPre)],
        ['Período de graça', per.graca ? faixa(per.graca) : 'Sem ofício expedido'],
        ['Juros pós-inclusão', per.jurosPos ? faixa(per.jurosPos) : 'Não se aplica']
      ]) + tabela('Estimativa do crédito atualizado', [
        ['Principal corrigido', R.moeda(a.principalCorrigido)],
        ['Juros do cálculo corrigidos', R.moeda(a.jurosCorrigidos)],
        ['Juros pré-inclusão', R.moeda(a.jurosPre)],
        ['Juros pós-inclusão', R.moeda(a.jurosPos)],
        ['Crédito atualizado em ' + R.dataBr(d.dataCalculo), R.moeda(a.total), true]
      ]) + nota('Estimativa para conferência. O valor oficial é o gerado pelo módulo de cálculo do SRP ("Imprimir cálculo").');
    },
    validar: function (d) {
      var erros = [];
      var alertas = [];
      var dc = R.data(d.dataCalculo);
      var dl = R.data(d.dataLiquidacao);
      if (dc && dl && dc < dl) erros.push('A data do cálculo é anterior à data da liquidação.');
      if (d.fatorCorrecao && R.numero(d.fatorCorrecao) <= 0) erros.push('O fator de correção deve ser maior que zero.');
      if (!d.fatorCorrecao) alertas.push('Fator de correção não informado: a estimativa considera o valor sem correção.');
      if (d.indiceHomologado === 'SELIC' || d.indiceHomologado === 'IPCA-E+SELIC') alertas.push('Cálculo homologado com SELIC: os juros já estão incorporados no período do cálculo. Não aplique juros pré-inclusão sobre esse mesmo período.');
      if (dl) {
        var per = R.periodos({ dataLiquidacao: d.dataLiquidacao, dataCalculo: d.dataCalculo, possuiOficio: d.possuiOficio === SIM, dataRecebimentoOficio: d.dataRecebimentoOficio });
        if (R.numero(d.taxaJurosPre) > R.taxaJurosMaxima(per.jurosPre.dias) + 0.01) alertas.push('Juros pré-inclusão acima do limite de 0,5% a.m. para o período (' + R.percentual(R.taxaJurosMaxima(per.jurosPre.dias)) + ').');
        if (per.jurosPos && R.numero(d.taxaJurosPos) > R.taxaJurosMaxima(per.jurosPos.dias) + 0.01) alertas.push('Juros pós-inclusão acima do limite de 0,5% a.m. para o período.');
        if (per.jurosPos) alertas.push('Prazo constitucional vencido: cálculo de mora após o período de graça (manual 3.1.7). Se o ente não pagou a RPV, o juízo pode determinar o bloqueio do valor.');
      }
      return { erros: erros, alertas: alertas };
    }
  });

  // 6. Enquadramento RPV × Precatório
  etapas.push({
    id: 'enquadramento',
    titulo: 'Enquadramento: RPV ou Precatório',
    curto: 'Enquadramento',
    descricao: 'Compara o valor atualizado com o teto de RPV do ente devedor. Pela Resolução 303/2019-CNJ, o teto é observado no momento da expedição do ofício, sobre o <strong>valor atualizado</strong>.',
    manual: {
      ref: 'Anexo — Tetos para pagamento de RPV',
      itens: [
        '<strong>INSS:</strong> 60 salários mínimos. <strong>Mato Grosso:</strong> 100 UPFs (variação mensal). <strong>Municípios:</strong> até 30 salários mínimos, nunca abaixo do maior benefício do RGPS.',
        'Acima do teto, o pagamento é por precatório. O crédito <strong>não pode ser desmembrado</strong>, mas o credor pode <strong>renunciar ao excedente</strong> para receber por RPV.',
        'Tetos vigentes por ente: <a href="' + P.linkTabelaRpv + '" target="_blank" rel="noopener">TJMT — Tabela RPV</a>.',
        'RPV não paga no prazo do ofício permite ao magistrado determinar o sequestro (bloqueio) do valor.'
      ]
    },
    campos: [
      { id: 'tetoRpv', tipo: 'moeda', rotulo: 'Teto de RPV do ente devedor', obrigatorio: true, largura: 'meia',
        padrao: function (d) { var e = ente(d); return e && e.tetoReferencia ? e.tetoReferencia.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : undefined; },
        ajuda: '' },
      { id: 'valorAtualizadoInformado', tipo: 'moeda', rotulo: 'Valor atualizado (se já tiver o cálculo do SRP)', largura: 'meia',
        ajuda: 'Deixe vazio para usar a estimativa da etapa anterior.' },
      { id: 'aviso-teto', tipo: 'aviso', html: function (d) { var e = ente(d); return e ? nota('<strong>' + esc(e.nome) + ':</strong> ' + esc(e.regraTeto) + '. ' + esc(e.fonteTeto)) : ''; } },
      simNao({ id: 'renunciaExcedente', rotulo: 'O credor renunciou ao valor excedente ao teto?', padrao: NAO, largura: 'inteira',
        se: function (d) { var e = enquadramento(d); return e && e.tipo === 'PRECATORIO'; } }),
      simNao({ id: 'procuracaoRenuncia', rotulo: 'Procuração com menos de 1 ano e poderes especiais para renunciar?', largura: 'inteira',
        se: function (d) { var e = enquadramento(d); return e && e.tipo === 'PRECATORIO' && d.renunciaExcedente === SIM; } })
    ],
    painel: function (d) {
      var e = enquadramento(d);
      if (!e) return nota('Informe o teto de RPV para ver o enquadramento.', 'alerta');
      var html = '<div class="pw-resultado ' + (e.final === 'RPV' ? 'rpv' : 'precatorio') + '"><span>Resultado</span><strong>' + (e.final === 'RPV' ? 'RPV' : 'Precatório') + '</strong>' +
        '<small>' + (e.final === 'RPV' ? 'Tramita no juízo da execução, inclusive para pagamento.' : 'Encaminhado ao Departamento Auxiliar da Presidência pelo SRP.') + '</small></div>';
      var linhas = [['Valor atualizado', R.moeda(e.valor)], ['Teto de RPV', R.moeda(e.teto)]];
      if (e.excedente) linhas.push(['Excedente ao teto', R.moeda(e.excedente)]);
      if (e.renuncia) linhas.push(['Valor requisitado (após renúncia)', R.moeda(e.requisitado), true]);
      if (e.superpreferencia && !e.renuncia) {
        linhas.push(['Parcela superpreferencial (até 3× o teto)', R.moeda(e.superpreferencia), true]);
        linhas.push(['Restante na ordem cronológica', R.moeda(e.restanteOrdem)]);
      }
      if (d.possuiOficio === SIM && d.dataRecebimentoOficio) {
        if (e.final === 'RPV') linhas.push(['Prazo para pagamento da RPV', R.dataBr(R.prazoFinalRpv(d.dataRecebimentoOficio))]);
        else linhas.push(['Exercício previsto de pagamento', String(R.exercicioPagamentoPrecatorio(d.dataRecebimentoOficio))]);
      } else if (e.final === 'PRECATORIO') {
        linhas.push(['Exercício previsto (se apresentado hoje)', String(R.exercicioPagamentoPrecatorio(R.iso(R.hoje())))]);
      }
      html += tabela('Detalhamento', linhas);
      if (d.honorariosSucumbenciais === SIM) {
        var suc = R.numero(d.valorSucumbencia);
        html += tabela('Honorários sucumbenciais (requisição própria)', [
          ['Valor', R.moeda(suc)],
          ['Enquadramento', suc <= e.teto ? 'RPV' : 'Precatório', true]
        ]);
      }
      if (e.final === 'PRECATORIO') html += nota('Precatório apresentado até 2 de abril é pago até o fim do exercício seguinte (art. 100, § 5º, CF).');
      return html;
    },
    validar: function (d) {
      var erros = [];
      var alertas = [];
      var e = enquadramento(d);
      if (!R.numero(d.tetoRpv) && d.tetoRpv) erros.push('Teto de RPV inválido.');
      if (e) {
        if (e.renuncia && d.procuracaoRenuncia !== SIM) erros.push('A renúncia ao excedente exige procuração atualizada (menos de 1 ano) com poderes especiais para renunciar.');
        if (e.tipo === 'PRECATORIO' && !e.renuncia && e.excedente < e.teto * 0.1) alertas.push('O valor supera o teto em menos de 10%: confirme se o credor foi consultado sobre a renúncia ao excedente.');
        if (e.superpreferencia && !e.renuncia) alertas.push('Credor preferencial com crédito alimentar: até ' + R.moeda(e.superpreferencia) + ' podem ser pagos com superpreferência. Comprove a condição (idade, doença grave ou deficiência) nos autos.');
      }
      var en = ente(d);
      if (en && en.tetoReferencia && R.numero(d.tetoRpv) !== en.tetoReferencia) alertas.push('Teto diferente do valor de referência cadastrado (' + R.moeda(en.tetoReferencia) + '). Confirme o valor vigente na Tabela RPV.');
      if (!d.valorAtualizadoInformado) alertas.push('Enquadramento feito sobre a estimativa. Confirme com o valor atualizado gerado pelo SRP.');
      return { erros: erros, alertas: alertas };
    }
  });

  // 7. Tributação
  etapas.push({
    id: 'tributacao',
    titulo: 'Tributação',
    curto: 'Tributação',
    descricao: 'Bloco "Tributações" do módulo de cálculo. A tributação é sempre informada e incide sobre o montante tributável; <strong>o valor pago ao credor é sempre líquido</strong>.',
    manual: {
      ref: 'Seções 1.2.1 (Tributos) e 3.2',
      itens: [
        '<strong>Previdência:</strong> só para credores do Regime Próprio (RPPS), sobre verbas salariais, alíquota de 11%. Não incide sobre honorários.',
        '<strong>Teto constitucional (TC):</strong> apenas para proventos de aposentadoria e pensão; deduz o teto do RGPS da base. <strong>TC2</strong> deduz o dobro, para portador de doença incapacitante.',
        '<strong>IRRF pessoa física:</strong> tabela progressiva da Receita Federal. <strong>PJ:</strong> 1,5%, ou isenta se optante pelo Simples.',
        '<strong>RRA</strong> (IN RFB 1.500/2014): aposentadoria, pensão, reserva/reforma e rendimentos do trabalho. Informe o número de meses a que o valor se refere.',
        'Informe também dependentes e quaisquer outras deduções determinadas no processo.'
      ]
    },
    campos: [
      { id: 'tipoPessoaTributo', tipo: 'selecao', rotulo: 'Tipo de pessoa que vai receber', obrigatorio: true, largura: 'meia',
        padrao: function (d) { return d.tipoPessoa; }, opcoes: [{ valor: 'F', rotulo: 'Física' }, { valor: 'J', rotulo: 'Jurídica' }] },
      simNao({ id: 'simples', rotulo: 'PJ optante pelo Simples Nacional?', se: function (d) { return d.tipoPessoaTributo === 'J'; },
        ajuda: '<a href="' + P.linkSimplesNacional + '" target="_blank" rel="noopener">Consultar no portal do Simples</a>' }),
      simNao({ id: 'rra', rotulo: 'Aplica RRA?', se: function (d) { return d.tipoPessoaTributo !== 'J'; } }),
      { id: 'parcelasRra', tipo: 'numero', rotulo: 'Quantidade de parcelas (meses)', obrigatorio: true, largura: 'meia', se: function (d) { return d.tipoPessoaTributo !== 'J' && d.rra === SIM; } },
      simNao({ id: 'possuiDependentes', rotulo: 'O credor possui dependentes?', padrao: NAO, se: function (d) { return d.tipoPessoaTributo !== 'J'; } }),
      { id: 'qtdDependentes', tipo: 'numero', rotulo: 'Quantidade de dependentes', obrigatorio: true, largura: 'meia', se: function (d) { return d.tipoPessoaTributo !== 'J' && d.possuiDependentes === SIM; } },
      simNao({ id: 'isencaoMolestia', rotulo: 'Isenção de IR por moléstia grave?', padrao: NAO, se: function (d) { return d.tipoPessoaTributo !== 'J'; },
        ajuda: 'Lei 7.713/88, art. 6º, XIV — exige laudo pericial oficial.' }),
      simNao({ id: 'laudoJuntado', rotulo: 'O laudo oficial está nos autos?', se: function (d) { return d.tipoPessoaTributo !== 'J' && d.isencaoMolestia === SIM; } }),
      simNao({ id: 'rpps', rotulo: 'Credor vinculado ao RPPS (incide previdência)?', padrao: function (d) { return d.servidorPublico === SIM ? undefined : NAO; }, se: function (d) { return d.tipoPessoaTributo !== 'J'; } }),
      { id: 'aliquotaPrevidencia', tipo: 'numero', rotulo: 'Porcentagem da previdência', sufixo: '%', obrigatorio: true, largura: 'meia', padrao: String(P.aliquotaPrevidencia),
        se: function (d) { return d.tipoPessoaTributo !== 'J' && d.rpps === SIM; } },
      { id: 'tetoConstitucional', tipo: 'selecao', rotulo: 'Teto constitucional (previdência)', largura: 'meia', padrao: 'NAO',
        se: function (d) { return d.tipoPessoaTributo !== 'J' && d.rpps === SIM; },
        opcoes: [{ valor: 'NAO', rotulo: 'Não' }, { valor: 'TC', rotulo: 'TC — teto do RGPS' }, { valor: 'TC2', rotulo: 'TC2 — dobro do teto (doença incapacitante)' }] },
      { id: 'tetoRgps', tipo: 'moeda', rotulo: 'Teto do RGPS', largura: 'meia', obrigatorio: true,
        padrao: P.tetoRgps.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), ajuda: P.tetoRgpsFonte,
        se: function (d) { return d.rpps === SIM && (d.tetoConstitucional === 'TC' || d.tetoConstitucional === 'TC2'); } }
    ],
    painel: function (d) {
      var t = tributos(d);
      var html = tabela('Deduções (estimativa)', [
        ['Valor bruto', R.moeda(t.bruto)],
        ['Dedução teto constitucional', R.moeda(t.deducaoTeto)],
        ['Previdência', R.moeda(t.previdencia)],
        ['Dedução dependentes', R.moeda(t.deducaoDependentes)],
        ['Base de cálculo IR', R.moeda(t.baseIr)],
        ['IRRF', R.moeda(t.irrf)],
        ['Alíquota efetiva', R.percentual(t.aliquotaEfetiva)],
        ['Valor líquido', R.moeda(t.liquido), true]
      ]);
      if (d.honorariosContratuais === SIM && R.numero(d.percContratual)) {
        var hon = R.arred(t.liquido * R.numero(d.percContratual) / 100);
        html += tabela('Destaque de honorários contratuais', [
          ['Honorários (' + R.percentual(d.percContratual) + ')', R.moeda(hon)],
          ['Valor ao credor', R.moeda(t.liquido - hon), true]
        ]);
      }
      if (t.observacoes.length) html += nota(t.observacoes.join('<br>'));
      html += nota('Tabela do IR ' + esc(P.tabelaIrrf.vigencia) + ' com redutor da Lei 15.270/2025. O SRP aplica a tabela vigente na data do cálculo.');
      return html;
    },
    validar: function (d) {
      var erros = [];
      var alertas = [];
      if (d.rra === SIM && R.numero(d.parcelasRra) < 1) erros.push('Informe ao menos 1 parcela para o RRA.');
      if (d.isencaoMolestia === SIM && d.laudoJuntado !== SIM) erros.push('A isenção por moléstia grave depende de laudo pericial oficial juntado aos autos.');
      if (d.isencaoMolestia === SIM) alertas.push('Confira se o espelho/cálculo do SRP não reteve IR apesar da isenção (no processo de exemplo, o espelho trouxe IR de R$ 2.421,71 mesmo com laudo de isenção).');
      if (d.tetoConstitucional === 'TC' || d.tetoConstitucional === 'TC2') alertas.push('Teto constitucional só se aplica a proventos de aposentadoria e pensão (art. 40, §§ 18 e 21, CF).');
      if (d.tetoConstitucional === 'TC2' && d.doencaGrave !== SIM) alertas.push('TC2 exige que o beneficiário seja portador de doença incapacitante; a etapa "Partes" não indica doença grave.');
      if (d.rpps === SIM && totaisVerbas(d).tributavelPrev === 0) alertas.push('Previdência marcada, mas nenhuma verba do cálculo tem incidência de previdência.');
      if (d.tipoPessoaTributo === 'F' && d.rra !== SIM && d.servidorPublico === SIM) alertas.push('Verba de servidor paga de forma acumulada normalmente segue o RRA. Confirme.');
      return { erros: erros, alertas: alertas };
    }
  });

  // 8. Guias e repasses
  etapas.push({
    id: 'guias',
    titulo: 'Guias e repasse de informações',
    curto: 'Guias',
    descricao: 'Emissão das guias de recolhimento dos tributos retidos e repasse de informações ao ente devedor.',
    manual: {
      ref: 'Seção 2 — Emissão de guias',
      itens: [
        '<strong>Estado de Mato Grosso:</strong> guias emitidas no site da SEFAZ-MT, em "Documento de Arrecadação e Pagamentos".',
        '<strong>Município:</strong> solicitar a guia à prefeitura, alertando que a <strong>data de vencimento deve ser futura</strong>.',
        'IRRF: "DAR-1 Diversos", tipo "1 – Dar-1 Tributos da apuração normal e taxas", receita "9326 – IRRF Precatório Justiça Comum".',
        'Previdência: "DAR-1 Órgãos" → SEFAZ, receita e sub-receita "7382 – Contrib. Previ. Funprev-Precat ou Dec. Jud.".',
        'Ao fim de cada ano, as secretarias enviam ao ente um relatório dos processos pagos, para a DIRF.'
      ]
    },
    campos: [
      { id: 'aviso-guias', tipo: 'aviso', html: function (d) {
        var e = enquadramento(d);
        var t = tributos(d);
        var partes = [];
        if (e && e.final === 'PRECATORIO') partes.push(nota('Crédito enquadrado como <strong>precatório</strong>: o valor é recalculado e as retenções de IR e previdência são apuradas pelo DAP no momento do pagamento.', 'info'));
        if (d.enteDevedor === 'estado_mt') {
          if (t.irrf > 0) partes.push(tabela('Guia de IRRF — SEFAZ-MT', [['Serviço', P.guias.irrf.servico], ['Tipo de venda', P.guias.irrf.tipoVenda], ['Especificação da receita', P.guias.irrf.receita], ['Valor estimado', R.moeda(t.irrf), true], ['Link', '<a href="' + P.guias.irrf.link + '" target="_blank" rel="noopener">Emitir DAR-1</a>']]));
          if (t.previdencia > 0) partes.push(tabela('Guia de previdência — SEFAZ-MT', [['Serviço', P.guias.previdencia.servico], ['Receita', P.guias.previdencia.receita], ['Sub-receita', P.guias.previdencia.subReceita], ['Valor estimado', R.moeda(t.previdencia), true], ['Link', '<a href="' + P.guias.previdencia.link + '" target="_blank" rel="noopener">Emitir DAR-1</a>']]));
          if (!t.irrf && !t.previdencia) partes.push(nota('Sem tributos retidos na estimativa: não há guias a emitir.'));
        } else if (d.enteDevedor) {
          partes.push(nota('Ente devedor não é o Estado de MT: solicite as guias diretamente ao ente, com data de vencimento futura.'));
        }
        return partes.join('');
      } },
      { id: 'guiaMunicipio', tipo: 'texto', rotulo: 'Município em que o processo corre', largura: 'meia', se: function (d) { return d.enteDevedor === 'estado_mt'; } },
      { id: 'guiaPeriodo', tipo: 'texto', rotulo: 'Mês de referência do tributo', placeholder: 'MM/AAAA', largura: 'meia', se: function (d) { return d.enteDevedor === 'estado_mt'; } },
      { id: 'guiaVencimento', tipo: 'data', rotulo: 'Data de vencimento da guia', largura: 'meia' },
      { id: 'guiaEmitida', tipo: 'checkbox', rotulo: 'Guias emitidas ou solicitadas ao ente' },
      { id: 'aviso-dirf', tipo: 'aviso', html: nota('Ao final de cada ano, o pagamento deve constar no relatório enviado ao ente devedor para a DIRF (manual 2.3).') }
    ],
    validar: function (d) {
      var erros = [];
      var alertas = [];
      var venc = R.data(d.guiaVencimento);
      if (venc && venc <= R.hoje()) erros.push('A data de vencimento da guia deve ser futura (manual 2).');
      if (d.guiaPeriodo && !/^(0[1-9]|1[0-2])\/\d{4}$/.test(d.guiaPeriodo)) erros.push('Mês de referência no formato MM/AAAA.');
      var e = enquadramento(d);
      var t = tributos(d);
      if (e && e.final === 'RPV' && (t.irrf > 0 || t.previdencia > 0) && !d.guiaEmitida) alertas.push('Há tributos a recolher: emita ou solicite as guias no momento do pagamento.');
      return { erros: erros, alertas: alertas };
    }
  });

  // 9. Revisão e aprovação final
  function formatarValor(campo, v) {
    var d = global.WizardPrecatorio.estado().dados;
    if (campo.tipo === 'arquivo') return d._analise ? esc(d._analise.arquivo.nome || 'PDF analisado') + ' (' + d._analise.arquivo.paginas + ' páginas)' : '<span class="pw-mudo">Sem anexo</span>';
    if (v === undefined || v === null || v === '') return '<span class="pw-mudo">—</span>';
    if (campo.tipo === 'simnao') return v === SIM ? 'Sim' : 'Não';
    if (campo.tipo === 'checkbox') return v ? '✓' : '—';
    if (campo.tipo === 'moeda') return R.moeda(v);
    if (campo.tipo === 'data') return R.dataBr(v);
    if (campo.tipo === 'selecao') {
      var o = campo.opcoes.filter(function (op) { return String(op.valor) === String(v); })[0];
      return esc(o ? o.rotulo : v);
    }
    if (campo.tipo === 'lista') return v.length + ' item(ns): ' + v.map(function (i) { return esc(i.descricao || i.nome || ''); }).join('; ');
    return esc(v) + (campo.sufixo ? ' ' + campo.sufixo : '');
  }

  etapas.push({
    id: 'revisao',
    titulo: 'Revisão e aprovação final',
    curto: 'Revisão',
    revisao: true,
    descricao: 'Confira o resumo de todas as etapas. A aprovação final registra data e hora e libera a exportação da análise.',
    campos: [
      { id: 'aviso-parecer-geral', tipo: 'aviso', html: function (d) {
        var an = d._analise;
        if (!an) return '';
        var editados = Object.keys(d._evidencias || {}).filter(function (k) { return d._evidencias[k].editado; });
        return '<div class="pw-parecer-card largo"><div class="pw-parecer-topo"><span class="pw-selo">Parecer final</span><span>Análise automática de ' + esc(an.arquivo.nome || 'PDF') + '</span></div><ul>' +
          '<li class="ok">' + an.camposPreenchidos + ' informações extraídas do PDF, cada uma com o documento e a página de origem.</li>' +
          (editados.length ? '<li class="info">' + editados.length + ' valor(es) extraído(s) corrigido(s) manualmente durante a revisão.</li>' : '') +
          an.achados.map(function (x) { return '<li class="alerta">' + esc(x) + '</li>'; }).join('') +
          '</ul></div>';
      } },
      { id: 'aviso-resultado', tipo: 'aviso', html: function (d) {
        var e = enquadramento(d);
        var t = tributos(d);
        return '<div class="pw-sintese">' +
          '<div><span>Classificação</span><strong>' + (e ? (e.final === 'RPV' ? 'RPV' : 'Precatório') : '—') + '</strong></div>' +
          '<div><span>Valor requisitado</span><strong>' + R.moeda(e ? e.requisitado : valorAtualizado(d)) + '</strong></div>' +
          '<div><span>Tributos retidos</span><strong>' + R.moeda(t.irrf + t.previdencia) + '</strong></div>' +
          '<div><span>Líquido ao credor</span><strong>' + R.moeda(t.liquido) + '</strong></div></div>';
      } },
      { id: 'aviso-resumo', tipo: 'aviso', html: function () {
        return global.WizardPrecatorio.resumo().map(function (r) {
          var linhas = r.campos.filter(function (c) { return c.tipo !== 'aviso'; }).map(function (c) {
            return '<tr><th>' + c.rotulo + '</th><td>' + formatarValor(c, global.WizardPrecatorio.estado().dados[c.id]) + '</td></tr>';
          }).join('');
          var status = r.aprovada ? '<span class="pw-tag ok">Aprovada em ' + new Date(r.aprovada).toLocaleString('pt-BR') + '</span>' : '<span class="pw-tag erro">Não aprovada</span>';
          var alertas = r.validacao.alertas.length ? '<ul class="pw-alertas-resumo">' + r.validacao.alertas.map(function (a) { return '<li>' + a.msg + '</li>'; }).join('') + '</ul>' : '';
          return '<details class="pw-resumo"><summary><span>' + esc(r.etapa.titulo) + '</span>' + status + (r.validacao.alertas.length ? '<span class="pw-tag alerta">' + r.validacao.alertas.length + ' ponto(s) de atenção</span>' : '') + '</summary>' +
            '<table class="pw-tabela">' + linhas + '</table>' + alertas + '</details>';
        }).join('');
      } },
      { id: 'responsavel', tipo: 'texto', rotulo: 'Responsável pela análise', largura: 'meia' },
      { id: 'obsFinais', tipo: 'area', rotulo: 'Parecer / observações finais' },
      { id: 'aviso-acoes', tipo: 'aviso', html: '<div class="pw-acoes-finais"><button type="button" class="pw-btn pw-btn-sec" data-acao="exportar">Exportar análise (JSON)</button><button type="button" class="pw-btn pw-btn-sec" data-acao="imprimir">Imprimir resumo</button></div>' }
    ],
    validar: function (d) {
      var erros = [];
      global.WizardPrecatorio.resumo().forEach(function (r) {
        if (!r.aprovada) erros.push('A etapa "' + r.etapa.titulo + '" ainda não foi aprovada.');
        r.validacao.erros.forEach(function (e) { erros.push(r.etapa.titulo + ': ' + e.msg); });
      });
      return { erros: erros, alertas: d.responsavel ? [] : ['Informe o responsável pela análise para registro no parecer.'] };
    }
  });

  // Todas as etapas exibem o parecer da análise automática, salvo as que definem o próprio.
  etapas.forEach(function (e) { if (!e.parecer && !e.revisao) e.parecer = parecerPadrao; });

  /* ---------- Processo de exemplo (autos em processo/, dados pessoais omitidos) ---------- */

  var exemplo = {
    semAnexo: true,
    doc_sentenca: true, doc_transito: true, doc_calculo: true, doc_homologacao: true, doc_procuracao: true,
    doc_credor: true, doc_fichas: true, doc_laudo: true,
    numero: '1007316-75.2025.8.11.0006',
    descricaoAcao: 'cumprimento',
    juizoOrigem: 'Juizados Especiais de Cáceres',
    enteDevedor: 'estado_mt',
    natureza: 'alimentar',
    dataAjuizamento: '2025-07-29',
    dataTransito: '2026-07-14',
    calculoFls: 'ID 240369846',
    possuiOficio: NAO,
    obsProcesso: 'Duas certidões de trânsito com datas diferentes (17/09/2026 e 16/10/2026, esta indicando 14/07/2026). Cálculo da PGE homologado por concordância das partes, sem deságio (sentença ID 245531151).',
    tipoPessoa: 'F',
    documento: '',
    nome: 'Credor do processo de exemplo (dados pessoais omitidos)',
    representante: 'Representado por curadora (certidão de interdição nos autos)',
    falecido: NAO, cessao: NAO, servidorPublico: SIM,
    doencaGrave: SIM, deficiencia: NAO,
    advogados: [],
    honorariosContratuais: NAO, honorariosSucumbenciais: NAO,
    valorLiquidacao: '76.582,63',
    dataLiquidacao: '2026-07-03',
    indiceHomologado: 'IPCA-E+SELIC',
    taxaJuros: 'servidor',
    verbas: [{ descricao: 'Abono de permanência', valor: '76.582,63', juros: '0,00', ir: SIM, previdencia: NAO }],
    fatorCorrecao: '',
    taxaJurosPre: '0,00',
    tetoRpv: '26.336,00',
    renunciaExcedente: NAO,
    tipoPessoaTributo: 'F',
    rra: SIM, parcelasRra: '23',
    possuiDependentes: NAO,
    isencaoMolestia: SIM, laudoJuntado: SIM,
    rpps: NAO
  };

  global.FluxosPrecatorio = global.FluxosPrecatorio || {};
  global.FluxosPrecatorio.rpv_srp = {
    id: 'rpv_srp',
    titulo: 'Análise de Precatório / RPV',
    subtitulo: 'SRP 2.0 · TJMT · Manual RPV 1º Grau',
    versao: '1.0.0',
    etapas: etapas,
    exemplo: exemplo
  };
})(window);
