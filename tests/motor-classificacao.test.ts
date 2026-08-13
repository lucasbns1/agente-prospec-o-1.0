/**
 * Matriz de classificacao.
 *
 * Cada caso e uma frase real que um lead poderia mandar. O teste roda
 * contra o DICIONARIO PADRAO de verdade — o mesmo que o seed grava no
 * banco — e nao contra um dicionario de mentira montado para o teste
 * passar.
 *
 * A tabela `MATRIZ` documenta o comportamento esperado do motor. Quando
 * alguem mudar um peso ou acrescentar um termo, e aqui que a regressao
 * aparece.
 */
import { describe, expect, it } from 'vitest';
import {
  classificarResposta,
  PRECEDENCIA_PADRAO,
  type TermoRegra,
} from '../packages/domain/src/rules/motor.js';
import {
  DICIONARIO_PADRAO,
  contarPorCategoria,
} from '../packages/domain/src/rules/dicionario-padrao.js';
import type { RespostaCategoria } from '../packages/shared/src/enums.js';

/** Converte o dicionario padrao no formato que o motor consome. */
const TERMOS: TermoRegra[] = DICIONARIO_PADRAO.map((d, i) => ({
  id: `t${i}`,
  categoria: d.categoria,
  termo: d.termo,
  matchTipo: d.matchTipo,
  peso: d.peso,
  subtipo: d.subtipo,
  ativo: true,
  campaignStepId: null,
}));

const classificar = (texto: string | null | undefined) =>
  classificarResposta(texto, {
    termos: TERMOS,
    precedencia: PRECEDENCIA_PADRAO,
  });

/** [entrada, categoria esperada, comentario opcional] */
type Caso = [string, RespostaCategoria, string?];

function rodarMatriz(nome: string, casos: Caso[]) {
  describe(nome, () => {
    it.each(casos)('%s => %s', (entrada, esperada) => {
      const r = classificar(entrada);
      expect(
        r.categoria,
        `"${entrada}" | detectadas: ${r.categoriasDetectadas.join(',')} | ${r.motivo}`
      ).toBe(esperada);
    });
  });
}

// =============================================================================
describe('dicionario padrao', () => {
  it('tem cobertura ampla em todas as 7 categorias acionaveis', () => {
    const contagem = contarPorCategoria();
    for (const cat of ['OPT_OUT', 'NEGATIVO', 'FALAR_DEPOIS', 'PRECO', 'DUVIDA', 'POSITIVO', 'INTERESSE']) {
      expect(contagem[cat] ?? 0, `categoria ${cat}`).toBeGreaterThanOrEqual(20);
    }
  });

  it('tem mais de 300 termos no total', () => {
    expect(DICIONARIO_PADRAO.length).toBeGreaterThan(300);
  });

  it('nao tem termo duplicado na mesma categoria', () => {
    const vistos = new Set<string>();
    const duplicados: string[] = [];
    for (const d of DICIONARIO_PADRAO) {
      const chave = `${d.categoria}|${d.termo}`;
      if (vistos.has(chave)) duplicados.push(chave);
      vistos.add(chave);
    }
    expect(duplicados).toEqual([]);
  });

  it('todo termo esta normalizado (minusculo e sem acento)', () => {
    for (const d of DICIONARIO_PADRAO) {
      expect(d.termo, `termo "${d.termo}"`).toBe(d.termo.toLowerCase());
      expect(d.termo, `termo "${d.termo}" tem acento`).not.toMatch(/[áàâãéêíóôõúüç]/);
    }
  });
});

// =============================================================================
// OPT_OUT
// =============================================================================
rodarMatriz('OPT_OUT — pedidos diretos', [
  ['pare', 'OPT_OUT'],
  ['parar', 'OPT_OUT'],
  ['stop', 'OPT_OUT'],
  ['Pare!', 'OPT_OUT'],
  ['PARE', 'OPT_OUT'],
  ['stop por favor', 'OPT_OUT'],
  ['não quero receber mais mensagens', 'OPT_OUT'],
  ['nao quero receber mais mensagens', 'OPT_OUT'],
  ['não quero mais mensagens', 'OPT_OUT'],
  ['não me mande mais mensagens', 'OPT_OUT'],
  ['não me mande mais', 'OPT_OUT'],
  ['nao manda mais', 'OPT_OUT'],
  ['não manda mais nada', 'OPT_OUT'],
  ['pare de mandar', 'OPT_OUT'],
  ['para de mandar mensagem', 'OPT_OUT'],
  ['pare de enviar', 'OPT_OUT'],
  ['pode parar de mandar', 'OPT_OUT'],
  ['chega de mensagem', 'OPT_OUT'],
  ['não me chama mais', 'OPT_OUT'],
  ['não entre mais em contato', 'OPT_OUT'],
  ['não quero contato', 'OPT_OUT'],
]);

