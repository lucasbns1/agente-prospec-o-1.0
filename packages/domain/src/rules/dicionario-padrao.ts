/**
 * Dicionario padrao do motor de regras.
 *
 * ESTE ARQUIVO NAO E O DICIONARIO DE RUNTIME. Ele e a SEMENTE: o seed
 * grava tudo isto na tabela `response_keywords`, e e de la que o motor
 * le em producao. Voce pode editar, desativar e acrescentar termos pelo
 * painel sem tocar em codigo.
 *
 * Ele mora em `domain` (e nao no seed) para que os testes possam
 * exercitar o dicionario real sem precisar de banco.
 *
 * ---------------------------------------------------------------
 * COMO OS PESOS FUNCIONAM
 * ---------------------------------------------------------------
 * O peso desempata termos da MESMA categoria e alimenta a confianca.
 * Ele NAO participa da precedencia entre categorias — essa ordem e
 * absoluta e vem das configuracoes.
 *
 *   90-100  frase inequivoca ("nao quero receber mais mensagens")
 *   70-89   frase clara ("quanto custa")
 *   50-69   expressao provavel ("pode mandar")
 *   30-49   sinal fraco ("legal", "talvez")
 *   10-29   pista tenue, so conta se nada melhor casar
 *
 * Termos curtos e ambiguos recebem peso baixo de proposito: "ok" nao
 * pode ter a mesma forca de "quero contratar".
 */
import type { RespostaCategoria, MatchTipo } from '@prospector/shared';

export interface TermoPadrao {
  categoria: RespostaCategoria;
  termo: string;
  matchTipo: MatchTipo;
  peso: number;
  subtipo: string;
}

/** Atalho para declarar os termos de forma compacta. */
function t(
  categoria: RespostaCategoria,
  subtipo: string,
  peso: number,
  matchTipo: MatchTipo,
  ...termos: string[]
): TermoPadrao[] {
  return termos.map((termo) => ({ categoria, termo, matchTipo, peso, subtipo }));
}

// =============================================================================
// OPT_OUT — a categoria mais importante do sistema
//
// Um falso negativo aqui significa continuar mandando mensagem para
// quem pediu para parar. Por isso os pesos sao altos e a cobertura e a
// mais ampla de todas.
// =============================================================================
const OPT_OUT: TermoPadrao[] = [
  ...t('OPT_OUT', 'opt_out_direto', 100, 'CONTEM',
    // "nao quero receber" sozinho e opt-out, nao apenas recusa da oferta.
    //
    // Sem ele, a frase caia em NEGATIVO ("nao quero", peso 90) e o lead
    // continuava alcancavel por campanha. O risco inverso — alguem
    // dizendo "nao quero receber o orcamento por email" e sendo marcado
    // como opt-out — custa um lead. Subdetectar opt-out custa mandar
    // mensagem para quem pediu para parar. Os dois erros nao tem o mesmo
    // peso.
    'nao quero receber',
    'nao quero receber mais', 'nao quero receber mensagens',
    'nao quero receber mais mensagens', 'nao quero mais mensagens',
    'nao me mande mais', 'nao me mande mensagem', 'nao me mande mais mensagens',
    'nao manda mais', 'nao manda mais nada', 'nao mande mais',
    'nao envie mais', 'nao envie mais mensagens',
    'pare de mandar', 'para de mandar', 'pare de enviar', 'para de enviar',
    'pare de mandar mensagem', 'para de manda', 'pare de manda',
    'pode parar de mandar', 'pode parar',
    'chega de mensagem', 'chega de mandar mensagem', 'chega de mensagens',
    'nao me chama mais', 'nao chama mais', 'nao me chame mais',
    'nao entre mais em contato', 'nao entre em contato novamente',
    'nao quero contato', 'nao quero contato mais', 'sem contato',
    'nao quero papo', 'sem mensagem',
  ),
  ...t('OPT_OUT', 'remocao_cadastro', 100, 'CONTEM',
    'retira meu numero', 'retire meu numero', 'remove meu numero',
    'remova meu numero', 'tira meu numero', 'tire meu numero',
    'tira meu numero dai', 'apaga meu contato', 'apague meu contato',
    'remova meu contato', 'remove meu contato',
    'me exclui', 'me exclua', 'me tira da lista', 'me retire da lista',
    'remove da lista', 'retira da lista', 'tira da lista',
    'me tira disso', 'me deixa fora', 'descadastrar', 'descadastre',
    'cancelar inscricao', 'sair da lista',
  ),
  ...t('OPT_OUT', 'opt_out_agressivo', 100, 'CONTEM',
    'nao perturbe', 'nao enche', 'nao enche mais', 'nao insiste',
    'nao precisa insistir', 'para com isso', 'parem de me chamar',
    'ja falei que nao', 'ja disse que nao', 'eu ja disse nao',
    'ja disse que nao quero', 'ja pedi para parar',
    'quantas vezes vou ter que falar', 'nao aguento mais mensagem',
    'voces nao param', 'voces continuam mandando', 'que insistencia',
    'vou denunciar', 'vou bloquear', 'vou reportar',
  ),
  ...t('OPT_OUT', 'opt_out_curto', 85, 'EXATO',
    'pare', 'parar', 'stop', 'chega', 'ja deu',
  ),
  ...t('OPT_OUT', 'opt_out_curto', 80, 'CONTEM',
    'stop por favor', 'pare por favor', 'chega por favor',
    'deixa pra la', 'larga mao', 'nao precisa mais',
  ),
  // "spam" sozinho e fraco de proposito: aparece em frases sarcasticas
  // ("mais spam...") que NAO sao pedido de remocao. Com peso abaixo do
  // minimo de confianca, so conta se algo mais forte tambem casar.
  ...t('OPT_OUT', 'spam', 25, 'PALAVRA', 'spam'),
];

