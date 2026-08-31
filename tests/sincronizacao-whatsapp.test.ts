/**
 * A sincronizacao entre o banco e o WhatsApp.
 *
 * ============================================================
 * O DEFEITO QUE ESTES TESTES TRANCAM
 * ============================================================
 * A varredura de mensagens perdidas rodava UMA vez, dez segundos depois
 * de o WhatsApp conectar, e nunca mais. Enquanto o worker ficava de pe,
 * o evento ao vivo cobria tudo; no minuto em que ele caia, as respostas
 * daquele intervalo simplesmente nao existiam para o sistema.
 *
 * Nao era hipotetico. Um lead respondeu duas vezes no WhatsApp e o
 * diagnostico mostrava `RESPOSTAS DELE (0)`, com a cadencia congelada
 * esperando algo que ninguem sabia que tinha chegado. E pior: uma
 * varredura que parou de rodar era INDISTINGUIVEL de uma que roda e nao
 * acha nada — as duas produzem a mesma tela.
 *
 * ============================================================
 * NENHUM ENVIO REAL, NENHUMA CHAMADA AO GOOGLE
 * ============================================================
 * O adapter e de mentira e o analisador e roteirizado. Postgres e Redis
 * sao reais; o WhatsApp e o modelo, nunca.
 *
 * Requer Postgres e Redis no ar, migrado e com seed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { Logger } from 'pino';
import type {
  AnalisadorDeCadencia,
  MensagemEntrada,
  ResultadoAnalise,
  WhatsAppAdapter,
} from '@prospector/integrations';
import type { ContextoCadencia, DecisaoIA } from '@prospector/domain';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });
process.env.LOG_LEVEL = 'silent';

const log = {
  error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
} as unknown as Logger;

let prisma: typeof import('@prospector/database').prisma;
let rec: typeof import('../apps/worker/src/services/recuperar-perdidas.js');
let periodica: typeof import('../apps/worker/src/services/varredura-periodica.js');
let orq: typeof import('../apps/worker/src/services/orquestrador.js');
let filas: typeof import('../apps/worker/src/queues.js');
let sinc: typeof import('../apps/api/src/services/sincronizacao-service.js');
let gatilhos: typeof import('../apps/worker/src/services/gatilhos-ia.js');

beforeAll(async () => {
  prisma = (await import('@prospector/database')).prisma;
  rec = await import('../apps/worker/src/services/recuperar-perdidas.js');
  periodica = await import('../apps/worker/src/services/varredura-periodica.js');
  orq = await import('../apps/worker/src/services/orquestrador.js');
  filas = await import('../apps/worker/src/queues.js');
  sinc = await import('../apps/api/src/services/sincronizacao-service.js');
  gatilhos = await import('../apps/worker/src/services/gatilhos-ia.js');
  filas.inicializarFilas();
}, 60_000);

afterAll(async () => {
  await filas?.fecharFilas();
  await prisma?.$disconnect();
});

beforeEach(async () => {
  // As marcas da varredura sao Settings REAIS e persistentes. Sem
  // limpar, um teste de "desatualizado" compararia com o carimbo que o
  // teste anterior deixou.
  await prisma.setting.deleteMany({
    where: {
      chave: {
        in: [
          'canal.varredura_desde',
          sincChaves.ultima,
          sincChaves.recuperadas,
        ],
      },
    },
  });
  await prisma.aiDecision.deleteMany();
  await prisma.unknownContact.deleteMany();
  await prisma.outboundMessage.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.leadEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.leadCampaign.deleteMany();
  await prisma.campaignStepRule.deleteMany();
  await prisma.campaignStep.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.lead.deleteMany();
});

// As chaves sao lidas dos dois lados (worker grava, API le) e o teste
// nao pode importa-las antes do `beforeAll`. Ficam literais aqui de
// proposito: se um dos lados renomear, um teste abaixo pega a
// divergencia em vez de os dois deslizarem juntos.
const sincChaves = {
  ultima: 'canal.ultima_varredura',
  recuperadas: 'canal.ultima_varredura_novas',
};

let n = 0;

async function criarLead(over: Record<string, unknown> = {}) {
  n += 1;
  return prisma.lead.create({
    data: {
      nomeCompleto: `Studio Sinc ${n}`,
      empresa: `Studio Sinc ${n}`,
      telefone: `(11) 9${String(70000000 + n).slice(-8)}`,
      telefoneNormalizado: `55119${String(70000000 + n).slice(-8)}`,
      cidade: 'São Paulo',
      websiteStatus: 'NAO_INFORMADO',
      status: 'AGUARDANDO_RESPOSTA',
      ...over,
    } as never,
  });
}

async function criarCampanhaCom(lead: { id: string }) {
  n += 1;
  const campanha = await prisma.campaign.create({
    data: {
      nome: `Campanha Sinc ${Date.now()}-${n}`,
      status: 'ATIVA',
      // DRY-RUN. Nenhum teste desta suite pode produzir um envio real.
      dryRun: true,
      delayMinSegundos: 0,
      delayMaxSegundos: 0,
      delayEntreLeadsMinSegundos: 0,
      delayEntreLeadsMaxSegundos: 0,
      horarioInicio: '00:00',
      horarioFim: '23:59',
      diasPermitidos: [0, 1, 2, 3, 4, 5, 6],
      filtros: {} as never,
    },
  });

  const etapas = [];
  for (let i = 1; i <= 3; i += 1) {
    etapas.push(
      await prisma.campaignStep.create({
        data: {
          campaignId: campanha.id,
          ordem: i,
          texto: `Mensagem ${i} para {{empresa}}`,
          ativo: true,
          aguardarResposta: false,
          enviarAutomaticamente: true,
        },
      })
    );
  }

  await prisma.leadCampaign.create({
    data: { leadId: lead.id, campaignId: campanha.id, status: 'EM_ANDAMENTO' },
  });

  return { campanha, etapas };
}

/**
 * Adapter de mentira.
 *
 * So o metodo da varredura e real; o resto lanca de proposito. Se a
 * recuperacao passar a depender de outra coisa do adapter, o teste
 * quebra e diz qual.
 */