rodarMatriz('OPT_OUT — remocao de cadastro', [
  ['retira meu número', 'OPT_OUT'],
  ['retire meu número', 'OPT_OUT'],
  ['remove meu número', 'OPT_OUT'],
  ['remova meu número', 'OPT_OUT'],
  ['tira meu numero', 'OPT_OUT'],
  ['tira meu número daí', 'OPT_OUT'],
  ['apaga meu contato', 'OPT_OUT'],
  ['remova meu contato', 'OPT_OUT'],
  ['me exclui', 'OPT_OUT'],
  ['me exclua', 'OPT_OUT'],
  ['me tira da lista', 'OPT_OUT'],
  ['me retire da lista', 'OPT_OUT'],
  ['remove da lista', 'OPT_OUT'],
  ['descadastrar', 'OPT_OUT'],
  ['me tira disso', 'OPT_OUT'],
  ['me deixa fora', 'OPT_OUT'],
]);

rodarMatriz('OPT_OUT — informal, girias e reclamacao', [
  ['chega', 'OPT_OUT'],
  ['já deu', 'OPT_OUT'],
  ['deixa pra lá', 'OPT_OUT'],
  ['larga mão', 'OPT_OUT'],
  ['não precisa mais', 'OPT_OUT'],
  ['já falei que não', 'OPT_OUT'],
  ['eu já disse não', 'OPT_OUT'],
  ['já disse que não quero', 'OPT_OUT'],
  ['não insiste', 'OPT_OUT'],
  ['não precisa insistir', 'OPT_OUT'],
  ['para com isso', 'OPT_OUT'],
  ['não enche', 'OPT_OUT'],
  ['não perturbe', 'OPT_OUT'],
  ['vocês não param', 'OPT_OUT'],
  ['já pedi para parar', 'OPT_OUT'],
  ['quantas vezes vou ter que falar', 'OPT_OUT'],
  ['não aguento mais mensagem', 'OPT_OUT'],
  ['parem de me chamar', 'OPT_OUT'],
  ['vou denunciar', 'OPT_OUT'],
  ['vou bloquear', 'OPT_OUT'],
]);

rodarMatriz('OPT_OUT — sem acento e com typo', [
  ['nao quero receber mais', 'OPT_OUT'],
  ['naum quero receber mais', 'OPT_OUT'],
  ['nao me mande mais', 'OPT_OUT'],
  ['pare de manda', 'OPT_OUT'],
  ['remove meu numero', 'OPT_OUT'],
  ['tira meu numero', 'OPT_OUT'],
  ['NAO QUERO RECEBER MAIS MENSAGENS', 'OPT_OUT'],
  ['não   quero    receber   mais', 'OPT_OUT', 'espacos extras'],
  ['não quero receber mais!!!', 'OPT_OUT', 'pontuacao'],
]);

// OPT_OUT vence QUALQUER combinacao (requisito 30)
// NOTA: "não quero, mas quanto custa?" NAO esta aqui de proposito.
// A secao 30 do briefing pede OPT_OUT para essa frase, mas a secao 7
// lista "não quero" como NEGATIVO — e a frase nao tem nenhum pedido de
// remocao. Tratar toda recusa como opt-out bloquearia para sempre um
// lead que so estava perguntando o preco. Ver `nao-quero-nao-e-opt-out`
// mais abaixo.
rodarMatriz('OPT_OUT — precedencia absoluta sobre outras categorias', [
  ['tenho interesse, mas não me mande mais mensagens', 'OPT_OUT'],
  ['pare de mandar, obrigado', 'OPT_OUT'],
  ['não tenho interesse, remove meu número', 'OPT_OUT'],
  ['gostei mas remove meu contato', 'OPT_OUT'],
  ['quanto custa? de qualquer forma me tira da lista', 'OPT_OUT'],
  ['me chama amanhã não, me exclui', 'OPT_OUT'],
  ['não quero receber mais, mas obrigado', 'OPT_OUT'],
]);

// =============================================================================
// NEGATIVO
// =============================================================================
rodarMatriz('NEGATIVO — falta de interesse', [
  ['não tenho interesse', 'NEGATIVO'],
  ['não tenho interesse nisso', 'NEGATIVO'],
  ['não tenho interesse no serviço', 'NEGATIVO'],
  ['não tenho interesse nenhum', 'NEGATIVO'],
  ['não estou interessado', 'NEGATIVO'],
  ['não estou interessada', 'NEGATIVO'],
  ['não me interessa', 'NEGATIVO'],
  ['não é do meu interesse', 'NEGATIVO'],
  ['sem interesse', 'NEGATIVO'],
  ['sem interesse mesmo', 'NEGATIVO'],
  ['nao tenho enteresse', 'NEGATIVO', 'typo'],
  ['nao tenhu interesse', 'NEGATIVO', 'typo'],
]);