// =============================================================================
// NEGATIVO
// =============================================================================
const NEGATIVO: TermoPadrao[] = [
  ...t('NEGATIVO', 'sem_interesse', 95, 'CONTEM',
    'nao tenho interesse', 'nao tenho interesse nisso',
    'nao tenho interesse no servico', 'nao tenho interesse agora',
    'nao tenho interesse nenhum', 'nao estou interessado',
    'nao estou interessada', 'nao me interessa', 'nao me interessa isso',
    'nao e do meu interesse', 'sem interesse', 'sem interesse mesmo',
    'nao interessa',
  ),
  ...t('NEGATIVO', 'sem_necessidade', 90, 'CONTEM',
    'nao preciso', 'nao preciso disso', 'nao preciso desse servico',
    'nao vou precisar', 'nao tenho necessidade', 'nao tenho necessidade disso',
    'nao necessito',
  ),
  ...t('NEGATIVO', 'recusa_contratacao', 90, 'CONTEM',
    'nao quero', 'nao quero isso', 'nao quero esse servico',
    'nao quero contratar', 'nao pretendo contratar', 'nao pretendo',
    'nao vou contratar', 'nao tenho intencao', 'nao tenho intencao de contratar',
    'nao vou fechar', 'nao vamos fechar',
  ),
  ...t('NEGATIVO', 'ja_atendido', 80, 'CONTEM',
    'ja tenho', 'ja tenho alguem', 'ja tenho fornecedor', 'ja tenho empresa',
    'ja trabalho com outra', 'ja tenho parceiro', 'ja resolvi isso',
    'ja resolvemos', 'isso ja esta resolvido', 'nao preciso mudar',
    'estou satisfeito com quem tenho', 'ja tenho site', 'ja tenho quem faca',
  ),
  ...t('NEGATIVO', 'recusa_curta', 70, 'EXATO',
    'nao', 'nop', 'nope', 'nah', 'nem', 'dispenso', 'passo', 'negativo',
  ),
  ...t('NEGATIVO', 'recusa_curta', 55, 'CONTEM',
    'nao obrigado', 'nao obrigada', 'agradeco mas nao',
    'obrigado mas nao', 'no momento nao', 'agora nao quero',
  ),
];

