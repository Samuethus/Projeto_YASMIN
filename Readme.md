# Projeto YASMIN — Site e Análise de Precatórios/RPV

Site institucional (layout "Justice & Partners") com um módulo de **análise de Precatórios e RPV** em etapas. O módulo segue o *Manual Cadastro e Cálculo de RPV 1º Grau* do TJMT (sistema SRP 2.0).

Este documento registra **o que foi feito, por que foi feito assim e como estender**. Assim, novos processos de análise podem ser incluídos sem refazer o raciocínio.

---

## 1. Estrutura de pastas

```
Projeto_YASMIN/
├── index.html                 Site (layout, menu lateral flutuante, botões "Precatório")
├── Readme.md                  Este documento
├── layout/                    Imagem de referência do layout (UI/UX case study)
├── manual/                    MANUAL RPV- SRP.pdf — fonte de todas as regras do wizard
├── documents/                 Referências externas (ex.: portal de precatórios do TJMT)
├── processo/                  Autos reais usados como exemplo  ⚠ NÃO versionado (.gitignore)
└── precatorio/                Módulo de análise
    ├── regras.js              Regras de negócio e parâmetros (tetos, IR, juros, prazos)
    ├── wizard.js              Motor genérico do modal em etapas (não conhece regras)
    ├── extrator.js            Leitura do PDF dos autos e análise automática (dados, evidências, pareceres)
    ├── fluxo-rpv.js           Definição das 10 etapas da análise RPV/Precatório
    ├── wizard.css             Estilo do modal, alinhado ao guia de estilo do site
    └── testes.html            Testes no navegador (manual, fluxo completo e leitura do PDF de exemplo)
```

**Como executar:** abra o `index.html` no navegador. Não há build. As fontes vêm do Google Fonts, e o leitor de PDF (pdf.js 3.11.174, via cdnjs) só é carregado quando um arquivo é anexado. Os botões **Precatório** (cabeçalho, banner principal e menu lateral) abrem o wizard.

---

## 2. O site

| Item | Decisão |
|---|---|
| Layout | Reproduz `layout/*.webp`: azul-marinho `#0f1d36` e dourado `#c9a45c`, títulos em *Cormorant Garamond* e texto em *Inter*. As cores ficam em variáveis CSS no `:root` do `index.html`. |
| Menu lateral flutuante | Cartão fixo à esquerda, com o visual do painel lateral do layout. Destaca a seção visível e tem um botão para **recolher/expandir** (fica só com ícones, e o navegador lembra a escolha). Abaixo de 1080px vira uma gaveta aberta por um botão no canto inferior. |
| Botão "Precatório" | Substituiu o antigo "Free Consultation". Os três botões têm `data-precatorio` e chamam `WizardPrecatorio.abrir('rpv_srp')`. |

---

## 3. Módulo de análise de Precatório/RPV

### 3.1 Fontes usadas

1. **Manual RPV** (`manual/MANUAL RPV- SRP.pdf`, 37 páginas). O PDF é uma impressão sem camada de texto, então as páginas foram renderizadas e lidas uma a uma. Toda regra do wizard cita a seção do manual de onde saiu.
2. **Processo de exemplo** (`processo/…pdf`): cumprimento de sentença contra o Estado de MT nos Juizados Especiais de Cáceres, com espelho de "Cadastro de Precatório" já gerado pela CPE. Serviu para conferir o fluxo real e para criar o botão **"Carregar exemplo"**, com os dados pessoais omitidos.

### 3.2 Raciocínio da sequência de etapas

O manual descreve um trabalho sequencial no SRP: **cadastro → cálculo → tributação → guias**. A classificação RPV × Precatório depende do **valor atualizado** na expedição do ofício (Anexo do manual; Res. 303/2019-CNJ), por isso vem **depois** da atualização. A tributação depende do valor efetivamente requisitado, que pode mudar se houver renúncia ao excedente, por isso vem depois do enquadramento.

Antes de tudo vem o **anexo dos autos**. O sistema lê o PDF, preenche as etapas seguintes e emite um parecer em cada uma; o papel do usuário passa a ser **conferir e aprovar** (ver 3.3).