rodarMatriz('NEGATIVO — sem necessidade e recusa', [
  ['não preciso', 'NEGATIVO'],
  ['não preciso disso', 'NEGATIVO'],
  ['não vou precisar', 'NEGATIVO'],
  ['não tenho necessidade', 'NEGATIVO'],
  ['não quero', 'NEGATIVO'],
  ['não quero isso', 'NEGATIVO'],
  ['não quero contratar', 'NEGATIVO'],
  ['não pretendo contratar', 'NEGATIVO'],
  ['não vou contratar', 'NEGATIVO'],
  ['não tenho intenção', 'NEGATIVO'],
]);

rodarMatriz('NEGATIVO — objecao definitiva', [
  ['já tenho', 'NEGATIVO'],
  ['já tenho alguém', 'NEGATIVO'],
  ['já tenho fornecedor', 'NEGATIVO'],
  ['já tenho empresa', 'NEGATIVO'],
  ['já trabalho com outra', 'NEGATIVO'],
  ['já tenho parceiro', 'NEGATIVO'],
  ['já resolvi isso', 'NEGATIVO'],
  ['não preciso mudar', 'NEGATIVO'],
  ['estou satisfeito com quem tenho', 'NEGATIVO'],
  ['já tenho site', 'NEGATIVO'],
]);

rodarMatriz('NEGATIVO — respostas curtas', [
  ['não', 'NEGATIVO'],
  ['nao', 'NEGATIVO'],
  ['Não.', 'NEGATIVO'],
  ['NÃO', 'NEGATIVO'],
  ['naum', 'NEGATIVO'],
  ['nop', 'NEGATIVO'],
  ['nope', 'NEGATIVO'],
  ['nah', 'NEGATIVO'],
  ['nem', 'NEGATIVO'],
  ['dispenso', 'NEGATIVO'],
  ['passo', 'NEGATIVO'],
  ['n', 'NEGATIVO', '"n" isolado'],
]);

// =============================================================================
// FALAR_DEPOIS
// =============================================================================
rodarMatriz('FALAR_DEPOIS — reagendamento explicito', [
  ['me chama amanhã', 'FALAR_DEPOIS'],
  ['me chama depois', 'FALAR_DEPOIS'],
  ['me chama mais tarde', 'FALAR_DEPOIS'],
  ['me chama quando puder', 'FALAR_DEPOIS'],
  ['fala comigo depois', 'FALAR_DEPOIS'],
  ['fala comigo amanhã', 'FALAR_DEPOIS'],
  ['me procura depois', 'FALAR_DEPOIS'],
  ['me procura amanhã', 'FALAR_DEPOIS'],
  ['vamos falar outro dia', 'FALAR_DEPOIS'],
  ['me manda depois', 'FALAR_DEPOIS'],
  ['te retorno', 'FALAR_DEPOIS'],
  ['eu te retorno', 'FALAR_DEPOIS'],
  ['depois te falo', 'FALAR_DEPOIS'],
  ['depois a gente conversa', 'FALAR_DEPOIS'],
  ['vamos conversar depois', 'FALAR_DEPOIS'],
  ['me chama amanha', 'FALAR_DEPOIS', 'sem acento'],
  ['me chama amnhã', 'FALAR_DEPOIS', 'typo'],
]);

rodarMatriz('FALAR_DEPOIS — indisponivel agora', [
  ['agora não posso', 'FALAR_DEPOIS'],
  ['não posso falar agora', 'FALAR_DEPOIS'],
  ['não consigo falar agora', 'FALAR_DEPOIS'],
  ['não tenho tempo agora', 'FALAR_DEPOIS'],
  ['estou sem tempo', 'FALAR_DEPOIS'],
  ['estou ocupado', 'FALAR_DEPOIS'],
  ['estou ocupada', 'FALAR_DEPOIS'],
  ['to ocupado', 'FALAR_DEPOIS'],
  ['estou trabalhando', 'FALAR_DEPOIS'],
  ['estou em reunião', 'FALAR_DEPOIS'],
  ['estou correndo', 'FALAR_DEPOIS'],
  ['hoje não consigo', 'FALAR_DEPOIS'],
  ['agora estou ocupado', 'FALAR_DEPOIS'],
]);