function adapterCom(
  mensagens: MensagemEntrada[] | (() => MensagemEntrada[] | Promise<never>)
): { adapter: WhatsAppAdapter; pedidos: Date[] } {
  const pedidos: Date[] = [];
  const naoUsar = (): never => {
    throw new Error('A varredura não deveria chamar isto');
  };

  const adapter = {
    modo: 'live',
    mensagensPerdidas: async (desde: Date) => {
      pedidos.push(desde);
      const lista = typeof mensagens === 'function' ? await mensagens() : mensagens;
      return lista.filter((m) => m.recebidaEm >= desde);
    },
    connect: naoUsar,
    disconnect: naoUsar,
    getStatus: naoUsar,
    sendMessage: naoUsar,
    isRegistered: naoUsar,
    getContacts: naoUsar,
    onReady: naoUsar,
    onQr: naoUsar,
    onMessage: naoUsar,
    onDisconnected: naoUsar,
    onStatusChange: naoUsar,
  } as unknown as WhatsAppAdapter;

  return { adapter, pedidos };
}

function entrada(
  telefone: string,
  texto: string,
  recebidaEm: Date,
  over: Partial<MensagemEntrada> = {}
): MensagemEntrada {
  n += 1;
  return {
    providerMessageId: `sinc-${n}-${Date.now()}`,
    chatId: `${telefone}@c.us`,
    telefone,
    texto,
    nomeContato: 'Contato',
    recebidaEm,
    deMim: false,
    tipo: 'chat',
    temMidia: false,
    ...over,
  };
}

class AnalisadorFalso implements AnalisadorDeCadencia {
  readonly modelo = 'fake-1.0';
  ultimoContexto: ContextoCadencia | null = null;
  chamadas = 0;

  constructor(private readonly resposta: ResultadoAnalise) {}

  async analisar(contexto: ContextoCadencia): Promise<ResultadoAnalise> {
    this.ultimoContexto = contexto;
    this.chamadas += 1;
    return this.resposta;
  }
}

function decide(over: Partial<DecisaoIA> = {}): ResultadoAnalise {
  return {
    ok: true,
    modelo: 'fake-1.0',
    latenciaMs: 12,
    decisao: {
      intent: 'INTERESSE',
      acao: 'WAIT',
      etapaOrdem: null,
      confianca: 90,
      precisaHumano: false,
      optOut: false,
      motivo: 'decisao de teste',
      esperarSegundos: null,
      ...over,
    },
  };
}

const esperar = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// =============================================================================
// 1 a 5 — O RELOGIO DA VARREDURA
// =============================================================================