// =============================================================================
// FALAR_DEPOIS
// =============================================================================
const FALAR_DEPOIS: TermoPadrao[] = [
  ...t('FALAR_DEPOIS', 'reagendar_explicito', 95, 'CONTEM',
    'me chama amanha', 'me chama depois', 'me chama mais tarde',
    'me chama quando puder', 'me chame depois', 'me chame amanha',
    'fala comigo depois', 'fala comigo mais tarde', 'fala comigo amanha',
    'me procura depois', 'me procura amanha',
    'pode falar comigo outro dia', 'vamos falar outro dia',
    'me manda depois', 'manda depois', 'me liga depois',
    'te retorno', 'eu te retorno', 'depois te falo', 'depois eu te falo',
    'depois a gente conversa', 'depois falamos', 'vamos conversar depois',
    'volta a falar comigo', 'me chama semana que vem',
    'pode me chamar depois', 'pode me chamar amanha', 'me chamar depois',
    'chamar depois', 'pode falar comigo depois', 'me liga amanha',
  ),
  ...t('FALAR_DEPOIS', 'indisponivel_agora', 90, 'CONTEM',
    'agora nao posso', 'agora nao consigo', 'nao posso falar agora',
    'nao consigo falar agora', 'nao tenho tempo agora', 'estou sem tempo',
    'estou ocupado', 'estou ocupada', 'to ocupado', 'to ocupada',
    'estou trabalhando', 'estou em reuniao', 'estou em atendimento',
    'estou correndo', 'estou dirigindo', 'hoje nao consigo',
    'agora estou ocupado', 'agora estou ocupada',
  ),
  ...t('FALAR_DEPOIS', 'adiamento', 70, 'CONTEM',
    'depois eu vejo', 'depois vejo', 'mais tarde vejo',
    'vamos deixar pra depois', 'deixa pra outro dia', 'outro momento',
    'em outro momento', 'quando eu puder', 'quando der',
  ),
  ...t('FALAR_DEPOIS', 'adiamento', 60, 'EXATO',
    'agora nao', 'hoje nao', 'depois', 'mais tarde', 'outro dia',
  ),
  ...t('FALAR_DEPOIS', 'prazo_futuro', 55, 'CONTEM',
    'semana que vem', 'mes que vem', 'no final do mes',
    'proxima semana', 'proximo mes', 'na semana que vem',
    'me chama na segunda', 'segunda feira', 'depois do feriado',
  ),
  ...t('FALAR_DEPOIS', 'prazo_futuro', 40, 'PALAVRA',
    'amanha', 'segunda', 'terca', 'quarta', 'quinta', 'sexta',
  ),
];