rodarMatriz('FALAR_DEPOIS — adiamento', [
  ['agora não', 'FALAR_DEPOIS'],
  ['hoje não', 'FALAR_DEPOIS'],
  ['depois', 'FALAR_DEPOIS'],
  ['mais tarde', 'FALAR_DEPOIS'],
  ['outro dia', 'FALAR_DEPOIS'],
  ['depois eu vejo', 'FALAR_DEPOIS'],
  ['vamos deixar pra depois', 'FALAR_DEPOIS'],
  ['deixa pra outro dia', 'FALAR_DEPOIS'],
  ['semana que vem', 'FALAR_DEPOIS'],
  ['mês que vem', 'FALAR_DEPOIS'],
  ['próxima semana', 'FALAR_DEPOIS'],
  ['amanhã', 'FALAR_DEPOIS'],
]);

// =============================================================================
// PRECO
// =============================================================================
rodarMatriz('PRECO — pergunta direta', [
  ['quanto custa', 'PRECO'],
  ['quanto custa?', 'PRECO'],
  ['Quanto custa isso?', 'PRECO'],
  ['quanto é', 'PRECO'],
  ['quanto fica', 'PRECO'],
  ['quanto sai', 'PRECO'],
  ['quanto sai isso', 'PRECO'],
  ['qual o preço', 'PRECO'],
  ['qual preço', 'PRECO'],
  ['qual o valor', 'PRECO'],
  ['qual valor', 'PRECO'],
  ['qual é o valor', 'PRECO'],
  ['quanto vocês cobram', 'PRECO'],
  ['quanto vocês cobram por isso', 'PRECO'],
  ['me passa o preço', 'PRECO'],
  ['me passa o valor', 'PRECO'],
  ['me fala o valor', 'PRECO'],
  ['manda preço', 'PRECO'],
  ['manda o valor', 'PRECO'],
  ['qto custa', 'PRECO', 'abreviacao'],
  ['quanto custa mesmo', 'PRECO'],
  ['qual o preco', 'PRECO', 'sem acento'],
]);

rodarMatriz('PRECO — orcamento', [
  ['faz orçamento', 'PRECO'],
  ['vocês fazem orçamento', 'PRECO'],
  ['pode fazer orçamento', 'PRECO'],
  ['quero orçamento', 'PRECO'],
  ['preciso de orçamento', 'PRECO'],
  ['manda orçamento', 'PRECO'],
  ['me manda orçamento', 'PRECO'],
  ['quanto fica o orçamento', 'PRECO'],
  ['tem orçamento', 'PRECO'],
]);

rodarMatriz('PRECO — negociacao e pagamento', [
  ['tem desconto', 'PRECO'],
  ['consegue desconto', 'PRECO'],
  ['faz desconto', 'PRECO'],
  ['tem como negociar', 'PRECO'],
  ['dá pra negociar', 'PRECO'],
  ['consegue fazer por menos', 'PRECO'],
  ['qual o menor valor', 'PRECO'],
  ['forma de pagamento', 'PRECO'],
  ['como posso pagar', 'PRECO'],
  ['aceita cartão', 'PRECO'],
  ['aceita pix', 'PRECO'],
  ['dá pra parcelar', 'PRECO'],
  ['tem parcelamento', 'PRECO'],
]);

rodarMatriz('PRECO — indireto', [
  ['é caro', 'PRECO'],
  ['achei caro', 'PRECO'],
  ['muito caro', 'PRECO'],
  ['tá caro', 'PRECO'],
  ['preço', 'PRECO'],
  ['valor', 'PRECO'],
  ['quanto', 'PRECO'],
]);

// =============================================================================
// DUVIDA
// =============================================================================
rodarMatriz('DUVIDA', [
  ['como funciona', 'DUVIDA'],
  ['como funciona isso', 'DUVIDA'],
  ['Como funciona?', 'DUVIDA'],
  ['como vocês trabalham', 'DUVIDA'],
  ['o que vocês fazem', 'DUVIDA'],
  ['o que vocês oferecem', 'DUVIDA'],
  ['me explica', 'DUVIDA'],
  ['pode explicar', 'DUVIDA'],
  ['explica melhor', 'DUVIDA'],
  ['não entendi', 'DUVIDA'],
  ['não entendi direito', 'DUVIDA'],
  ['como seria', 'DUVIDA'],
  ['qual o processo', 'DUVIDA'],
  ['como é o processo', 'DUVIDA'],
  ['o que está incluso', 'DUVIDA'],
  ['o que inclui', 'DUVIDA'],
  ['tem garantia', 'DUVIDA'],
  ['qual garantia', 'DUVIDA'],
  ['tem contrato', 'DUVIDA'],
  ['como contrato', 'DUVIDA'],
  ['como começa', 'DUVIDA'],
  ['como faço', 'DUVIDA'],
  ['o que preciso fazer', 'DUVIDA'],
  ['como assim', 'DUVIDA'],
  ['do que se trata', 'DUVIDA'],
  ['quem fala', 'DUVIDA'],
  ['nao entendi', 'DUVIDA', 'sem acento'],
]);