describe('reconciliação periódica', () => {
  it('1. roda mais de uma vez, sozinha, no intervalo configurado', async () => {
    const { adapter, pedidos } = adapterCom([]);

    // O menor intervalo que o codigo aceita e um minuto; o teste chama
    // `varrerAgora` na mao para provar a repeticao sem esperar isso.
    // O que o timer garante e coberto pelo caso 2 (desligar) — aqui o
    // ponto e que varrer duas vezes seguidas de fato varre duas vezes,
    // que era exatamente o que a versao de "uma vez so" nao fazia.
    await periodica.varrerAgora({ adapter, log, janelaHoras: 24, origem: 'conexao' });
    await periodica.varrerAgora({ adapter, log, janelaHoras: 24, origem: 'periodica' });

    expect(pedidos).toHaveLength(2);
  });

  it('2. intervalo 0 desliga o relógio, e desligar não é "intervalo enorme"', async () => {
    const { adapter, pedidos } = adapterCom([]);

    const parar = periodica.iniciarVarreduraPeriodica({
      adapter,
      log,
      intervaloMinutos: 0,
      janelaHoras: 24,
    });

    await esperar(50);
    parar();

    expect(pedidos).toHaveLength(0);
  });

  it('3. duas varreduras não correm juntas sobre as mesmas conversas', async () => {
    let liberar: () => void = () => {};
    const presa = new Promise<void>((r) => {
      liberar = r;
    });

    // Resolve quando a primeira varredura JÁ ESTÁ dentro do adapter. Sem
    // esperar por isso, a segunda chamada corria antes de a primeira
    // passar pela leitura de banco que antecede o adapter, e o teste
    // media o relógio da máquina em vez da guarda.
    let entrou: () => void = () => {};
    const chegou = new Promise<void>((r) => {
      entrou = r;
    });

    let chamadas = 0;
    const adapter = {
      modo: 'live',
      mensagensPerdidas: async () => {
        chamadas += 1;
        entrou();
        await presa;
        return [];
      },
    } as unknown as WhatsAppAdapter;

    const primeira = periodica.varrerAgora({
      adapter, log, janelaHoras: 24, origem: 'periodica',
    });

    try {
      await chegou;

      // A segunda chega com a primeira ainda dentro do adapter.
      const segunda = await periodica.varrerAgora({
        adapter, log, janelaHoras: 24, origem: 'manual',
      });

      expect(segunda).toMatchObject({ pulada: true });
      expect(chamadas).toBe(1);
    } finally {
      // O `finally` não é zelo: `emAndamento` é estado de módulo, e uma
      // asserção que falhasse aqui deixaria a guarda travada para todos
      // os testes seguintes deste arquivo.
      liberar();
      await primeira;
    }
  });

  it('4. uma falha na varredura não derruba quem chamou', async () => {
    const adapter = {
      modo: 'live',
      mensagensPerdidas: async () => {
        throw new Error('Chromium ainda subindo');
      },
    } as unknown as WhatsAppAdapter;

    // Sem `rejects`: o contrato e justamente NAO lancar. Ela e chamada
    // de um timer e de uma rota, e em nenhum dos dois uma falha pode
    // derrubar o chamador.
    const r = await periodica.varrerAgora({
      adapter, log, janelaHoras: 24, origem: 'periodica',
    });

    expect(r).toMatchObject({ pulada: true });
    expect((r as { motivo: string }).motivo).toContain('Chromium');
  });

  it('5. a varredura que estourou NÃO carimba "sincronizado agora"', async () => {
    const adapter = {
      modo: 'live',
      mensagensPerdidas: async () => {
        throw new Error('sessão caiu no meio');
      },
    } as unknown as WhatsAppAdapter;

    await periodica.varrerAgora({ adapter, log, janelaHoras: 24, origem: 'manual' });

    const marca = await prisma.setting.findUnique({
      where: { chave: sincChaves.ultima },
    });

    // Este e o ponto inteiro da faixa do dashboard: uma varredura que
    // falhou dizendo "sincronizado" seria pior do que nao ter faixa
    // nenhuma.
    expect(marca).toBeNull();
  });
});

// =============================================================================
// 6 a 9 — A MENSAGEM RECUPERADA
// =============================================================================