// =============================================================================
// PRECO
// =============================================================================
const PRECO: TermoPadrao[] = [
  ...t('PRECO', 'preco_direto', 95, 'CONTEM',
    'quanto custa', 'quanto custa isso', 'quanto e', 'quanto fica',
    'quanto fica isso', 'quanto sai', 'quanto sai isso',
    'qual o preco', 'qual preco', 'qual e o preco',
    'qual o valor', 'qual valor', 'qual e o valor',
    'quanto voces cobram', 'quanto voces cobram por isso',
    'quanto voce cobra', 'quanto vai custar', 'quanto seria',
    'me passa o preco', 'me passa o valor', 'me fala o valor',
    'me fala quanto custa', 'pode mandar preco', 'manda preco',
    'manda valor', 'manda o valor', 'manda o preco', 'me diz o valor',
  ),
  ...t('PRECO', 'tabela', 75, 'CONTEM',
    'tem preco', 'tem tabela', 'tem tabela de preco', 'tem valores',
    'quais os valores', 'quais valores', 'tem uma tabela',
  ),
  ...t('PRECO', 'pedido_orcamento', 90, 'CONTEM',
    'faz orcamento', 'fazem orcamento', 'voces fazem orcamento',
    'pode fazer orcamento', 'quero orcamento', 'preciso de orcamento',
    'manda orcamento', 'me manda orcamento', 'quanto fica o orcamento',
    'me passa um orcamento', 'gostaria de um orcamento', 'tem orcamento',
  ),
  ...t('PRECO', 'negociacao', 80, 'CONTEM',
    'tem desconto', 'consegue desconto', 'faz desconto',
    'tem como melhorar', 'tem como negociar', 'da pra negociar',
    'consegue fazer por menos', 'qual o menor valor',
    'tem condicao melhor', 'faz por menos', 'melhora o preco',
  ),
  ...t('PRECO', 'negociacao', 60, 'PALAVRA', 'negocia', 'negociar'),
  ...t('PRECO', 'forma_pagamento', 75, 'CONTEM',
    'forma de pagamento', 'formas de pagamento', 'como posso pagar',
    'aceita cartao', 'aceita pix', 'aceita boleto',
    'da pra parcelar', 'tem parcelamento', 'pode parcelar',
  ),
  ...t('PRECO', 'forma_pagamento', 50, 'PALAVRA',
    'parcela', 'parcelamento', 'parcelado', 'pix', 'cartao', 'boleto',
  ),
  ...t('PRECO', 'preco_indireto', 65, 'CONTEM',
    'e caro', 'achei caro', 'muito caro', 'ta caro', 'esta caro',
    'e barato', 'vale quanto', 'vale a pena pelo preco', 'compensa',
    'fora do meu orcamento', 'acima do meu orcamento',
  ),
  ...t('PRECO', 'preco_curto', 55, 'EXATO',
    'preco', 'valor', 'quanto', 'valores', 'orcamento',
  ),
];

// =============================================================================
// DUVIDA
// =============================================================================
const DUVIDA: TermoPadrao[] = [
  ...t('DUVIDA', 'funcionamento', 90, 'CONTEM',
    'como funciona', 'como funciona isso', 'como funciona o processo',
    'como voces trabalham', 'como voce trabalha', 'como seria',
    'como seria isso', 'como acontece', 'qual o processo',
    'como e o processo', 'como e feito', 'como faz',
  ),
  ...t('DUVIDA', 'explicacao', 85, 'CONTEM',
    'me explica', 'pode explicar', 'explica melhor', 'explica direito',
    'nao entendi', 'nao entendi direito', 'nao entendi bem',
    'como assim', 'do que se trata', 'que servico e esse',
    'nao ficou claro',
  ),
  ...t('DUVIDA', 'escopo', 80, 'CONTEM',
    'o que voces fazem', 'o que voces oferecem', 'o que esta incluso',
    'o que inclui', 'o que vem junto', 'o que eu recebo',
    'quais servicos', 'que tipo de servico',
  ),
  ...t('DUVIDA', 'garantia', 80, 'CONTEM',
    'tem garantia', 'qual garantia', 'qual a garantia',
    'tem contrato', 'precisa contrato', 'como contrato',
    'tem fidelidade', 'tem multa',
  ),
  ...t('DUVIDA', 'inicio', 70, 'CONTEM',
    'como comeca', 'como faco', 'o que preciso fazer',
    'preciso enviar alguma coisa', 'o que preciso enviar',
    'como eu faco', 'por onde comeco',
  ),
  ...t('DUVIDA', 'identificacao', 60, 'CONTEM',
    'quem e voce', 'quem fala', 'que empresa', 'de qual empresa',
    'voce e de onde', 'qual empresa',
  ),
];