| # | Etapa | Seção do manual | O que valida (erro = bloqueia) | O que calcula/exibe |
|---|---|---|---|---|
| 1 | Anexar o processo | — | **Erro:** nenhum PDF anexado (salvo "Prosseguir sem anexar"); PDF sem camada de texto. **Alerta:** dado essencial não localizado no PDF. | Arquivo, páginas, documentos do PJe identificados, campos preenchidos e parecer geral com as inconsistências encontradas. |
| 2 | Orientações e documentos | Anexo — Definições | **Erro:** sem certidão de trânsito, cálculo de liquidação ou decisão homologatória (não há condenação exigível). | Mapa da análise; legislação aplicável. |
| 3 | Dados do processo | 1.1 e 1.2.2.1 | **Erro:** dígito verificador da numeração CNJ; datas futuras; ajuizamento depois do trânsito. **Alerta:** processo fora do TJMT; ofício recebido antes do trânsito. | Fim do prazo constitucional (60 dias após o recebimento do ofício); exercício de pagamento se for precatório. |
| 4 | Credor e advogados | 1.1, 3.1.5, 3.2 | **Erro:** CPF/CNPJ inválido; destaque de honorários contratuais sem contrato juntado; honorários sem advogado cadastrado. **Alerta:** credor falecido (habilitação); cessão; percentual contratual ≥ 50%. | Idade, condição de credor preferencial, taxa de juros indicada. |
| 5 | Cálculo homologado | 1.2.1, 1.2.2.2, 3.1.4, 3.1.6, 3.1.8 | **Erro:** soma de principal + juros das verbas ≠ valor da liquidação (manual 1.2.2.2, item 8). **Alerta:** índice que já contém juros (SELIC/poupança); taxa de juros incompatível com o tipo de credor. | Conferência do cálculo; parâmetros que devem ser usados no SRP. |
| 6 | Atualização e juros | 1.2.2.1, 1.2.2.2, 3.1.6, 3.1.7 | **Erro:** data do cálculo anterior à liquidação. **Alerta:** juros acima de 0,5% a.m.; prazo constitucional vencido (mora). | Períodos de correção, juros pré, período de graça e juros pós; estimativa do crédito atualizado. |
| 7 | Enquadramento | Anexo — Tetos | **Erro:** renúncia ao excedente sem procuração atualizada com poderes especiais. **Alerta:** teto diferente do de referência; superpreferência; enquadramento feito sobre estimativa. | **RPV ou Precatório**, excedente, parcela superpreferencial (até 3× o teto), honorários sucumbenciais em requisição própria. |
| 8 | Tributação | 1.2.1 (Tributos) e 3.2 | **Erro:** RRA sem parcelas; isenção por moléstia grave sem laudo. **Alerta:** TC/TC2 fora de aposentadoria/pensão; TC2 sem doença incapacitante. | Previdência (11%, TC/TC2), IRRF (PF progressiva + RRA, PJ 1,5% ou Simples), valor líquido, destaque de honorários. |
| 9 | Guias e repasses | 2 | **Erro:** vencimento da guia não futuro; mês de referência mal formatado. | Códigos SEFAZ-MT: 9326 (IRRF) e 7382 (previdência). Para município, a guia é pedida ao ente. Lembrete da DIRF. |
| 10 | Revisão e aprovação | — | **Erro:** alguma etapa não aprovada. **Alerta:** responsável não informado. | Parecer final, síntese (classificação, valor, tributos, líquido), resumo de todas as etapas, exportação em JSON e impressão. |

### 3.3 Leitura automática dos autos (`extrator.js`)

**Objetivo:** o usuário anexa o PDF e só confere e aprova. Para isso, a leitura precisa ser **rastreável**: todo valor preenchido mostra de onde veio.

**Decisões:**

| Decisão | Motivo |
|---|---|
| Ler o PDF **no navegador** (pdf.js), sem servidor | Os autos têm dados pessoais e de saúde. Nada sai da máquina do usuário, e o site continua sem backend. |
| Extração por **regras** (expressões regulares sobre o texto), não por IA | É determinística, auditável e testável contra o manual. Cada regra fica em `analisar()` com o padrão buscado. Um extrator com IA pode ser plugado no futuro com a mesma saída (`dados`, `evidencias`, `pareceres`), desde que o envio dos autos a um serviço externo seja aprovado (LGPD). |
| Duas leituras de cada página | A ordem original do PDF lê bem tabelas como a capa do PJe; a reconstrução por posição (linhas por coordenada) lê bem formulários como o espelho do precatório. A busca considera as duas. |
| Fonte = **ID do documento do PJe + página** | Vem do rodapé "Num. … - Pág. …" de cada página; citações a outros documentos no corpo ("Pág.1/5") são ignoradas. |
| Na dúvida, o dado mais recente e mais específico | Ex.: trânsito em julgado da certidão mais recente com data expressa; decisão homologatória pelo dispositivo do juiz ("HOMOLOGO"), não pela menção das partes. Divergências viram alerta no parecer. |
| "Contrato de honorários" só conta se houver **documento juntado** com esse título | A simples menção no texto gerava falso positivo. |