describe('mensagens recuperadas', () => {
  it('6. a resposta que o evento ao vivo não entregou é processada', async () => {
    const lead = await criarLead();
    const m = entrada(lead.telefoneNormalizado!, 'quero sim', new Date());
    const { adapter } = adapterCom([m]);

    const r = await rec.recuperarMensagensPerdidas(adapter, log);

    expect(r.novas).toBe(1);
    const gravada = await prisma.message.findUnique({
      where: { whatsappMessageId: m.providerMessageId },
    });
    expect(gravada?.texto).toBe('quero sim');
    expect(gravada?.direcao).toBe('RECEBIDA');
  });

  it('7. a mesma mensagem recuperada duas vezes não vira duas linhas', async () => {
    const lead = await criarLead();
    const m = entrada(lead.telefoneNormalizado!, 'oi', new Date());
    const { adapter } = adapterCom([m]);

    const primeira = await rec.recuperarMensagensPerdidas(adapter, log);
    const segunda = await rec.recuperarMensagensPerdidas(adapter, log);

    expect(primeira.novas).toBe(1);
    expect(segunda.novas).toBe(0);
    expect(segunda.jaConhecidas).toBe(1);

    const quantas = await prisma.message.count({
      where: { whatsappMessageId: m.providerMessageId },
    });
    expect(quantas).toBe(1);
  });

  it('8. mensagem SUA e antiga entra no histórico sem pausar a campanha', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanhaCom(lead);

    const anteontem = new Date(Date.now() - 48 * 3600_000);
    const m = entrada(lead.telefoneNormalizado!, 'te mando amanhã', anteontem, {
      deMim: true,
    });
    const { adapter } = adapterCom([m]);

    const r = await rec.recuperarMensagensPerdidas(adapter, log, new Date(), 72);

    expect(r.manuaisHistoricas).toBe(1);

    // Ela EXISTE no histórico — é isso que a IA vai ler.
    const gravada = await prisma.message.findUnique({
      where: { whatsappMessageId: m.providerMessageId },
    });
    expect(gravada?.direcao).toBe('ENVIADA');

    // E NÃO mexeu no presente: pausar hoje uma conversa por causa de
    // algo escrito anteontem travaria o lead esperando uma decisão que
    // você já tomou.
    const lc = await prisma.leadCampaign.findFirst({
      where: { leadId: lead.id, campaignId: campanha.id },
    });
    expect(lc?.status).toBe('EM_ANDAMENTO');
    expect(lc?.aguardandoLiberacao).toBe(false);

    const evento = await prisma.leadEvent.findFirst({
      where: { leadId: lead.id, origem: 'whatsapp-manual-historico' },
    });
    expect(evento).not.toBeNull();
  });

  it('9. mensagem SUA de agora ainda pausa: você acabou de entrar na conversa', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanhaCom(lead);

    const m = entrada(lead.telefoneNormalizado!, 'oi, aqui é o Lucas', new Date(), {
      deMim: true,
    });
    const { adapter } = adapterCom([m]);

    const r = await rec.recuperarMensagensPerdidas(adapter, log);

    expect(r.manuaisHistoricas).toBe(0);

    const lc = await prisma.leadCampaign.findFirst({
      where: { leadId: lead.id, campaignId: campanha.id },
    });
    expect(lc?.status).toBe('PAUSADO');
    expect(lc?.aguardandoLiberacao).toBe(true);
  });
});

// =============================================================================
// 10 a 12 — A JANELA
// =============================================================================

describe('a janela de quanto tempo olhar para trás', () => {
  it('10. worker reiniciando: a varredura da conexão pega o intervalo perdido', async () => {
    const lead = await criarLead();

    // A resposta chegou no mesmo minuto do envio, com o worker
    // reiniciando. Foi assim na validação real.
    const agoraMenosUmMinuto = new Date(Date.now() - 60_000);
    const m = entrada(lead.telefoneNormalizado!, 'claro!', agoraMenosUmMinuto);
    const { adapter } = adapterCom([m]);

    const r = await rec.recuperarMensagensPerdidas(adapter, log);
    expect(r.novas).toBe(1);
  });

  it('11. worker fora por mais de 24h: a janela padrão de 72h alcança', async () => {
    const lead = await criarLead();
    const trintaHoras = new Date(Date.now() - 30 * 3600_000);
    const m = entrada(lead.telefoneNormalizado!, 'respondi na sexta', trintaHoras);
    const { adapter, pedidos } = adapterCom([m]);

    const r = await rec.recuperarMensagensPerdidas(adapter, log, new Date(), 72);

    expect(pedidos[0]!.getTime()).toBeLessThan(trintaHoras.getTime());
    expect(r.novas).toBe(1);
  });

  it('12. fora da janela pedida, a mensagem não entra — e a janela é configurável', async () => {
    const lead = await criarLead();
    const cemHoras = new Date(Date.now() - 100 * 3600_000);
    const m = entrada(lead.telefoneNormalizado!, 'antiga demais', cemHoras);
    const { adapter } = adapterCom([m]);

    // 72h não alcança...
    const curta = await rec.recuperarMensagensPerdidas(adapter, log, new Date(), 72);
    expect(curta.novas).toBe(0);

    // ...e é por isso que a janela é uma configuração, e não um número
    // cravado no código.
    const longa = await rec.recuperarMensagensPerdidas(adapter, log, new Date(), 200);
    expect(longa.novas).toBe(1);
  });
});