// =============================================================================
// POSITIVO
// =============================================================================
const POSITIVO: TermoPadrao[] = [
  ...t('POSITIVO', 'confirmacao_forte', 95, 'CONTEM',
    'tenho interesse', 'tenho interesse sim', 'quero sim',
    'quero contratar', 'quero fechar', 'vamos fechar',
    'quero saber mais', 'quero entender', 'quero conhecer',
    'me interessa', 'me interessou', 'estou interessado',
    'estou interessada', 'pode contar comigo',
  ),
  ...t('POSITIVO', 'autorizacao_envio', 90, 'CONTEM',
    'pode mandar', 'pode mandar sim', 'pode me mandar',
    'pode enviar', 'pode mostrar', 'pode me mostrar',
    'pode falar', 'pode sim', 'manda ai', 'manda sim',
    'quero ver', 'gostaria de ver', 'me mostra', 'mostra ai',
    'estou curioso para ver', 'pode apresentar',
  ),
  ...t('POSITIVO', 'abertura_comercial', 85, 'CONTEM',
    'vamos conversar', 'podemos conversar', 'podemos falar',
    'quero conversar', 'quero falar', 'vamos marcar', 'vamos agendar',
    'pode entrar em contato', 'pode me chamar', 'pode ligar',
    'bora conversar',
  ),
  ...t('POSITIVO', 'confirmacao_identidade', 80, 'CONTEM',
    'sou eu', 'sim sou eu', 'e comigo mesmo', 'sou eu sim',
    'aqui e ela', 'aqui e ele',
  ),
  ...t('POSITIVO', 'afirmacao_simples', 70, 'EXATO',
    'sim', 'quero', 'claro', 'manda', 'envia', 'bora', 'vamos',
    'fechado', 'fechou', 'combinado', 'perfeito', 'isso', 'exato',
    'positivo', 'certo', 'certeza',
  ),
  ...t('POSITIVO', 'afirmacao_simples', 60, 'CONTEM',
    'sim quero', 'vamos sim', 'claro que sim', 'com certeza',
    'sim pode', 'sim por favor',
  ),
  // Confirmacoes fracas: sozinhas nao bastam para agir com seguranca.
  ...t('POSITIVO', 'confirmacao_fraca', 35, 'EXATO',
    'ok', 'okay', 'beleza', 'blz', 'show', 'top', 'otimo', 'otima',
    'massa', 'joia', 'tranquilo', 'uhum', 'aham',
  ),
  ...t('POSITIVO', 'agradecimento', 25, 'EXATO',
    'obrigado', 'obrigada', 'valeu', 'agradecido',
  ),
];

// =============================================================================
// INTERESSE — sinal presente, confirmacao ausente
// =============================================================================
const INTERESSE: TermoPadrao[] = [
  ...t('INTERESSE', 'reacao_positiva', 55, 'CONTEM',
    'parece interessante', 'achei interessante', 'parece bom',
    'parece legal', 'me chamou atencao', 'chamou minha atencao',
    'gostei sim', 'ficou bom', 'ficou otimo', 'muito bom',
    'ficou legal', 'ficou bacana',
  ),
  ...t('INTERESSE', 'reacao_positiva', 45, 'EXATO',
    'interessante', 'legal', 'bacana', 'gostei', 'adorei', 'bonito',
  ),
  ...t('INTERESSE', 'consideracao', 40, 'CONTEM',
    'vou pensar', 'vou analisar', 'vou olhar', 'vou verificar',
    'vou ver', 'vamos ver', 'preciso pensar', 'tenho que pensar',
    'vou avaliar', 'deixa eu ver',
  ),
  ...t('INTERESSE', 'curiosidade', 35, 'CONTEM',
    'tenho curiosidade', 'fiquei curioso', 'fiquei curiosa',
    'pode ser interessante', 'quem sabe',
  ),
  ...t('INTERESSE', 'hesitacao', 30, 'EXATO',
    'talvez', 'pode ser', 'entendi', 'hmm', 'hum', 'humm', 'ah sim',
  ),
];

/** Dicionario completo, na ordem das categorias. */
export const DICIONARIO_PADRAO: TermoPadrao[] = [
  ...OPT_OUT,
  ...NEGATIVO,
  ...FALAR_DEPOIS,
  ...PRECO,
  ...DUVIDA,
  ...POSITIVO,
  ...INTERESSE,
];

/** Contagem por categoria — usada nos testes e no relatorio do seed. */
export function contarPorCategoria(): Record<string, number> {
  const contagem: Record<string, number> = {};
  for (const termo of DICIONARIO_PADRAO) {
    contagem[termo.categoria] = (contagem[termo.categoria] ?? 0) + 1;
  }
  return contagem;
}