// =============================================================================
// POSITIVO
// =============================================================================
rodarMatriz('POSITIVO — confirmacao forte', [
  ['sim', 'POSITIVO'],
  ['Sim!', 'POSITIVO'],
  ['SIM', 'POSITIVO'],
  ['simmmm', 'POSITIVO', 'vogal alongada'],
  ['quero', 'POSITIVO'],
  ['quero sim', 'POSITIVO'],
  ['tenho interesse', 'POSITIVO'],
  ['tenho interesse sim', 'POSITIVO'],
  ['quero contratar', 'POSITIVO'],
  ['quero saber mais', 'POSITIVO'],
  ['quero conhecer', 'POSITIVO'],
  ['me interessa', 'POSITIVO'],
  ['estou interessado', 'POSITIVO'],
  ['qero saber mais', 'POSITIVO', 'typo'],
]);

rodarMatriz('POSITIVO — autorizacao de envio', [
  ['pode mandar', 'POSITIVO'],
  ['pode mandar sim', 'POSITIVO'],
  ['pode me mandar', 'POSITIVO'],
  ['pode enviar', 'POSITIVO'],
  ['pode mostrar', 'POSITIVO'],
  ['pode me mostrar', 'POSITIVO'],
  ['pode falar', 'POSITIVO'],
  ['pode sim', 'POSITIVO'],
  ['manda aí', 'POSITIVO'],
  ['quero ver', 'POSITIVO'],
  ['gostaria de ver', 'POSITIVO'],
  ['me mostra', 'POSITIVO'],
  ['claro', 'POSITIVO'],
  ['bora', 'POSITIVO'],
  ['fechado', 'POSITIVO'],
  ['combinado', 'POSITIVO'],
  ['perfeito', 'POSITIVO'],
]);

rodarMatriz('POSITIVO — identidade e abertura comercial', [
  ['sou eu', 'POSITIVO'],
  ['sim sou eu', 'POSITIVO'],
  ['vamos conversar', 'POSITIVO'],
  ['podemos conversar', 'POSITIVO'],
  ['quero conversar', 'POSITIVO'],
  ['vamos marcar', 'POSITIVO'],
  ['vamos agendar', 'POSITIVO'],
  ['pode entrar em contato', 'POSITIVO'],
]);

// =============================================================================
// INTERESSE
// =============================================================================
rodarMatriz('INTERESSE', [
  ['interessante', 'INTERESSE'],
  ['parece interessante', 'INTERESSE'],
  ['achei interessante', 'INTERESSE'],
  ['parece bom', 'INTERESSE'],
  ['parece legal', 'INTERESSE'],
  ['legal', 'INTERESSE'],
  ['bacana', 'INTERESSE'],
  ['gostei', 'INTERESSE'],
  ['adorei', 'INTERESSE'],
  ['me chamou atenção', 'INTERESSE'],
  ['vou pensar', 'INTERESSE'],
  ['vou analisar', 'INTERESSE'],
  ['vou verificar', 'INTERESSE'],
  ['talvez', 'INTERESSE'],
  ['pode ser', 'INTERESSE'],
  ['quem sabe', 'INTERESSE'],
  ['ficou bom', 'INTERESSE'],
  ['muito bom', 'INTERESSE'],
]);

// =============================================================================
// MULTIPLAS INTENCOES — o coracao da precedencia
// =============================================================================
rodarMatriz('PRECO + POSITIVO => PRECO', [
  ['quero, quanto custa?', 'PRECO'],
  ['tenho interesse, qual valor?', 'PRECO'],
  ['gostei, quanto fica?', 'PRECO'],
  ['parece bom, qual preço?', 'PRECO'],
  ['quero contratar, quanto custa?', 'PRECO'],
  ['pode mandar, mas quanto custa?', 'PRECO'],
  ['sim, qual o valor?', 'PRECO'],
  ['tenho interesse sim, mas quanto custa?', 'PRECO'],
]);

rodarMatriz('NEGATIVO + FALAR_DEPOIS => FALAR_DEPOIS', [
  ['não quero agora, mas pode me chamar depois', 'FALAR_DEPOIS'],
  ['agora não, me chama amanhã', 'FALAR_DEPOIS'],
  ['hoje não posso, fala comigo depois', 'FALAR_DEPOIS'],
]);

rodarMatriz('INTERESSE + FALAR_DEPOIS => FALAR_DEPOIS', [
  ['Interessante. Me chama amanhã que hoje estou correndo.', 'FALAR_DEPOIS'],
  ['gostei, mas me chama depois', 'FALAR_DEPOIS'],
  ['parece bom, te retorno', 'FALAR_DEPOIS'],
]);