// =============================================================================
// 13 a 15 — O QUE A IA GRAVA NA PRÓPRIA MENSAGEM
// =============================================================================

describe('a leitura da IA fica na mensagem', () => {
  it('13. intent, confiança e motivo são gravados na mensagem recebida', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanhaCom(lead);

    const m = entrada(lead.telefoneNormalizado!, 'quanto custa?', new Date());
    const { adapter } = adapterCom([m]);
    await rec.recuperarMensagensPerdidas(adapter, log);

    const ia = new AnalisadorFalso(
      decide({ intent: 'PEDIDO_PRECO', confianca: 88, motivo: 'perguntou preço' })
    );

    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      { analisador: ia, somenteAnalise: false, log }
    );

    const gravada = await prisma.message.findUnique({
      where: { whatsappMessageId: m.providerMessageId },
    });

    // Sem isto, a ficha do dia precisava reprocessar a conversa inteira
    // para dizer "esse perguntou preço" — e pagava o modelo de novo a
    // cada vez que você abria a tela.
    expect(gravada?.aiIntent).toBe('PEDIDO_PRECO');
    expect(gravada?.aiConfidence).toBe(88);
    expect(gravada?.aiMotivo).toBe('perguntou preço');
    expect(gravada?.aiModelo).toBe('fake-1.0');
    expect(gravada?.aiStatus).toBe('OK');
  });

  it('14. a leitura vai para a ÚLTIMA recebida, não para uma antiga', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanhaCom(lead);

    const velha = entrada(
      lead.telefoneNormalizado!,
      'oi',
      new Date(Date.now() - 3600_000)
    );
    const nova = entrada(lead.telefoneNormalizado!, 'quanto custa?', new Date());
    const { adapter } = adapterCom([velha, nova]);
    await rec.recuperarMensagensPerdidas(adapter, log);

    const ia = new AnalisadorFalso(decide({ intent: 'PEDIDO_PRECO' }));
    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'MENSAGEM_RECEBIDA' },
      { analisador: ia, somenteAnalise: false, log }
    );

    const a = await prisma.message.findUnique({
      where: { whatsappMessageId: velha.providerMessageId },
    });
    const b = await prisma.message.findUnique({
      where: { whatsappMessageId: nova.providerMessageId },
    });

    expect(b?.aiIntent).toBe('PEDIDO_PRECO');
    expect(a?.aiIntent).toBeNull();
  });

  it('15. gatilho que não é resposta não escreve leitura em mensagem nenhuma', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanhaCom(lead);

    const m = entrada(lead.telefoneNormalizado!, 'oi', new Date());
    const { adapter } = adapterCom([m]);
    await rec.recuperarMensagensPerdidas(adapter, log);

    const ia = new AnalisadorFalso(decide({ acao: 'WAIT' }));
    await orq.orquestrarCadencia(
      { leadId: lead.id, campaignId: campanha.id, gatilho: 'ETAPA_CONCLUIDA' },
      { analisador: ia, somenteAnalise: false, log }
    );

    // A decisão existe na trilha; a mensagem não é dela.
    const gravada = await prisma.message.findUnique({
      where: { whatsappMessageId: m.providerMessageId },
    });
    expect(gravada?.aiIntent).toBeNull();
  });
});

// =============================================================================
// 16 a 18 — A INTERVENÇÃO MANUAL CONTINUA VALENDO
// =============================================================================