**O que é extraído:** número, classe, juízo, ente devedor, natureza, ajuizamento, trânsito (todas as datas, para detectar divergência), ofício, credor (nome, CPF/CNPJ com DV conferido, nascimento), representante/curatela, advogados (OAB e CPF), honorários, valor homologado (valor mais citado perto de palavras como "homologo", "perfaz" e "apurado"), data da liquidação, índice, verba, teto de RPV citado, RRA e parcelas, isenção por moléstia grave e laudo, incidência de previdência, e a checagem dos documentos exigidos.

**Pareceres:** cada etapa recebe, no topo da lateral, as observações da leitura (✓ localizado, ! atenção, i informação), a contagem de campos extraídos e uma **conclusão** calculada pela validação da etapa: "Apto para aprovação", "Apto com N pontos de atenção" ou "Requer complemento".

**Correções do usuário:** qualquer campo pode ser editado; o campo passa a mostrar "Alterado por você · original: …", e o parecer final conta quantos valores foram corrigidos.

**Limites conhecidos:**
- PDFs digitalizados (só imagem) não são lidos; o sistema avisa e permite o preenchimento manual. Uma etapa de OCR (ex.: tesseract.js) pode ser acrescentada no `lerPdf`.
- As regras foram calibradas com autos do **PJe/TJMT**. Autos de outros sistemas podem exigir novos padrões em `analisar()`; acrescente um caso em `testes.html` a cada ajuste.
- O fator de correção da Res. 303/2019 não consta nos autos; ele continua vindo do SRP (a etapa de atualização avisa).

### 3.4 Mecânica de validação e aprovação

- Cada etapa tem **erros**, que impedem aprovar, e **pontos de atenção**, que só informam.
- O usuário precisa marcar **"Revisei os dados desta etapa e aprovo"** para avançar. A aprovação fica registrada com data e hora.
- **Editar uma etapa já aprovada desfaz a aprovação dela e de todas as seguintes**, porque os cálculos posteriores dependem dela. O stepper bloqueia etapas além da primeira pendente.
- O rascunho fica salvo no `localStorage` do navegador (chave `analise-precatorio:rpv_srp`). Para levar a análise a outro lugar, use **Exportar análise (JSON)**.

### 3.5 Fórmulas implementadas (`regras.js`)

| Regra | Implementação | Conferida com |
|---|---|---|
| Numeração CNJ | DV = 98 − ((NNNNNNN AAAA J TR OOOO 00) mod 97) | Número real do exemplo (DV 75) |
| Prazo RPV | recebimento do ofício + 60 dias (os "2 meses" do manual; Lei 12.153/2009, art. 13, I) | Manual 3.1.7: recebido em 11/05/2018 → prazo final 10/07/2018; juros pós de 11/07/2018 a 05/08/2019 (390 dias) |
| Exercício do precatório | apresentado até 02/04 → paga no ano seguinte; senão, em 2 anos (art. 100, § 5º, CF, red. EC 114/2021) | — |
| Correção | principal × fator e juros homologados × fator | Manual p. 14: 888,49 → 971,22; 101,58 → 111,04 |
| Juros pré/pós | principal corrigido × taxa do período (juros simples) | Manual p. 14: total 1.173,74 (diferença de R$ 0,01 por arredondamento da taxa) |
| Enquadramento | valor atualizado ≤ teto → RPV; senão Precatório; superpreferência = mín(valor, 3 × teto) | Exemplo: 76.582,63 > 26.336,00 → Precatório |
| Previdência TC/TC2 | (base − teto RGPS × 1 ou 2 × meses) × 11% | Manual 3.2.1.1 (978,88) e 3.2.1.2 (307,77) |
| IRRF PF/RRA | tabela progressiva sobre (base ÷ meses) × meses, menos o redutor | Manual 3.2.2.3: R$ 3.000 em 2 meses → IR 0 |
| IRRF PJ | 1,5%, ou 0 se optante pelo Simples | Manual 3.2.2.2 |