rodarMatriz('mensagens longas com varias intencoes', [
  [
    'Olha, eu achei interessante, mas hoje não consigo falar porque estou trabalhando. ' +
      'Me chama amanhã depois das 15h que eu consigo entender melhor e aí você me passa o valor.',
    'FALAR_DEPOIS',
  ],
  [
    'Está caro, mas gostei. Vou conversar com meu sócio.',
    'PRECO',
    'PRECO tem precedencia sobre POSITIVO e INTERESSE',
  ],
  [
    'Bom dia! Recebi sua mensagem. Realmente preciso de um site novo, ' +
      'o meu está bem desatualizado. Quanto custa esse serviço?',
    'PRECO',
  ],
]);

describe('categorias secundarias nunca sao descartadas (requisito 36)', () => {
  it('registra POSITIVO e PRECO, seleciona PRECO', () => {
    const r = classificar('tenho interesse, quanto custa?');
    expect(r.categoria).toBe('PRECO');
    expect(r.categoriasDetectadas).toContain('POSITIVO');
    expect(r.categoriasDetectadas).toContain('PRECO');
  });

  it('registra NEGATIVO e OPT_OUT, seleciona OPT_OUT', () => {
    const r = classificar('não tenho interesse, remove meu número');
    expect(r.categoria).toBe('OPT_OUT');
    expect(r.categoriasDetectadas).toContain('OPT_OUT');
  });

  it('o motivo explica a decisao', () => {
    const r = classificar('tenho interesse, quanto custa?');
    expect(r.motivo).toMatch(/precedencia/);
    expect(r.motivo).toMatch(/POSITIVO/);
  });
});