describe('a automação não fala por cima de você', () => {
  it('16. depois de você assumir, a campanha fica pausada aguardando liberação', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanhaCom(lead);

    const m = entrada(lead.telefoneNormalizado!, 'oi, é o Lucas', new Date(), {
      deMim: true,
    });
    const { adapter } = adapterCom([m]);
    await rec.recuperarMensagensPerdidas(adapter, log);

    const lc = await prisma.leadCampaign.findFirst({
      where: { leadId: lead.id, campaignId: campanha.id },
    });

    // A pausa não é irreversível: é a mesma que "retomar automação"
    // desfaz. O que ela garante é que nada sai enquanto você não mandar.
    expect(lc?.status).toBe('PAUSADO');
    expect(lc?.aguardandoLiberacao).toBe(true);
    expect(lc?.motivoParada).toContain('assumiu a conversa');
  });

  it('17. você falando dispara OPERADOR_FALOU — a IA reavalia sabendo disso', async () => {
    const lead = await criarLead();
    const { campanha } = await criarCampanhaCom(lead);

    // Em modo SOMBRA: a IA vê o gatilho e registra a decisão, mas não
    // executa nada. Nenhum envio pode nascer deste teste.
    const ia = new AnalisadorFalso(decide({ acao: 'WAIT' }));
    gatilhos.configurarIA({ analisador: ia, somenteAnalise: true, log });

    try {
      const m = entrada(lead.telefoneNormalizado!, 'oi, é o Lucas', new Date(), {
        deMim: true,
      });
      const { adapter } = adapterCom([m]);
      await rec.recuperarMensagensPerdidas(adapter, log);

      // Antes, o sistema pausava e ficava calado: nada reavaliava o lead
      // até ele responder de novo. O gatilho existe para a IA saber que
      // a conversa mudou de dono.
      expect(ia.ultimoContexto?.gatilho).toBe('OPERADOR_FALOU');
      expect(ia.ultimoContexto?.lead.id).toBe(lead.id);
      expect(campanha.dryRun).toBe(true);
    } finally {
      gatilhos.desconfigurarIA();
    }
  });

  it('18. mensagem SUA e HISTÓRICA não acorda a IA — passado não manda no presente', async () => {
    const lead = await criarLead();
    await criarCampanhaCom(lead);

    const ia = new AnalisadorFalso(decide({ acao: 'WAIT' }));
    gatilhos.configurarIA({ analisador: ia, somenteAnalise: true, log });

    try {
      const anteontem = new Date(Date.now() - 48 * 3600_000);
      const m = entrada(lead.telefoneNormalizado!, 'te mando amanhã', anteontem, {
        deMim: true,
      });
      const { adapter } = adapterCom([m]);
      await rec.recuperarMensagensPerdidas(adapter, log, new Date(), 72);

      expect(ia.chamadas).toBe(0);
    } finally {
      gatilhos.desconfigurarIA();
    }
  });
});

// =============================================================================
// 19 a 21 — O QUE A TELA MOSTRA
// =============================================================================

describe('o estado de sincronização que o dashboard lê', () => {
  it('19. depois de uma varredura, a tela sabe quando foi e o que veio', async () => {
    const lead = await criarLead();
    const m = entrada(lead.telefoneNormalizado!, 'respondi', new Date());
    const { adapter } = adapterCom([m]);

    await rec.recuperarMensagensPerdidas(adapter, log);

    const estado = await sinc.estadoDaSincronizacao();

    expect(estado.ultimaEm).not.toBeNull();
    expect(estado.minutosAtras).toBe(0);
    expect(estado.desatualizado).toBe(false);
    expect(estado.recuperadasNaUltima).toBe(1);
  });

  it('20. varredura antiga: a tela avisa que os números podem estar velhos', async () => {
    const horasAtras = new Date(Date.now() - 3 * 3600_000);
    await prisma.setting.upsert({
      where: { chave: sincChaves.ultima },
      update: { valor: horasAtras.toISOString() },
      create: { chave: sincChaves.ultima, valor: horasAtras.toISOString() },
    });

    const estado = await sinc.estadoDaSincronizacao();

    expect(estado.minutosAtras).toBeGreaterThan(sinc.MINUTOS_ATE_RECLAMAR);
    expect(estado.desatualizado).toBe(true);
  });

  it('21. nunca varreu — e um carimbo corrompido — contam como desatualizado', async () => {
    const nunca = await sinc.estadoDaSincronizacao();
    expect(nunca.ultimaEm).toBeNull();
    expect(nunca.desatualizado).toBe(true);

    // Um valor corrompido vira `Invalid Date`, e TODA comparação com NaN
    // dá false: sem esta guarda a tela diria "sincronizado" para sempre,
    // que é o pior defeito possível num indicador de frescor.
    await prisma.setting.upsert({
      where: { chave: sincChaves.ultima },
      update: { valor: 'nao-e-uma-data' },
      create: { chave: sincChaves.ultima, valor: 'nao-e-uma-data' },
    });

    const corrompido = await sinc.estadoDaSincronizacao();
    expect(corrompido.ultimaEm).toBeNull();
    expect(corrompido.desatualizado).toBe(true);
  });
});