> **Importante:** os valores do wizard são **estimativas para conferência**. O cálculo oficial é o que o módulo de cálculo do SRP gera ("Imprimir cálculo"). No caso de precatório, o DAP recalcula e retém os tributos no pagamento.

### 3.6 O processo de exemplo e o que a análise revelou

Ao anexar o PDF de exemplo (105 páginas, lido em cerca de 1 segundo), o sistema preenche 36 informações com origem e as 10 etapas podem ser aprovadas sem digitar nada. O botão **Carregar exemplo** traz os mesmos dados sem o PDF (sem nome nem CPF). O wizard mostra:

- **Classificação: Precatório.** O valor homologado (R$ 76.582,63) supera o teto de RPV do Estado (R$ 26.336,00, informado pela PGE-MT nos autos).
- **Superpreferência:** crédito alimentar de credor com doença grave. Até 3× o teto (R$ 79.008,00) cabe superpreferência, ou seja, o valor inteiro.
- **Índice IPCA-E + SELIC:** a SELIC já engloba juros, então o wizard alerta para separar principal e juros (manual 3.1.8).
- **RRA em 23 parcelas** e **isenção de IR por moléstia grave** (laudo oficial nos autos).

Inconsistências encontradas nos autos, que a leitura automática detecta e coloca no parecer:

1. Há **duas certidões de trânsito** com datas diferentes (uma de 17/09/2026; outra, de 16/10/2026, certifica o trânsito em 14/07/2026).
2. No espelho do precatório, o campo **"Dt. Receb. Ente Devedor"** traz 14/07/2026 (a data do trânsito), enquanto **"Dt. Trânsito"** está vazio. Isso parece uma troca de campos.
3. O espelho registra **IR de R$ 2.421,71** mesmo com laudo de isenção juntado.
4. O pagamento foi requerido na **conta do advogado** (exige procuração com poderes especiais).
5. Houve **proposta de acordo com deságio**, recusada; o valor homologado é o integral.

---

## 4. Parâmetros que precisam de revisão periódica

Todos ficam em `PARAMETROS`, no início de `precatorio/regras.js`:

