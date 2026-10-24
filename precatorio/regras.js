/*
 * Regras de negócio da análise de RPV / Precatório.
 * Fonte principal: "Manual Cadastro e Cálculo de RPV 1º Grau" (TJMT / SRP 2.0) — pasta manual/.
 * Cada regra indica a seção do manual de onde foi extraída.
 *
 * Parâmetros que mudam com o tempo (tetos, tabela do IR, teto do RGPS) ficam em PARAMETROS,
 * para serem revisados sem mexer na lógica.
 */
(function (global) {
  'use strict';

  var PARAMETROS = {
    // Anexo do manual — "Tetos para pagamento de RPV". Valores em R$ são editáveis no wizard.
    entesDevedores: {
      estado_mt: {
        nome: 'Estado de Mato Grosso',
        regraTeto: '100 UPF/MT (variação mensal)',
        tetoReferencia: 26336.00,
        fonteTeto: 'Valor do teto de RPV informado pela PGE-MT nos autos do processo de exemplo (07/2026). Confirme na "Tabela RPV" do TJMT.',
        emiteGuiasSefaz: true
      },
      municipio: {
        nome: 'Município',
        regraTeto: 'Lei municipal — máximo de 30 salários mínimos, nunca inferior ao maior benefício do RGPS',
        tetoReferencia: null,
        fonteTeto: 'Consulte a lei do município na "Tabela RPV" do TJMT.',
        emiteGuiasSefaz: false
      },
      inss: {
        nome: 'INSS / União',
        regraTeto: '60 salários mínimos',
        tetoReferencia: null,
        fonteTeto: 'Informe 60 × salário mínimo vigente.',
        emiteGuiasSefaz: false
      },
      outro: {
        nome: 'Outro ente público',
        regraTeto: 'Conforme lei do ente',
        tetoReferencia: null,
        fonteTeto: 'Consulte a "Tabela RPV" do TJMT.',
        emiteGuiasSefaz: false
      }
    },

    linkTabelaRpv: 'http://www.tjmt.jus.br/OutrasAreas/C/20458',
    linkSrp: 'https://srp.tjmt.jus.br',
    linkSimplesNacional: 'http://www8.receita.fazenda.gov.br/simplesnacional/aplicacoes.aspx?id=21',
    emailVerbasSrp: 'calculorpv.dap@tjmt.jus.br',

    // Manual 1.2.2.1 item 11 e 3.1.1.
    indiceCorrecaoSrp: 'GERAL (NOVO) - Índice Precatório - Resolução 303/2019',

    // Manual 3.1.2 — histórico das taxas de juros.
    taxasJuros: [
      { regime: 'Juros Legais', vigencia: 'até 10/01/2003', taxa: '0,50% a.m.', base: 'Código Civil de 1916' },
      { regime: 'Juros Legais', vigencia: '11/01/2003 a 28/06/2009', taxa: '1,00% a.m.', base: 'Código Civil de 2002' },
      { regime: 'Juros Legais', vigencia: '29/06/2009 a 03/05/2012', taxa: '0,50% a.m.', base: 'Lei 11.960/2009' },
      { regime: 'Juros Legais', vigencia: 'a partir de 04/05/2012', taxa: '70% da Selic, limitada a 0,50% a.m.', base: 'MP 567/2012 (Lei 12.703/2012)' },
      { regime: 'Juros Servidor', vigencia: 'até 26/08/2001', taxa: '0,50% a.m.', base: 'Código Civil de 1916' },
      { regime: 'Juros Servidor', vigencia: '27/08/2001 a 28/06/2009', taxa: '0,50% a.m.', base: 'MP 2.180-35/2001' },
      { regime: 'Juros Servidor', vigencia: '29/06/2009 a 03/05/2012', taxa: '0,50% a.m.', base: 'Lei 11.960/2009' },
      { regime: 'Juros Servidor', vigencia: 'a partir de 04/05/2012', taxa: '70% da Selic, limitada a 0,50% a.m.', base: 'MP 567/2012 (Lei 12.703/2012)' }
    ],

    // Manual 3.1.4 — índices que já compreendem juros.
    indicesComJuros: ['SELIC', 'POUPANCA'],

    // Manual 3.2.1 — alíquota de contribuição ao RPPS.
    aliquotaPrevidencia: 11,

    // Manual 3.2.1.1 / 3.2.1.2 — teto do RGPS usado para TC e TC2 (o manual usa R$ 6.101,06, de 2020).
    tetoRgps: 8157.41,
    tetoRgpsFonte: 'Teto do RGPS de 2025. Atualize para o valor vigente na data do cálculo.',

    // Manual 3.2.2.1 — tabela progressiva mensal da Receita Federal.
    tabelaIrrf: {
      vigencia: 'a partir de 05/2025',
      faixas: [
        { ate: 2428.80, aliquota: 0, deduzir: 0 },
        { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
        { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
        { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
        { ate: Infinity, aliquota: 0.275, deduzir: 908.73 }
      ],
      deducaoDependente: 189.59,
      // Redução mensal da Lei 15.270/2025 (a partir de 01/2026). Confirmar antes de usar em produção.
      redutor: { ativo: true, isencaoAte: 5000.00, faixaAte: 7350.00, constante: 978.62, fator: 0.133145 }
    },

    // Manual 3.2.2.2 — PJ não optante pelo Simples.
    aliquotaIrPj: 1.5,

    // Manual 2.1 e 2.2 — códigos de receita SEFAZ-MT.
    guias: {
      irrf: { servico: 'DAR-1 Diversos', link: 'https://www.sefaz.mt.gov.br/arrecadacao/darlivre/menudarlivre', tipoVenda: '1 - Dar-1 TRIBUTOS DA APURAÇÃO NORMAL E TAXAS', receita: '9326 - IRRF PRECATÓRIO JUSTIÇA COMUM' },
      previdencia: { servico: 'DAR-1 Órgãos (órgão SEFAZ)', link: 'https://www.sefaz.mt.gov.br/arrecadacao/darlivre/menudarlivre?outrosOrgaos=true', receita: '7382 - CONTRIB.PREVI. FUNPREV-PRECAT OU DEC.JUD.', subReceita: '7382 - CONTRIB.PREVI. FUNPREV-PRECAT OU DEC.JUD.' }
    }
  };

  /* ---------- Conversões ---------- */

  function numero(valor) {
    if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
    if (!valor) return 0;
    var s = String(valor).replace(/[^\d,.-]/g, '');
    // Formato brasileiro: 1.234,56
    if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function moeda(valor) {
    return numero(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function percentual(valor, casas) {
    return numero(valor).toLocaleString('pt-BR', { minimumFractionDigits: casas || 2, maximumFractionDigits: casas || 2 }) + '%';
  }

  function arred(valor) {
    return Math.round(numero(valor) * 100) / 100;
  }

  function data(iso) {
    if (!iso) return null;
    var p = String(iso).split('-');
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d) ? null : d;
  }

  function iso(d) {
    if (!d) return '';
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function dataBr(valor) {
    var d = valor instanceof Date ? valor : data(valor);
    return d ? d.toLocaleDateString('pt-BR') : '—';
  }

  function somarMeses(d, meses) {
    var r = new Date(d.getFullYear(), d.getMonth() + meses, d.getDate());
    // Evita "pular" o mês quando o dia não existe (ex.: 31/12 + 2 meses).
    if (r.getDate() !== d.getDate()) r.setDate(0);
    return r;
  }

  function somarDias(d, dias) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias);
  }

  function dias(inicio, fim) {
    if (!inicio || !fim) return 0;
    return Math.round((fim - inicio) / 86400000);
  }

  function hoje() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /* ---------- Validações de documentos ---------- */

  // Numeração única CNJ (Res. CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO
  function validarNumeroCnj(valor) {
    var m = String(valor || '').trim().match(/^(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})$/);
    if (!m) return { ok: false, motivo: 'Formato esperado: NNNNNNN-DD.AAAA.J.TR.OOOO' };
    var base = m[1] + m[3] + m[4] + m[5] + m[6] + '00';
    var resto = 0;
    for (var i = 0; i < base.length; i++) resto = (resto * 10 + +base[i]) % 97;
    var dv = 98 - resto;
    if (dv !== +m[2]) return { ok: false, motivo: 'Dígito verificador inválido (esperado ' + String(dv).padStart(2, '0') + ')' };
    return {
      ok: true,
      formatado: m[1] + '-' + m[2] + '.' + m[3] + '.' + m[4] + '.' + m[5] + '.' + m[6],
      ano: +m[3],
      justicaEstadual: m[4] === '8',
      tjmt: m[4] === '8' && m[5] === '11'
    };
  }

  function validarCpf(valor) {
    var c = String(valor || '').replace(/\D/g, '');
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    for (var t = 9; t < 11; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += +c[i] * (t + 1 - i);
      var dv = ((soma * 10) % 11) % 10;
      if (dv !== +c[t]) return false;
    }
    return true;
  }

  function validarCnpj(valor) {
    var c = String(valor || '').replace(/\D/g, '');
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    var pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    for (var t = 12; t < 14; t++) {
      var soma = 0;
      for (var i = 0; i < t; i++) soma += +c[i] * pesos[i + (13 - t)];
      var dv = soma % 11 < 2 ? 0 : 11 - (soma % 11);
      if (dv !== +c[t]) return false;
    }
    return true;
  }

  function idade(nascimento, referencia) {
    var n = data(nascimento);
    if (!n) return null;
    var r = referencia || hoje();
    var a = r.getFullYear() - n.getFullYear();
    if (r.getMonth() < n.getMonth() || (r.getMonth() === n.getMonth() && r.getDate() < n.getDate())) a--;
    return a;
  }

  /* ---------- Cálculos (manual, seção 1.2 e 3) ---------- */

  // Manual 1.2.2.1 item 10: prazo constitucional de 2 meses após o recebimento do ofício (RPV).
  // Contado em 60 dias (Lei 12.153/2009, art. 13, I), como no exemplo do manual 3.1.7:
  // recebido em 11/05/2018 → prazo final 10/07/2018 → juros pós a partir de 11/07/2018.
  function prazoFinalRpv(dataRecebimentoIso) {
    var d = data(dataRecebimentoIso);
    return d ? somarDias(d, 60) : null;
  }

  // Art. 100, § 5º, CF (red. EC 114/2021): precatório apresentado até 2 de abril é pago até o fim do exercício seguinte.
  function exercicioPagamentoPrecatorio(dataApresentacaoIso) {
    var d = data(dataApresentacaoIso);
    if (!d) return null;
    var corte = new Date(d.getFullYear(), 3, 2);
    return d <= corte ? d.getFullYear() + 1 : d.getFullYear() + 2;
  }

  // Manual 1.2.2.2 itens 9 a 14: períodos de correção e de juros.
  function periodos(p) {
    var liquidacao = data(p.dataLiquidacao);
    var calculo = data(p.dataCalculo) || hoje();
    var recebimento = p.possuiOficio ? data(p.dataRecebimentoOficio) : null;
    var prazoFinal = recebimento ? prazoFinalRpv(p.dataRecebimentoOficio) : null;

    var fimJurosPre = recebimento || calculo;
    var res = {
      correcao: { inicio: liquidacao, fim: calculo, dias: dias(liquidacao, calculo) },
      jurosPre: { inicio: liquidacao, fim: fimJurosPre, dias: dias(liquidacao, fimJurosPre) },
      graca: null,
      jurosPos: null,
      prazoFinal: prazoFinal
    };
    if (recebimento && prazoFinal) {
      // Súmula Vinculante 17: no período de graça não fluem juros.
      res.graca = { inicio: recebimento, fim: prazoFinal, dias: dias(recebimento, prazoFinal) };
      var inicioPos = somarDias(prazoFinal, 1);
      if (calculo > prazoFinal) res.jurosPos = { inicio: inicioPos, fim: calculo, dias: dias(inicioPos, calculo) };
    }
    return res;
  }

  // Manual 1.2.1 e 3.1.6: o principal corrigido serve de base para os juros; os juros do cálculo homologado são só corrigidos.
  function estimarAtualizacao(p) {
    var fator = numero(p.fatorCorrecao) || 1;
    var principalCorrigido = arred(numero(p.principal) * fator);
    var jurosCorrigidos = arred(numero(p.juros) * fator);
    var jurosPre = arred(principalCorrigido * numero(p.taxaJurosPre) / 100);
    var jurosPos = arred(principalCorrigido * numero(p.taxaJurosPos) / 100);
    return {
      principalCorrigido: principalCorrigido,
      jurosCorrigidos: jurosCorrigidos,
      valorCorrigido: arred(principalCorrigido + jurosCorrigidos),
      jurosPre: jurosPre,
      jurosPos: jurosPos,
      total: arred(principalCorrigido + jurosCorrigidos + jurosPre + jurosPos)
    };
  }

  // Juros simples a 0,5% a.m. (limite legal desde 2012) — usado só como estimativa de teto.
  function taxaJurosMaxima(diasPeriodo) {
    return arred(diasPeriodo / 30 * 0.5);
  }

  // Anexo do manual: enquadramento pelo VALOR ATUALIZADO na data de expedição do ofício.
  function enquadrar(p) {
    var valor = numero(p.valorAtualizado);
    var teto = numero(p.tetoRpv);
    if (!valor || !teto) return null;
    var tipo = valor <= teto ? 'RPV' : 'PRECATORIO';
    var r = { tipo: tipo, valor: valor, teto: teto, excedente: arred(Math.max(0, valor - teto)) };
    // Art. 100, § 2º, CF: superpreferência de crédito alimentar até o triplo do teto de RPV.
    if (tipo === 'PRECATORIO' && p.alimentar && p.preferencial) {
      r.superpreferencia = arred(Math.min(valor, teto * 3));
      r.restanteOrdem = arred(valor - r.superpreferencia);
    }
    return r;
  }

  function irrfMensal(base, tabela) {
    if (base <= 0) return 0;
    for (var i = 0; i < tabela.faixas.length; i++) {
      var f = tabela.faixas[i];
      if (base <= f.ate) return Math.max(0, base * f.aliquota - f.deduzir);
    }
    return 0;
  }

  function redutorMensal(rendimento, imposto, tabela) {
    var r = tabela.redutor;
    if (!r || !r.ativo || imposto <= 0) return 0;
    if (rendimento <= r.isencaoAte) return imposto;
    if (rendimento <= r.faixaAte) return Math.min(imposto, Math.max(0, r.constante - r.fator * rendimento));
    return 0;
  }

  // Manual 3.2 — tributação. RRA (3.2.2.3): a tabela é aplicada ao valor mensal médio e multiplicada pelo nº de meses.
  function calcularTributos(p) {
    var tabela = PARAMETROS.tabelaIrrf;
    var bruto = numero(p.valorBruto);
    var meses = p.rra ? Math.max(1, Math.round(numero(p.parcelasRra))) : 1;
    var baseIncidencia = (p.baseTributavel === undefined || p.baseTributavel === '') ? bruto : numero(p.baseTributavel);

    var r = { bruto: bruto, meses: meses, previdencia: 0, deducaoTeto: 0, deducaoDependentes: 0, baseIr: 0, irrf: 0, aliquotaEfetiva: 0, liquido: bruto, observacoes: [] };

    if (p.honorarios) r.observacoes.push('Honorários: não há retenção de previdência (manual 3.1.5.1).');

    // Previdência (3.2.1) — apenas RPPS, verbas salariais, nunca sobre honorários.
    if (!p.honorarios && p.rpps) {
      var basePrev = numero(p.basePrevidencia);
      if (p.tetoConstitucional === 'TC' || p.tetoConstitucional === 'TC2') {
        var mult = p.tetoConstitucional === 'TC2' ? 2 : 1;
        r.deducaoTeto = arred(Math.min(basePrev, numero(p.tetoRgps) * mult * meses));
        basePrev -= r.deducaoTeto;
      }
      r.previdencia = arred(Math.max(0, basePrev) * numero(p.aliquotaPrevidencia) / 100);
    }

    if (p.isencaoMolestia || p.defensoria) {
      r.observacoes.push(p.defensoria ? 'Honorários da Defensoria Pública não são tributáveis (art. 150 CF).' : 'Isenção de IR por moléstia grave (Lei 7.713/88, art. 6º, XIV) — exige laudo oficial nos autos.');
    } else if (p.tipoPessoa === 'J') {
      if (p.simples) r.observacoes.push('PJ optante pelo Simples Nacional: sem retenção (IN RFB 765/2007).');
      else r.irrf = arred(baseIncidencia * PARAMETROS.aliquotaIrPj / 100);
    } else {
      r.deducaoDependentes = arred(numero(p.dependentes) * tabela.deducaoDependente * meses);
      r.baseIr = arred(Math.max(0, baseIncidencia - r.previdencia - r.deducaoDependentes));
      var mensal = r.baseIr / meses;
      var impostoMensal = irrfMensal(mensal, tabela);
      impostoMensal -= redutorMensal(baseIncidencia / meses, impostoMensal, tabela);
      r.irrf = arred(Math.max(0, impostoMensal) * meses);
      if (p.rra) r.observacoes.push('RRA aplicado em ' + meses + ' parcela(s) (IN RFB 1.500/2014).');
    }

    r.aliquotaEfetiva = bruto ? arred(r.irrf / bruto * 100) : 0;
    r.liquido = arred(bruto - r.previdencia - r.irrf);
    return r;
  }

  global.RegrasPrecatorio = {
    PARAMETROS: PARAMETROS,
    numero: numero, moeda: moeda, percentual: percentual, arred: arred,
    data: data, iso: iso, dataBr: dataBr, dias: dias, hoje: hoje, somarMeses: somarMeses,
    validarNumeroCnj: validarNumeroCnj, validarCpf: validarCpf, validarCnpj: validarCnpj, idade: idade,
    prazoFinalRpv: prazoFinalRpv, exercicioPagamentoPrecatorio: exercicioPagamentoPrecatorio,
    periodos: periodos, estimarAtualizacao: estimarAtualizacao, taxaJurosMaxima: taxaJurosMaxima,
    enquadrar: enquadrar, calcularTributos: calcularTributos
  };
})(window);