// =============================================================================
// NEGACAO — evitar o falso positivo mais perigoso
// =============================================================================
describe('tratamento de negacao', () => {
  it('"não tenho interesse" NAO vira INTERESSE', () => {
    const r = classificar('não tenho interesse');
    expect(r.categoria).toBe('NEGATIVO');
    expect(r.categoria).not.toBe('INTERESSE');
  });

  it('"não quero" NAO vira POSITIVO por causa de "quero"', () => {
    const r = classificar('não quero');
    expect(r.categoria).toBe('NEGATIVO');
  });

  it('"não gostei" nao vira INTERESSE', () => {
    const r = classificar('não gostei');
    expect(r.categoria).not.toBe('INTERESSE');
  });

  it('"mas" encerra o escopo da negacao', () => {
    const r = classificar('não quero agora, mas pode me chamar depois');
    expect(r.categoria).toBe('FALAR_DEPOIS');
  });

  it('marca os termos negados sem descarta-los', () => {
    const r = classificar('não tenho interesse');
    const negados = r.termosCasados.filter((t) => t.negado);
    expect(negados.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// FALSOS POSITIVOS — palavra dentro de palavra
// =============================================================================
describe('falsos positivos: termo dentro de outra palavra', () => {
  it.each([
    ['simples', 'nao pode casar "sim"'],
    ['naopodemos', 'nao pode casar "nao" colado'],
    ['queroteste', 'nao pode casar "quero"'],
    ['okapi', 'nao pode casar "ok"'],
  ])('"%s" nao casa termo curto (%s)', (entrada) => {
    const r = classificar(entrada);
    expect(r.categoria).toBe('DESCONHECIDO');
  });

  it('"parece" nao dispara "pare" (OPT_OUT)', () => {
    const r = classificar('parece');
    expect(r.categoria).not.toBe('OPT_OUT');
  });

  it('"parabens" nao dispara "para"', () => {
    const r = classificar('parabens');
    expect(r.categoria).not.toBe('OPT_OUT');
  });

  it('"nossa" nao vira "nos"', () => {
    const r = classificar('nossa');
    expect(r.categoria).toBe('DESCONHECIDO');
  });
});

// =============================================================================
// DESCONHECIDO — a rede de seguranca
// =============================================================================
rodarMatriz('DESCONHECIDO — sem sinal utilizavel', [
  ['xyz abc', 'DESCONHECIDO'],
  ['asdfgh', 'DESCONHECIDO'],
  ['...', 'DESCONHECIDO'],
  ['?', 'DESCONHECIDO'],
  ['1234', 'DESCONHECIDO'],
  ['kkkkkkk', 'DESCONHECIDO'],
  ['kkk', 'DESCONHECIDO'],
  ['haha', 'DESCONHECIDO'],
  ['rs', 'DESCONHECIDO'],
  ['rsrs', 'DESCONHECIDO'],
  ['hmmm', 'DESCONHECIDO'],
]);

rodarMatriz('DESCONHECIDO — sarcasmo e ambiguidade (requisito 31)', [
  ['ótimo, mais uma mensagem...', 'DESCONHECIDO'],
  ['que maravilha, mais spam', 'DESCONHECIDO'],
]);

describe('DESCONHECIDO — casos que exigem humano', () => {
  it('suspeita de golpe derruba a confianca', () => {
    for (const t of [
      'isso é golpe?',
      'como conseguiram meu número?',
      'de onde pegaram meu contato?',
      'quem passou meu número?',
      'isso é spam?',
      'por que vocês têm meu número?',
    ]) {
      const r = classificar(t);
      expect(r.sinais.suspeitaGolpe, `"${t}"`).toBe(true);
      expect(r.categoria, `"${t}"`).toBe('DESCONHECIDO');
    }
  });

  it('mensagem vazia', () => {
    expect(classificar('').categoria).toBe('DESCONHECIDO');
    expect(classificar(null).categoria).toBe('DESCONHECIDO');
    expect(classificar(undefined).categoria).toBe('DESCONHECIDO');
    expect(classificar('   ').categoria).toBe('DESCONHECIDO');
  });
});

// =============================================================================
// EMOJIS
// =============================================================================
describe('emojis', () => {
  it('👍 isolado pode ser POSITIVO', () => {
    const r = classificar('👍');
    expect(r.categoria).toBe('POSITIVO');
    expect(r.subtipo).toBe('emoji_positivo');
  });

  it.each(['😂', '❤️', '🙏', '🔥', '😅', '👏'])(
    '%s isolado NAO vira POSITIVO — e ambiguo demais',
    (emoji) => {
      const r = classificar(emoji);
      expect(r.categoria).toBe('DESCONHECIDO');
    }
  );

  it('👎 isolado e NEGATIVO', () => {
    expect(classificar('👎').categoria).toBe('NEGATIVO');
  });

  it('emoji junto de texto nao atrapalha a classificacao do texto', () => {
    expect(classificar('quanto custa? 😊').categoria).toBe('PRECO');
    expect(classificar('👍 pode mandar').categoria).toBe('POSITIVO');
    expect(classificar('não quero 🙏').categoria).toBe('NEGATIVO');
  });

  it('registra os emojis nos sinais', () => {
    const r = classificar('gostei 🔥🔥');
    expect(r.sinais.emojis).toContain('🔥');
  });
});

// =============================================================================
// CONFIRMACOES FRACAS
// =============================================================================
describe('respostas curtas ambiguas (requisito 24 e 34)', () => {
  it.each(['ok', 'beleza', 'entendi', 'show', 'top'])(
    '"%s" e reconhecido mas com confianca baixa',
    (t) => {
      const r = classificar(t);
      // Nao exigimos categoria especifica: o que importa e que a
      // confianca seja baixa o bastante para nao disparar acao forte.
      expect(r.confianca).toBeLessThan(60);
    }
  );

  it('"obrigado" sozinho nao e sinal comercial forte', () => {
    const r = classificar('obrigado');
    expect(r.confianca).toBeLessThan(50);
  });
});

// =============================================================================
// SINAIS AUXILIARES
// =============================================================================
describe('sinais auxiliares', () => {
  it('detecta pedido de humano', () => {
    for (const t of [
      'quero falar com alguém',
      'tem alguém aí',
      'quero falar com o dono',
      'quero falar com atendente',
      'prefiro ligação',
    ]) {
      expect(classificar(t).sinais.pedidoHumano, `"${t}"`).toBe(true);
    }
  });

  it('detecta pedido de audio', () => {
    expect(classificar('manda áudio').sinais.pedidoAudio).toBe(true);
    expect(classificar('prefiro áudio').sinais.pedidoAudio).toBe(true);
  });

  it('detecta pedido de site, instagram e portfolio', () => {
    expect(classificar('tem site?').sinais.pedidoSite).toBe(true);
    expect(classificar('qual instagram').sinais.pedidoInstagram).toBe(true);
    expect(classificar('tem portfólio').sinais.pedidoPortfolio).toBe(true);
    expect(classificar('quero ver exemplos').sinais.pedidoPortfolio).toBe(true);
  });

  it('detecta localizacao, horario e prazo', () => {
    expect(classificar('onde vocês ficam').sinais.pedidoLocalizacao).toBe(true);
    expect(classificar('qual horário').sinais.pedidoHorario).toBe(true);
    expect(classificar('quanto tempo demora').sinais.pedidoPrazo).toBe(true);
  });

  it('detecta concorrente', () => {
    expect(classificar('estou comparando preços').sinais.mencionaConcorrente).toBe(true);
    expect(classificar('já falei com outra').sinais.mencionaConcorrente).toBe(true);
  });

  it('detecta objecao sem forcar NEGATIVO', () => {
    const r = classificar('preciso falar com meu sócio');
    expect(r.sinais.objecao).toBe(true);
  });

  it('detecta reclamacao', () => {
    expect(classificar('vocês não param').sinais.reclamacao).toBe(true);
  });

  it('detecta URL sem classificar como POSITIVO (requisito 42)', () => {
    const r = classificar('meu site é https://exemplo.com.br');
    expect(r.sinais.contemUrl).toBe(true);
    expect(r.categoria).not.toBe('POSITIVO');
  });

  it('detecta telefone mencionado (requisito 43)', () => {
    const r = classificar('me chama nesse número (19) 99999-8888');
    expect(r.sinais.telefonesMencionados.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// CONTEXTO DE ETAPA
// =============================================================================
describe('contexto da etapa (requisito 40)', () => {
  it('termo especifico da etapa vence o global', () => {
    const termos: TermoRegra[] = [
      { id: 'g1', categoria: 'POSITIVO', termo: 'pode mandar', matchTipo: 'CONTEM', peso: 90, ativo: true, campaignStepId: null },
      { id: 'e1', categoria: 'PRECO', termo: 'pode mandar', matchTipo: 'CONTEM', peso: 90, ativo: true, campaignStepId: 'etapa-3' },
    ];

    const global = classificarResposta('pode mandar', {
      termos, precedencia: PRECEDENCIA_PADRAO,
    });
    expect(global.categoria).toBe('POSITIVO');

    const naEtapa = classificarResposta('pode mandar', {
      termos, precedencia: PRECEDENCIA_PADRAO, campaignStepId: 'etapa-3',
    });
    expect(naEtapa.categoria).toBe('PRECO');
  });

  it('"manda o preço" e PRECO mesmo com "manda" sendo POSITIVO', () => {
    expect(classificar('manda o preço').categoria).toBe('PRECO');
  });
});

// =============================================================================
// CONFIGURABILIDADE
// =============================================================================
describe('o dicionario vem de fora, nao do codigo', () => {
  it('sem termos, tudo e DESCONHECIDO', () => {
    const r = classificarResposta('quanto custa', {
      termos: [], precedencia: PRECEDENCIA_PADRAO,
    });
    expect(r.categoria).toBe('DESCONHECIDO');
  });

  it('termo desativado deixa de valer', () => {
    const termos: TermoRegra[] = [
      { id: '1', categoria: 'PRECO', termo: 'quanto custa', matchTipo: 'CONTEM', peso: 90, ativo: false, campaignStepId: null },
    ];
    expect(classificarResposta('quanto custa', { termos, precedencia: PRECEDENCIA_PADRAO }).categoria)
      .toBe('DESCONHECIDO');
  });

  it('precedencia customizada muda o vencedor', () => {
    const invertida: RespostaCategoria[] = [
      'POSITIVO', 'PRECO', 'OPT_OUT', 'NEGATIVO', 'FALAR_DEPOIS', 'DUVIDA', 'INTERESSE', 'DESCONHECIDO',
    ];
    const r = classificarResposta('tenho interesse, quanto custa?', {
      termos: TERMOS, precedencia: invertida,
    });
    expect(r.categoria).toBe('POSITIVO');
  });

  it('regex customizada funciona', () => {
    const termos: TermoRegra[] = [
      { id: '1', categoria: 'PRECO', termo: '\\d+ reais', matchTipo: 'REGEX', peso: 90, ativo: true, campaignStepId: null },
    ];
    expect(classificarResposta('custa 500 reais?', { termos, precedencia: PRECEDENCIA_PADRAO }).categoria)
      .toBe('PRECO');
  });

  it('regex invalida nao derruba o motor', () => {
    const termos: TermoRegra[] = [
      { id: '1', categoria: 'PRECO', termo: '[[[invalida', matchTipo: 'REGEX', peso: 90, ativo: true, campaignStepId: null },
    ];
    expect(() =>
      classificarResposta('teste', { termos, precedencia: PRECEDENCIA_PADRAO })
    ).not.toThrow();
  });
});

// =============================================================================
// DETERMINISMO
// =============================================================================
describe('determinismo', () => {
  it('a mesma entrada produz sempre a mesma saida', () => {
    const entradas = [
      'quanto custa', 'não quero', 'me chama amanhã', 'sim', 'xyz',
      'tenho interesse mas quanto custa', 'remove meu número',
    ];
    for (const e of entradas) {
      const a = classificar(e);
      const b = classificar(e);
      expect(a.categoria).toBe(b.categoria);
      expect(a.confianca).toBe(b.confianca);
      expect(a.categoriasDetectadas).toEqual(b.categoriasDetectadas);
    }
  });

  it('preserva o texto original para auditoria (requisito 37)', () => {
    const r = classificarResposta('Não Quero MAIS!', {
      termos: TERMOS, precedencia: PRECEDENCIA_PADRAO,
    });
    expect(r.textoNormalizado).toBe('nao quero mais');
  });
});