| Parâmetro | Valor atual | Observação |
|---|---|---|
| Teto RPV — Estado de MT | R$ 26.336,00 | 100 UPF/MT, com variação mensal. Confirmar na [Tabela RPV do TJMT](http://www.tjmt.jus.br/OutrasAreas/C/20458). |
| Teto RPV — Município / INSS | informado pelo usuário | Município: lei local (até 30 SM). INSS/União: 60 SM. |
| Tabela do IRRF | vigência 05/2025 + redutor da Lei 15.270/2025 | **Validar o redutor com a contabilidade antes de usar em produção.** |
| Teto do RGPS (TC/TC2) | R$ 8.157,41 (2025) | Atualizar a cada janeiro. |
| Alíquota RPPS | 11% | Manual 3.2.1. |

---

## 5. Como adicionar um novo processo de análise

O motor (`wizard.js`) é genérico: ele renderiza qualquer fluxo registrado em `window.FluxosPrecatorio`. Para criar, por exemplo, um fluxo de **RPV de 2ª instância**:

1. Crie `precatorio/fluxo-<nome>.js`:

```js
(function (global) {
  var R = global.RegrasPrecatorio;
  global.FluxosPrecatorio = global.FluxosPrecatorio || {};
  global.FluxosPrecatorio.rpv_2grau = {
    id: 'rpv_2grau',
    titulo: 'Análise de RPV — 2ª instância',
    subtitulo: 'SRP 2.0 · TJMT',
    versao: '1.0.0',
    exemplo: { /* dados opcionais para "Carregar exemplo" */ },
    etapas: [
      {
        id: 'processo', titulo: 'Dados do processo', curto: 'Processo',
        descricao: 'Texto de orientação exibido no topo da etapa.',
        manual: { ref: 'Seção X', itens: ['Trecho do manual exibido na lateral'] },
        campos: [
          { id: 'numero', tipo: 'texto', rotulo: 'Número do processo', obrigatorio: true, largura: 'meia' },
          { id: 'possuiOficio', tipo: 'simnao', rotulo: 'Ofício expedido?', obrigatorio: true },
          { id: 'dataRec', tipo: 'data', rotulo: 'Recebimento', se: function (d) { return d.possuiOficio === 'S'; } }
        ],
        painel: function (d) { return '<div class="pw-cartao">…</div>'; },          // resultados (opcional)
        validar: function (d) { return { erros: [], alertas: [] }; }               // regras (opcional)
      },
      { id: 'revisao', titulo: 'Revisão', revisao: true, campos: [], validar: function () { return {}; } }
    ]
  };
})(window);
```

2. Inclua o script no `index.html`, depois de `wizard.js`.
3. Abra com `WizardPrecatorio.abrir('rpv_2grau')`, por exemplo num novo botão com `data-precatorio`, ajustando o handler no fim do `index.html`.
4. Regras reutilizáveis (cálculos, validações de documentos) vão em `regras.js`, nunca no motor.
5. Acrescente casos em `precatorio/testes.html`.

**Tipos de campo suportados:** `texto`, `moeda`, `numero`, `data`, `selecao`, `simnao`, `area`, `checkbox`, `lista` (itens repetíveis com `colunas`), `aviso` (HTML livre ou função) e `arquivo` (zona de arrastar e soltar; `processar(arquivo, progresso)` devolve uma Promise com os dados novos, e `resumo(d)` descreve o arquivo já analisado). Propriedades: `obrigatorio`, `padrao` (valor ou função), `se` (visibilidade condicional), `largura` (`inteira`/`meia`/`terco`), `ajuda`, `sufixo`.

**Parecer e evidências:** uma etapa pode definir `parecer(d, ctx, validacao, etapa)`, exibido no topo da lateral. Se os dados tiverem `_evidencias[idCampo] = { fonte, trecho }`, o motor mostra a origem embaixo do campo e marca quando o usuário a altera. Para um novo fluxo com leitura automática, reutilize `ExtratorProcesso.lerPdf()` e escreva o seu `analisar()`.

---

## 6. Testes

Abra `precatorio/testes.html` no navegador. A página:

- confere as regras com os **exemplos numéricos do próprio manual** (correção, TC, TC2, RRA, prazos, CNJ, CPF/CNPJ);
- percorre as 10 etapas com o processo de exemplo, aprovando cada uma até concluir;
- verifica que editar uma etapa aprovada desfaz as aprovações seguintes e que um número CNJ inválido bloqueia a aprovação;
- se o PDF de exemplo estiver em `processo/`, lê os autos, confere 25 informações extraídas e as 5 inconsistências, e verifica que **as 10 etapas são aprovadas sem digitar nada**, com parecer em todas.

Resultado esperado: **54 PASS, 0 FAIL**, sem erros de JavaScript (sem o PDF, a parte da leitura aparece como SKIP). Para ler o PDF local, abra o Chrome/Edge com `--allow-file-access-from-files` ou sirva a pasta por HTTP. A página de testes não altera o rascunho salvo no navegador.

---

## 7. Privacidade (LGPD)

- A pasta `processo/` está no `.gitignore`. Os autos têm CPF, endereço, dados bancários e laudo médico. **Nunca versione autos reais.**
- O exemplo do wizard usa só dados não pessoais: número do processo (público, sigilo 0), valores, datas e órgão julgador. Nome e CPF do credor foram omitidos.
- O PDF anexado é lido no navegador e **não é enviado a nenhum servidor**; ele também não é guardado. Ficam salvos apenas os dados extraídos e os trechos de evidência.
- Os dados digitados ou extraídos ficam apenas no navegador de quem usa (`localStorage`). Como incluem CPF e trechos dos autos, use **Limpar** ao terminar uma análise em computador compartilhado.

---

## 8. Automação do repositório

O arquivo `.claude/settings.local.json` (local, fora do versionamento) tem um *hook* que faz **commit e push automáticos** para `origin/main` ao fim de cada resposta do Claude Code com alterações. Por isso, mantenha o `.gitignore` em dia antes de colocar arquivos novos na pasta.

---

## 9. Histórico de decisões

| Data | Decisão |
|---|---|
| 24/10/2026 | Site criado a partir do layout, com menu lateral flutuante. |
| 24/10/2026 | Botão para recolher/expandir o menu lateral. |
| 24/10/2026 | Botão "Free Consultation" renomeado para **"Precatório"**, abrindo o wizard de análise em 9 etapas baseado no Manual RPV. Motor genérico separado das regras para aceitar novos processos. Autos reais excluídos do versionamento. |
| 24/10/2026 | Nova etapa inicial **"Anexar o processo"**: leitura do PDF no navegador, preenchimento automático com evidência (documento e página) e parecer em cada etapa. O usuário passa a conferir e aprovar. Ciência da DIRF e responsável deixaram de ser obrigatórios. |
